import test from "node:test";
import assert from "node:assert/strict";
import { loadService, memoryDatabase, ticket, applicant, handler } from "./helpers/service-harness";

const { NotificationService } = loadService("src/server/services/notificationService.ts");
const { TicketService } = loadService("src/server/services/ticketService.ts");
const target = { dingtalkUserId: applicant.dingtalkUserId, name: applicant.name };
function sender(memory: ReturnType<typeof memoryDatabase>, deliver: (...args: any[]) => Promise<void>) {
  const service = new NotificationService(memory.db, { sendWorkNotification: deliver });
  service.ticketStats = async () => ({ title: "Stats", metrics: [], chart: "", footnote: "Statistics" });
  return service;
}

test("OA card preserves new deadline, return reason, and SLA remaining time", async () => {
  const memory = memoryDatabase();
  const sent: any[] = [];
  const service = sender(memory, async (_id, payload) => { sent.push(payload); });
  await service.sendTicketNotification(ticket(), target, "STATUS_UPDATED", "预计处理时间已调整\n新预计处理时间：2026-11-08 10:00\n调整说明：等待零件\n退回原因：需要照片\n剩余时间：30分钟\n工单标题：Printer");
  const content = sent[0].oa.body.content;
  for (const detail of ["2026-11-08 10:00", "等待零件", "需要照片", "30分钟"]) assert.ok(content.includes(detail));
  assert.equal(memory.notifications()[0].sendStatus, "SUCCESS");
});

test("stable notification keys deduplicate concurrent senders across instances", async () => {
  const memory = memoryDatabase();
  let deliveries = 0;
  const first = sender(memory, async () => { deliveries++; });
  const second = sender(memory, async () => { deliveries++; });
  await Promise.all([
    first.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", { deduplicationKey: "ticket:deadline:user" }),
    second.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", { deduplicationKey: "ticket:deadline:user" })
  ]);
  assert.equal(deliveries, 1);
  assert.equal(memory.notifications().length, 1);
});

test("failed reminder respects backoff then retries the same persisted record", async () => {
  const memory = memoryDatabase();
  let attempts = 0;
  const service = sender(memory, async () => { if (++attempts === 1) throw new Error("Temporary upstream failure"); });
  const options = { deduplicationKey: "retry-key" };
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  assert.equal(memory.notifications()[0].sendStatus, "FAILED");
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  assert.equal(attempts, 1);
  memory.notifications()[0].createdAt = new Date(Date.now() - 61_000);
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  assert.equal(attempts, 2);
  assert.equal(memory.notifications().length, 1);
  assert.equal(memory.notifications()[0].sendStatus, "SUCCESS");
});

test("a stalled pending reminder can be recovered after the lease expires", async () => {
  const memory = memoryDatabase();
  let deliveries = 0;
  const service = sender(memory, async () => { deliveries++; });
  const options = { deduplicationKey: "lease-key" };
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  memory.notifications()[0].sendStatus = "PENDING";
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  assert.equal(deliveries, 1);
  memory.notifications()[0].createdAt = new Date(Date.now() - 301_000);
  await service.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  assert.equal(deliveries, 2);
});

test("cron reminds again after rescheduling or transferring, and honors legacy success", async () => {
  const now = new Date();
  const memory = memoryDatabase([ticket({ firstResponseAt: now, slaResolveDeadline: new Date(now.getTime() + 3_600_000) })]);
  let deliveries = 0;
  const notifications = sender(memory, async () => { deliveries++; });
  const service = new TicketService(memory.db, notifications);
  await service.sendUpcomingSlaNotifications(now);
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 1);
  memory.rows()[0].slaResolveDeadline = new Date(now.getTime() + 4_000_000);
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 2);
  memory.rows()[0].handlerUserId = "next";
  memory.rows()[0].handlerName = "Next";
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 3);
  memory.notifications()[2].id = "legacy-cuid-notification";
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 3);
});

test("cron scans beyond the first hundred tickets even when earlier reminders succeeded", async () => {
  const now = new Date();
  const memory = memoryDatabase(Array.from({ length: 105 }, (_, index) => ticket({ id: `ticket-${String(index).padStart(3, "0")}`, firstResponseAt: now, slaResolveDeadline: new Date(now.getTime() + 3_600_000) })));
  let deliveries = 0;
  const service = new TicketService(memory.db, sender(memory, async () => { deliveries++; }));
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 105);
  await service.sendUpcomingSlaNotifications(now);
  assert.equal(deliveries, 105);
});

