import test from "node:test";
import assert from "node:assert/strict";
import { loadService, memoryDatabase, ticket, applicant, handler, admin } from "./helpers/service-harness";

const { TicketService } = loadService("src/server/services/ticketService.ts");
const { NotificationService } = loadService("src/server/services/notificationService.ts");
const copiedUser = { ...applicant, id: "copied-id", dingtalkUserId: "copied", name: "Copied" };
const knownPeople = [applicant, handler, admin, copiedUser, { id: "next-id", dingtalkUserId: "next" }];
const copies = (ids = [copiedUser.dingtalkUserId]) => ids.map((userId) => ({ userId, personId: knownPeople.find((user) => user.dingtalkUserId === userId)?.id || null, userName: userId }));

function setup(rows = [ticket({ ccRecipients: copies() })]) {
  const memory = memoryDatabase(rows);
  memory.users.push(structuredClone(copiedUser));
  let categoryIds = [copiedUser.dingtalkUserId];
  memory.db.categoryCcRecipient.findMany = async ({ where }: { where: { categoryId: string; user: { status: string } } }) => {
    assert.equal(where.categoryId, "cat");
    assert.equal(where.user.status, "ACTIVE");
    return categoryIds.map((userId) => ({ userId, user: memory.users.find((user) => user.dingtalkUserId === userId) }))
      .filter((entry) => entry.user?.status === "ACTIVE");
  };
  const sent: Array<{ userId: string; message: any }> = [];
  const notifications = new NotificationService(memory.db, {
    sendWorkNotification: async (userId: string, message: any) => { sent.push({ userId, message }); }
  });
  notifications.ticketStats = async () => ({ title: "Primary statistics", metrics: [], chart: "", footnote: "Primary only" });
  return {
    ...memory, sent,
    service: new TicketService(memory.db, notifications),
    setCategory(ids: string[]) { categoryIds = ids; }
  };
}

function checkEvent(records: any[], primaryIds: string[], ccType: string, ccText: string) {
  assert.equal(records.length, primaryIds.length + 1);
  assert.deepEqual(records.filter((record) => record.recipientKind === "PRIMARY").map((record) => record.receiverUserId).sort(), [...primaryIds].sort());
  const cc = records.filter((record) => record.recipientKind === "CC");
  assert.equal(cc.length, 1);
  assert.equal(cc[0].receiverUserId, copiedUser.dingtalkUserId);
  assert.equal(cc[0].notificationType, ccType);
  assert.ok(cc[0].content.includes(ccText), cc[0].content);
  assert.ok(!/你的工单|你有一条|请继续处理|可进行满意度评价/.test(cc[0].content));
  assert.ok(records.every((record) => record.sendStatus === "SUCCESS"));
  assert.equal(new Set(records.map((record) => record.eventKey)).size, 1);
  assert.ok(cc[0].eventKey);
}

test("creation snapshots active category recipients and emits one merged event", async () => {
  const h = setup([]);
  h.users.push({ ...copiedUser, id: "disabled-id", dingtalkUserId: "disabled", status: "DISABLED" });
  h.setCategory([copiedUser.dingtalkUserId, applicant.dingtalkUserId, handler.dingtalkUserId, "disabled"]);
  const created = await h.service.createTicket({ title: "Printer issue", description: "Cannot print", categoryId: "cat", priority: "NORMAL" }, applicant);
  checkEvent(h.notifications(), [applicant.dingtalkUserId, handler.dingtalkUserId], "TICKET_CREATED", "新工单已提交");
  const snapshot = h.rows()[0].ccRecipients;
  assert.deepEqual(snapshot.map((entry: any) => entry.userId).sort(), ["applicant", "copied", "handler"]);
  assert.equal(snapshot.find((entry: any) => entry.userId === copiedUser.dingtalkUserId).userName, copiedUser.name);
  assert.equal(snapshot.find((entry: any) => entry.userId === copiedUser.dingtalkUserId).personId, copiedUser.id);
  const ccCard = h.sent.find((entry) => entry.userId === copiedUser.dingtalkUserId)!.message.oa;
  assert.equal(ccCard.message_url, `https://example.invalid/tickets/${created.ticket.id}`);
  assert.ok(!ccCard.body.content.includes("Primary statistics"));
});

