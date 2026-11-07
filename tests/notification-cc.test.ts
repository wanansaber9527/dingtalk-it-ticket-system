import test from "node:test";
import assert from "node:assert/strict";
import { loadService, memoryDatabase, ticket, applicant, handler, matches } from "./helpers/service-harness";

const { NotificationService } = loadService("src/server/services/notificationService.ts");
const copiedUser = { ...applicant, id: "copied-id", dingtalkUserId: "copied", name: "Copied" };

function fixture(copyIds = [copiedUser.dingtalkUserId]) {
  const memory = memoryDatabase();
  memory.users.push(structuredClone(copiedUser));
  const copies = copyIds.map((userId, index) => ({ id: `cc-${index}`, ticketId: "ticket-1", userId, personId: memory.users.find((user) => user.dingtalkUserId === userId)?.id || null }));
  memory.db.ticketCcRecipient = {
    findMany: async ({ where }: { where: { ticketId: string; user: { status: string } } }) => {
      assert.equal(where.user.status, "ACTIVE");
      return copies.filter((copy) => copy.ticketId === where.ticketId)
        .map((copy) => ({ ...copy, user: memory.users.find((user) => copy.personId ? user.id === copy.personId : user.dingtalkUserId === copy.userId) }))
        .filter((copy) => copy.user?.status === where.user.status);
    },
    findFirst: async ({ where }: { where: { ticketId: string; userId: string } }) => copies.find((copy) => matches(copy, where)) ?? null
  };
  const findNotification = memory.db.notification.findUniqueOrThrow;
  memory.db.notification.findUniqueOrThrow = async (args: { where: { id: string }; include?: { ticket: boolean } }) => {
    const notification = await findNotification(args);
    if (args.include?.ticket) notification.ticket = await memory.db.ticket.findUnique({ where: { id: notification.ticketId } });
    return notification;
  };
  const sent: Array<{ userId: string; payload: any }> = [];
  let statsCalls = 0;
  const service = new NotificationService(memory.db, {
    sendWorkNotification: async (userId: string, payload: any) => { sent.push({ userId, payload }); }
  });
  service.ticketStats = async () => {
    statsCalls++;
    return { title: "Primary statistics", metrics: [{ label: "Private count", value: "99" }], chart: "", footnote: "Private footnote" };
  };
  return { ...memory, copies, sent, service, statsCalls: () => statsCalls };
}

test("one business event merges primary and CC recipients, preserving primary semantics", async () => {
  const memory = fixture([applicant.dingtalkUserId, handler.dingtalkUserId, copiedUser.dingtalkUserId, "disabled"]);
  memory.users.push({ ...copiedUser, id: "disabled-id", dingtalkUserId: "disabled", status: "DISABLED" });
  const results = await memory.service.sendTicketEvent(ticket(), [
    { target: applicant, notificationType: "TICKET_CREATED", content: "你的工单已提交" },
    { target: applicant, notificationType: "STATUS_UPDATED", content: "Duplicate primary target" },
    { target: handler, notificationType: "NEW_TICKET_PENDING", content: "请处理工单" }
  ], "ticket-1:create", "申请人已提交工单");

  assert.equal(results.length, 3);
  assert.equal(memory.sent.length, 3);
  assert.equal(memory.statsCalls(), 2);
  const records = memory.notifications();
  assert.deepEqual(records.map((record) => [record.receiverUserId, record.recipientKind]), [["applicant", "PRIMARY"], ["handler", "PRIMARY"], ["copied", "CC"]]);
  assert.equal(records[0].notificationType, "TICKET_CREATED");
  assert.equal(records[0].content, "你的工单已提交");
  assert.ok(records.every((record) => record.eventKey === "ticket-1:create"));
  const cc = memory.sent.find((entry) => entry.userId === copiedUser.dingtalkUserId)!.payload.oa;
  assert.equal(cc.message_url, "https://example.invalid/tickets/ticket-1");
  assert.equal(cc.pc_message_url, cc.message_url);
  assert.ok(cc.body.title.startsWith("抄送知悉"));
  assert.ok(cc.body.content.includes("申请人已提交工单"));
  assert.ok(!/你的工单|请处理|Private|statistics/.test(cc.body.content));
  assert.equal("rich" in cc.body, false);
});