test("an expired sender cannot overwrite the result of the worker holding the newer lease", async () => {
  const memory = memoryDatabase();
  const create = memory.db.notification.create;
  let firstCreation = true;
  memory.db.notification.create = async (args: unknown) => {
    const result = await create(args);
    if (firstCreation) {
      firstCreation = false;
      const expired = new Date(Date.now() - 301_000);
      memory.notifications()[0].createdAt = expired;
      result.createdAt = expired;
    }
    return result;
  };
  let failFirst!: () => void;
  let finishSecond!: () => void;
  const firstGate = new Promise<void>((_resolve, reject) => { failFirst = () => reject(new Error("Old sender failed late")); });
  const secondGate = new Promise<void>((resolve) => { finishSecond = resolve; });
  let markFirstEntered!: () => void;
  let markSecondEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
  const secondEntered = new Promise<void>((resolve) => { markSecondEntered = resolve; });
  const first = sender(memory, async () => { markFirstEntered(); return firstGate; });
  const second = sender(memory, async () => { markSecondEntered(); return secondGate; });
  const options = { deduplicationKey: "lease-race" };
  const firstResult = first.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  await firstEntered;
  const secondResult = second.sendTicketNotification(ticket(), target, "TICKET_RESOLVE_DUE_SOON", "Reminder", options);
  await secondEntered;
  const newLeaseAt = memory.notifications()[0].createdAt.getTime();
  failFirst();
  assert.equal((await firstResult).delivery, "skipped");
  assert.equal(memory.notifications()[0].sendStatus, "PENDING");
  assert.equal(memory.notifications()[0].createdAt.getTime(), newLeaseAt);
  finishSecond();
  assert.equal((await secondResult).delivery, "sent");
  assert.equal(memory.notifications()[0].sendStatus, "SUCCESS");
  assert.equal(memory.notifications()[0].errorMessage, null);
});

test("cron counts only new successful deliveries and reports scans, skips and failures separately", async () => {
  const now = new Date();
  const memory = memoryDatabase([ticket({ firstResponseAt: now, slaResolveDeadline: new Date(now.getTime() + 3_600_000) })]);
  const service = new TicketService(memory.db, sender(memory, async () => {}));
  const first = await service.sendUpcomingSlaNotifications(now);
  assert.equal(first.resolve.count, 1);
  assert.equal(first.resolve.scanned, 1);
  assert.equal(first.resolve.skipped, 0);
  const second = await service.sendUpcomingSlaNotifications(now);
  assert.equal(second.resolve.count, 0);
  assert.equal(second.resolve.scanned, 1);
  assert.equal(second.resolve.skipped, 1);
  assert.equal(second.resolve.failed, 0);
  assert.equal(second.resolve.tickets.length, 0);
  memory.rows()[0].slaResolveDeadline = new Date(now.getTime() + 4_000_000);
  const failing = new TicketService(memory.db, sender(memory, async () => { throw new Error("Provider offline"); }));
  const failure = await failing.sendUpcomingSlaNotifications(now);
  assert.equal(failure.resolve.count, 0);
  assert.equal(failure.resolve.failed, 1);
});