test("creation without a default handler merges administrator recipients before CC delivery", async () => {
  const h = setup([]);
  h.users.find((user) => user.dingtalkUserId === handler.dingtalkUserId)!.status = "DISABLED";
  h.users.push({ ...admin, id: "admin2-id", dingtalkUserId: "admin2", name: "Admin Two" });
  h.setCategory([copiedUser.dingtalkUserId, admin.dingtalkUserId, "admin2"]);
  await h.service.createTicket({ title: "Unassigned issue", description: "Needs routing", categoryId: "cat", priority: "NORMAL" }, applicant);
  checkEvent(h.notifications(), ["applicant", "admin", "admin2"], "TICKET_CREATED", "新工单已提交");
});

test("assignment notifies applicant and new handler while copying each other recipient once", async () => {
  const h = setup([ticket({ ccRecipients: copies(["copied", "applicant", "next"]) })]);
  await h.service.assign("ticket-1", "next", admin);
  checkEvent(h.notifications(), ["applicant", "next"], "TICKET_ASSIGNED", "工单已分派给Next");
  assert.equal(h.notifications().find((entry) => entry.receiverUserId === "next").recipientKind, "PRIMARY");
});

const ordinaryEvents = [
  { label: "transfer", patch: {}, run: (s: any) => s.transfer("ticket-1", "next", handler), primary: ["next"], type: "TICKET_ASSIGNED", text: "工单已转交给Next" },
  { label: "accept", patch: { status: "ASSIGNED" }, run: (s: any) => s.updateStatus("ticket-1", "PROCESSING", handler), primary: ["applicant"], type: "STATUS_UPDATED", text: "工单状态已更新为：处理中" },
  { label: "resolve", patch: {}, run: (s: any) => s.resolve("ticket-1", handler, "Repaired"), primary: ["applicant"], type: "TICKET_RESOLVED", text: "工单已处理完成" },
  { label: "complete through status update", patch: {}, run: (s: any) => s.updateStatus("ticket-1", "COMPLETED", handler, "Repaired"), primary: ["applicant"], type: "TICKET_RESOLVED", text: "工单已处理完成" },
  { label: "close", patch: {}, run: (s: any) => s.close("ticket-1", handler), primary: ["applicant"], type: "STATUS_UPDATED", text: "工单已关闭" },
  { label: "reject", patch: {}, run: (s: any) => s.updateStatus("ticket-1", "REJECTED", handler), primary: ["applicant"], type: "STATUS_UPDATED", text: "工单状态已更新为：已驳回" },
  { label: "cancel", patch: {}, run: (s: any) => s.updateStatus("ticket-1", "CANCELLED", handler), primary: ["applicant"], type: "STATUS_UPDATED", text: "工单状态已更新为：已取消" }
];
for (const event of ordinaryEvents) {
  test(`${event.label} sends one CC notification with the committed event`, async () => {
    const h = setup([ticket({ ccRecipients: copies(), ...event.patch })]);
    await event.run(h.service);
    checkEvent(h.notifications(), event.primary, event.type, event.text);
    assert.equal(h.logs().length, 1);
  });
}

test("deadline adjustment copies the old and new deadline and adjustment reason", async () => {
  const h = setup();
  const next = new Date(Date.now() + 7_200_000);
  await h.service.adjustResolveDeadline("ticket-1", handler, next.toISOString(), "等待备件");
  checkEvent(h.notifications(), ["applicant"], "STATUS_UPDATED", "工单预计处理时间已调整");
  const cc = h.notifications().find((entry) => entry.recipientKind === "CC");
  assert.ok(cc.content.includes("原预计处理时间："));
  assert.ok(cc.content.includes("新预计处理时间："));
  assert.ok(cc.content.includes("调整说明：等待备件"));
  assert.equal(h.rows()[0].slaResolveDeadline.toISOString(), next.toISOString());
});