test("event and recipient keys deduplicate concurrent fan-out but allow later events", async () => {
  const memory = fixture();
  await Promise.all([
    memory.service.sendTicketEvent(ticket(), [], "ticket-1:status:1", "工单状态已更新"),
    memory.service.sendTicketEvent(ticket(), [], "ticket-1:status:1", "工单状态已更新")
  ]);
  assert.equal(memory.sent.length, 1);
  assert.equal(memory.notifications().length, 1);
  await memory.service.sendTicketEvent(ticket(), [], "ticket-1:status:2", "工单状态再次更新");
  assert.equal(memory.sent.length, 2);
  assert.equal(memory.notifications().length, 2);
  assert.equal(memory.statsCalls(), 0);
});

test("failed CC delivery retries the same event record after backoff", async () => {
  const memory = fixture();
  let attempts = 0;
  const service = new NotificationService(memory.db, {
    sendWorkNotification: async () => { if (++attempts === 1) throw new Error("Upstream unavailable"); }
  });
  service.ticketStats = async () => { throw new Error("CC must not query statistics"); };
  const options = { ccNotificationType: "TICKET_RESOLVE_DUE_SOON" };
  await service.sendTicketEvent(ticket(), [], "ticket-1:deadline", "处理即将超时", options);
  const stored = memory.notifications()[0];
  assert.equal(stored.sendStatus, "FAILED");
  assert.equal(stored.notificationType, "TICKET_RESOLVE_DUE_SOON");
  await service.sendTicketEvent(ticket(), [], "ticket-1:deadline", "处理即将超时", options);
  assert.equal(attempts, 1);
  stored.createdAt = new Date(Date.now() - 61_000);
  await service.sendTicketEvent(ticket(), [], "ticket-1:deadline", "处理即将超时", options);
  assert.equal(attempts, 2);
  assert.equal(memory.notifications().length, 1);
  assert.equal(stored.sendStatus, "SUCCESS");
  assert.equal(stored.recipientKind, "CC");
});

test("CC resend preserves its read-only card and only resends that recipient", async () => {
  const memory = fixture([copiedUser.dingtalkUserId, handler.dingtalkUserId]);
  await memory.service.sendTicketEvent(ticket(), [], "ticket-1:event", "工单状态已更新");
  const cc = memory.notifications().find((record) => record.receiverUserId === copiedUser.dingtalkUserId)!;
  const before = memory.sent.length;
  await memory.service.resend(cc.id);
  assert.equal(memory.sent.length, before + 1);
  assert.equal(memory.sent.at(-1)!.userId, copiedUser.dingtalkUserId);
  assert.equal(memory.sent.at(-1)!.payload.oa.message_url, "https://example.invalid/tickets/ticket-1");
  assert.equal(memory.statsCalls(), 0);
  assert.equal(cc.recipientKind, "CC");
});

test("CC resend rejects disabled users, revoked ticket access, and deleted tickets", async () => {
  const memory = fixture();
  await memory.service.sendTicketEvent(ticket(), [], "ticket-1:event", "工单状态已更新");
  const cc = memory.notifications()[0];
  const user = memory.users.find((entry) => entry.dingtalkUserId === copiedUser.dingtalkUserId)!;
  user.status = "DISABLED";
  await assert.rejects(memory.service.resend(cc.id), (error: any) => error.code === "CC_RECIPIENT_UNAVAILABLE");
  user.status = "ACTIVE";
  memory.copies.splice(0);
  await assert.rejects(memory.service.resend(cc.id), (error: any) => error.code === "CC_PERMISSION_REVOKED");
  memory.rows().splice(0);
  await assert.rejects(memory.service.resend(cc.id), (error: any) => error.code === "CC_RECIPIENT_UNAVAILABLE");
  assert.equal(memory.sent.length, 1);
  assert.equal(cc.sendStatus, "SUCCESS");
});

test("a CC recipient who still has primary ticket access can receive a single resend", async () => {
  const memory = fixture([handler.dingtalkUserId]);
  await memory.service.sendTicketEvent(ticket(), [], "ticket-1:event", "工单状态已更新");
  memory.copies.splice(0);
  await memory.service.resend(memory.notifications()[0].id);
  assert.equal(memory.sent.length, 2);
  assert.equal(memory.statsCalls(), 0);
});

test("CC lookup failure does not suppress primary recipients", async () => {
  const memory = fixture();
  memory.db.ticketCcRecipient.findMany = async () => { throw new Error("CC database unavailable"); };
  const results = await memory.service.sendTicketEvent(ticket(), [
    { target: applicant, notificationType: "STATUS_UPDATED", content: "你的工单状态已更新" }
  ], "ticket-1:event", "工单状态已更新");
  assert.equal(memory.sent.length, 1);
  assert.equal(results.length, 2);
  assert.equal(results[0].delivery, "sent");
  assert.equal(results[1], null);
});