test("two manual resends cannot acquire the same notification lease", async () => {
  const memory = memoryDatabase();
  let deliveries = 0;
  const service = sender(memory, async () => { deliveries++; });
  await service.sendTicketNotification(ticket(), target, "STATUS_UPDATED", "Original notification");
  const id = memory.notifications()[0].id;
  const result = await Promise.allSettled([service.resend(id), service.resend(id)]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((result.find((item) => item.status === "rejected") as PromiseRejectedResult).reason.code, "NOTIFICATION_SENDING");
  assert.equal(deliveries, 2);
  assert.equal(memory.notifications()[0].sendStatus, "SUCCESS");
});


test("a rehire keeps event deduplication stable and explicit resend records the current external account", async () => {
  const memory = memoryDatabase([ticket({ applicantId: applicant.id })]);
  const sent: string[] = [];
  const service = sender(memory, async (userId) => { sent.push(userId); });
  const eventTargets = [{ target: applicant, notificationType: "STATUS_UPDATED", content: "工单状态更新" }];
  await service.sendTicketEvent(memory.rows()[0], eventTargets, "stable-person-event", "工单状态更新");
  const previous = memory.notifications()[0];
  // 模拟已迁移的旧版 event id，内部收件人关联已回填。
  previous.id = "event_previous_external_key";
  const current = memory.users.find((user) => user.id === applicant.id)!;
  current.dingtalkUserId = "rehired-applicant";
  await service.sendTicketEvent(memory.rows()[0], eventTargets, "stable-person-event", "工单状态更新");
  assert.deepEqual(sent, ["applicant"]);
  assert.equal(memory.notifications().length, 1);
  assert.equal(previous.receiverUserId, "applicant", "dedup must not rewrite a successful historical delivery");
  await service.resend(previous.id);
  assert.deepEqual(sent, ["applicant", "rehired-applicant"]);
  assert.equal(previous.receiverUserId, "rehired-applicant");
  assert.equal(previous.receiverPersonId, applicant.id);
});

test("primary resend rejects a rehired employee who lost the former handler role", async () => {
  const memory = memoryDatabase([ticket({ handlerId: handler.id })]);
  const sent: string[] = [];
  const service = sender(memory, async (userId) => { sent.push(userId); });
  await service.sendTicketNotification(memory.rows()[0], handler, "TICKET_ASSIGNED", "请处理工单");
  const record = memory.notifications()[0];
  const current = memory.users.find((user) => user.id === handler.id)!;
  current.roleAssignments = [{ role: "EMPLOYEE" }];
  current.dingtalkUserId = "rehired-handler";
  await assert.rejects(service.resend(record.id), (error: any) => error.code === "RECIPIENT_PERMISSION_REVOKED");
  assert.deepEqual(sent, ["handler"]);
  assert.equal(record.sendStatus, "SUCCESS");
  assert.equal(record.receiverUserId, "handler");
});

test("legacy external-only notifications and unknown users cannot bypass departure checks", async () => {
  for (const condition of ["DEPARTED", "DISABLED", "MISSING"]) {
    const memory = memoryDatabase();
    const sent: string[] = [];
    const service = sender(memory, async (userId) => { sent.push(userId); });
    await service.sendTicketNotification(ticket(), target, "STATUS_UPDATED", "Original");
    const record = memory.notifications()[0];
    record.receiverPersonId = null;
    const current = memory.users.find((user) => user.id === applicant.id)! as any;
    if (condition === "DEPARTED") current.employmentStatus = "DEPARTED";
    if (condition === "DISABLED") current.status = "DISABLED";
    if (condition === "MISSING") current.dingtalkUserId = "other-account";
    await assert.rejects(service.resend(record.id), (error: any) => error.code === "RECIPIENT_UNAVAILABLE");
    assert.equal(await service.sendTicketNotification(ticket(), target, "STATUS_UPDATED", "Should not send"), null);
    assert.deepEqual(sent, ["applicant"]);
  }
});

test("an automatic event does not notify a former handler after role removal", async () => {
  const memory = memoryDatabase([ticket({ handlerId: handler.id, applicantId: applicant.id })]);
  const sent: string[] = [];
  const service = sender(memory, async (userId) => { sent.push(userId); });
  memory.users.find((user) => user.id === handler.id)!.roleAssignments = [{ role: "EMPLOYEE" }];
  await service.sendTicketEvent(memory.rows()[0], [
    { target: handler, notificationType: "STATUS_UPDATED", content: "员工已补充工单" },
    { target: applicant, notificationType: "STATUS_UPDATED", content: "补充成功" }
  ], "former-handler-event", "员工已补充工单");
  assert.deepEqual(sent, ["applicant"]);
});

test("one recipient lookup failure does not suppress the other event recipients", async () => {
  const memory = memoryDatabase();
  const find = memory.db.user.findUnique;
  memory.db.user.findUnique = async (args: any) => {
    if (args.where.id === applicant.id) throw new Error("Temporary user read failure");
    return find(args);
  };
  const sent: string[] = [];
  const service = sender(memory, async (userId) => { sent.push(userId); });
  const results = await service.sendTicketEvent(ticket(), [
    { target: applicant, notificationType: "STATUS_UPDATED", content: "已更新" },
    { target: handler, notificationType: "STATUS_UPDATED", content: "已更新" }
  ], "lookup-recovery", "已更新");
  assert.deepEqual(sent, ["handler"]);
  assert.equal(results.at(-1), null);
});