test("return and applicant supplement produce distinct events with their explanatory text", async () => {
  const h = setup();
  await h.service.returnToApplicant("ticket-1", handler, "需要设备照片");
  checkEvent(h.notifications(), ["applicant"], "STATUS_UPDATED", "退回原因：需要设备照片");
  const firstKey = h.notifications()[0].eventKey;
  const before = h.notifications().length;
  await h.service.supplementReturnedTicket("ticket-1", applicant, "已补充设备型号");
  const second = h.notifications().slice(before);
  checkEvent(second, ["handler"], "STATUS_UPDATED", "补充说明：已补充设备型号");
  assert.notEqual(second[0].eventKey, firstKey);
  assert.equal(h.rows()[0].status, "PROCESSING");
});

test("unsatisfied review sends the review notification type to administrators and CC", async () => {
  const h = setup([ticket({ status: "COMPLETED", ccRecipients: copies(["copied", "admin"]) })]);
  await h.service.satisfaction("ticket-1", applicant, "SATISFIED");
  assert.equal(h.notifications().length, 0);
  await h.service.satisfaction("ticket-1", applicant, "UNSATISFIED", "故障再次发生");
  checkEvent(h.notifications(), ["admin"], "UNSATISFIED_REVIEW", "工单收到不满意评价");
  assert.ok(h.notifications().every((entry) => entry.notificationType === "UNSATISFIED_REVIEW"));
});

test("SLA reminders copy both reminder types and deduplicate each deadline per recipient", async () => {
  const now = new Date();
  const h = setup([ticket({
    ccRecipients: copies(["copied", "handler"]), firstResponseAt: null,
    slaFirstResponseDeadline: new Date(now.getTime() + 1_800_000),
    slaResolveDeadline: new Date(now.getTime() + 3_600_000)
  })]);
  const first = await h.service.sendUpcomingSlaNotifications(now);
  assert.equal(first.firstResponse.count, 2);
  assert.equal(first.resolve.count, 2);
  const records = h.notifications();
  checkEvent(records.filter((entry) => entry.notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON"), ["handler"], "TICKET_FIRST_RESPONSE_DUE_SOON", "首响即将超时提醒");
  checkEvent(records.filter((entry) => entry.notificationType === "TICKET_RESOLVE_DUE_SOON"), ["handler"], "TICKET_RESOLVE_DUE_SOON", "处理即将超时提醒");
  const second = await h.service.sendUpcomingSlaNotifications(now);
  assert.equal(second.firstResponse.skipped, 2);
  assert.equal(second.resolve.skipped, 2);
  assert.equal(h.sent.length, 4);
  h.rows()[0].slaResolveDeadline = new Date(now.getTime() + 4_000_000);
  const rescheduled = await h.service.sendUpcomingSlaNotifications(now);
  assert.equal(rescheduled.resolve.count, 2);
  assert.equal(rescheduled.firstResponse.count, 0);
  assert.equal(h.sent.length, 6);
});

test("category changes leave existing ticket CC snapshots effective and disabled users receive nothing", async () => {
  const h = setup();
  h.setCategory(["next"]);
  await h.service.resolve("ticket-1", handler, "Repaired");
  checkEvent(h.notifications(), ["applicant"], "TICKET_RESOLVED", "工单已处理完成");
  h.users.find((user) => user.dingtalkUserId === copiedUser.dingtalkUserId)!.status = "DISABLED";
  const before = h.notifications().length;
  await h.service.close("ticket-1", handler);
  assert.deepEqual(h.notifications().slice(before).map((entry) => entry.receiverUserId), ["applicant"]);
});

test("creation rollback does not retain the CC snapshot or deliver notifications", async () => {
  const h = setup([]);
  h.state.failLog = true;
  await assert.rejects(h.service.createTicket({ title: "Test", description: "Issue", categoryId: "cat", priority: "NORMAL" }, applicant), /Log storage failed/);
  assert.equal(h.rows().length, 0);
  assert.equal(h.notifications().length, 0);
  assert.equal(h.sent.length, 0);
});

test("ordinary comments, overdue flag refreshes, and unchanged statuses do not introduce new notifications", async () => {
  const h = setup();
  await h.service.addComment("ticket-1", "Progress note", handler);
  await h.service.refreshOverdueFlags();
  await h.service.updateStatus("ticket-1", "PROCESSING", handler);
  assert.equal(h.notifications().length, 0);
  assert.equal(h.sent.length, 0);
});