test("one recipient's delivery or persistence failure does not block the remaining event recipients", async () => {
  for (const failure of ["delivery", "persistence"]) {
    const memory = fixture();
    const create = memory.db.notification.create;
    if (failure === "persistence") {
      memory.db.notification.create = async (args: { data: { receiverUserId: string } }) => {
        if (args.data.receiverUserId === applicant.dingtalkUserId) throw new Error("Record storage unavailable");
        return create(args);
      };
    }
    const delivered: string[] = [];
    const service = new NotificationService(memory.db, {
      sendWorkNotification: async (userId: string) => {
        if (userId === applicant.dingtalkUserId && failure === "delivery") throw new Error("Delivery rejected");
        delivered.push(userId);
      }
    });
    service.ticketStats = async () => ({ title: "Stats", metrics: [], chart: "", footnote: "" });
    const results = await service.sendTicketEvent(ticket(), [
      { target: applicant, notificationType: "STATUS_UPDATED", content: "你的工单状态已更新" },
      { target: handler, notificationType: "STATUS_UPDATED", content: "工单状态已更新" }
    ], "ticket-1:event", "工单状态已更新");
    assert.deepEqual(delivered, [handler.dingtalkUserId, copiedUser.dingtalkUserId]);
    assert.equal(results[0]?.delivery ?? null, failure === "delivery" ? "failed" : null);
    assert.equal(results[1].delivery, "sent");
    assert.equal(results[2].delivery, "sent");
  }
});

test("event delivery honors successful legacy SLA records", async () => {
  const memory = fixture([]);
  const content = "截止时间：2026-11-08 18:00\n剩余时间：30分钟";
  await memory.service.sendTicketNotification(ticket(), handler, "TICKET_RESOLVE_DUE_SOON", content, { deduplicationKey: "old-sla-key" });
  const results = await memory.service.sendTicketEvent(ticket(), [
    { target: handler, notificationType: "TICKET_RESOLVE_DUE_SOON", content }
  ], "ticket-1:new-event-key", content, { legacyDeduplicationText: "截止时间：2026-11-08 18:00\n" });
  assert.equal(results[0].delivery, "skipped");
  assert.equal(memory.notifications().length, 1);
  assert.equal(memory.sent.length, 1);
});


test("rehired CC users resolve through internal identity and overlap with primary only once", async () => {
  const memory = fixture([applicant.dingtalkUserId, copiedUser.dingtalkUserId]);
  memory.rows()[0].applicantId = applicant.id;
  memory.users.find((user) => user.id === applicant.id)!.dingtalkUserId = "rehired-applicant";
  memory.users.find((user) => user.id === copiedUser.id)!.dingtalkUserId = "rehired-copied";
  await memory.service.sendTicketEvent(memory.rows()[0], [
    { target: applicant, notificationType: "STATUS_UPDATED", content: "本人状态更新" }
  ], "rehire-cc", "工单状态更新");
  assert.deepEqual(memory.sent.map((entry) => entry.userId), ["rehired-applicant", "rehired-copied"]);
  assert.equal(memory.notifications().filter((entry) => entry.receiverPersonId === applicant.id).length, 1);
  assert.equal(memory.notifications().find((entry) => entry.receiverPersonId === applicant.id)!.recipientKind, "PRIMARY");
  assert.equal(memory.notifications().find((entry) => entry.receiverPersonId === copiedUser.id)!.recipientKind, "CC");
});

test("a former handler who only retains CC access receives a read-only resend without statistics", async () => {
  const memory = fixture([handler.dingtalkUserId]);
  memory.rows()[0].handlerId = handler.id;
  await memory.service.sendTicketEvent(memory.rows()[0], [
    { target: handler, notificationType: "TICKET_ASSIGNED", content: "工单已分派" }
  ], "handler-cc-access", "工单已分派");
  const record = memory.notifications()[0];
  assert.equal(record.recipientKind, "PRIMARY");
  assert.equal(memory.statsCalls(), 1);
  memory.users.find((user) => user.id === handler.id)!.roleAssignments = [{ role: "EMPLOYEE" }];
  await memory.service.resend(record.id);
  assert.equal(record.recipientKind, "CC");
  assert.equal(memory.statsCalls(), 1);
  const card = memory.sent.at(-1)!.payload.oa;
  assert.equal(card.message_url, "https://example.invalid/tickets/ticket-1");
  assert.equal("rich" in card.body, false);
});
