import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";

// Guard every integration entry: no dotenv, real DingTalk delivery, or production database.
test("category CC isolated MySQL and HTTP acceptance", { skip: process.env.RUN_LOCAL_HTTP_TESTS !== "1" }, async (t) => {
  const database = new URL(process.env.DATABASE_URL || "invalid:");
  assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "33427"); assert.equal(database.pathname, "/itdesk_local");
  assert.equal(process.env.ITDESK_LOCAL_ISOLATED, "1"); assert.equal(process.env.DINGTALK_MOCK_ENABLED, "true"); assert.equal(process.env.DEV_AUTH_ENABLED, "true");
  const origin = "http://127.0.0.1:3100";
  const [{ PrismaClient }, { default: sharp }, { AiService }] = await Promise.all([import("@prisma/client"), import("sharp"), import("../src/server/services/aiService")]);
  const db = new PrismaClient({ datasourceUrl: database.href });
  const prefix = `cc-test-${randomUUID().slice(0, 10)}`;
  const actors = { applicant: `${prefix}-applicant`, handler: `${prefix}-handler`, cc: `${prefix}-cc`, ccHandler: `${prefix}-cc-handler`, admin: `${prefix}-admin`, outsider: `${prefix}-outsider`, disabled: `${prefix}-disabled` };
  type Actor = keyof typeof actors;
  const files: string[] = [];
  const categoryInput = { name: prefix, defaultHandlerUserId: actors.handler, firstResponseMinutes: 60, resolveMinutes: 120 };
  let categoryId = "";
  let ticketId = "";
  let attachment: { name: string; url: string; size: number; type: string };
  async function request(url: string, actor: Actor, options: { method?: string; body?: unknown; form?: FormData } = {}) {
    assert.ok(url.startsWith("/") && !url.startsWith("//"));
    return fetch(origin + url, { method: options.method || "GET", headers: { "x-dingtalk-userid": actors[actor], ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, body: options.form || (options.body === undefined ? undefined : JSON.stringify(options.body)), redirect: "manual", signal: AbortSignal.timeout(30000) });
  }
  async function json(url: string, actor: Actor, options: { method?: string; body?: unknown; form?: FormData } = {}, expected = 200) {
    const response = await request(url, actor, options); const result = await response.json();
    assert.equal(response.status, expected, `${url}: ${JSON.stringify(result)}`); return result.data;
  }
  async function createTicket(title: string) {
    return (await json("/api/tickets", "applicant", { method: "POST", body: { title: `${prefix} ${title}`, categoryId, priority: "NORMAL", description: "Local CC acceptance only", attachments: attachment ? [attachment] : [] } }, 201)).ticket;
  }
  t.after(async () => {
    try {
      await db.notification.deleteMany({ where: { receiverUserId: { startsWith: prefix } } });
      await db.ticket.deleteMany({ where: { applicantUserId: { startsWith: prefix } } });
      await db.aiConversation.deleteMany({ where: { userId: { startsWith: prefix } } });
      await db.ticketCategory.deleteMany({ where: { name: { startsWith: prefix } } });
      await db.user.deleteMany({ where: { dingtalkUserId: { startsWith: prefix } } });
      for (const name of files) {
        for (const p of [path.join(process.env.UPLOAD_DIR!, name), path.join(process.env.UPLOAD_DIR!, ".owners", `${name}.json`)]) await unlink(p).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    } finally { await db.$disconnect(); }
  });
  for (const [actor, userId] of Object.entries(actors)) {
    await db.user.create({ data: { dingtalkUserId: userId, name: `${prefix} ${actor}`, departmentName: "CC测试部门", status: actor === "disabled" ? "DISABLED" : "ACTIVE", roleAssignments: { create: { role: actor === "admin" ? "SUPER_ADMIN" : actor.toLowerCase().includes("handler") ? "IT_HANDLER" : "EMPLOYEE" } } } });
  }
  assert.equal((await json("/api/me", "admin")).dingtalkUserId, actors.admin);

  await t.test("only administrators configure recipients; empty is optional and invalid members rejected atomically", async () => {
    for (const actor of ["applicant", "handler", "cc"] as Actor[]) {
      await json("/api/admin/categories", actor, { method: "POST", body: categoryInput }, 403);
      await json("/api/admin/users/cc-options", actor, {}, 403);
    }
    const empty = await json("/api/admin/categories", "admin", { method: "POST", body: categoryInput }, 201);
    categoryId = empty.id; assert.deepEqual(empty.ccUserIds, []);
    for (const ccUserIds of [[actors.disabled], ["no-such-user"], Array.from({ length: 51 }, (_, i) => `u${i}`)]) {
      await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: { ...categoryInput, ccUserIds } }, 400);
      assert.equal(await db.categoryCcRecipient.count({ where: { categoryId } }), 0);
    }
    const members = [actors.cc, actors.ccHandler, actors.applicant, actors.handler];
    const saved = await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: { ...categoryInput, ccUserIds: [...members, actors.cc] } });
    assert.deepEqual(saved.ccUserIds.slice().sort(), members.sort());
    const candidates = await json(`/api/admin/users/cc-options?keyword=${encodeURIComponent(prefix)}`, "admin");
    assert.equal(candidates.length, 6); assert.ok(candidates.every((p: { status: string }) => p.status === "ACTIVE"));
    const publicCategories = await (await fetch(origin + "/api/categories")).json();
    assert.ok(publicCategories.data.every((c: object) => !("ccRecipients" in c) && !("ccUserIds" in c)));
  });
  await t.test("new tickets snapshot recipients and one event sends each receiver once with original roles preserved", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#2468ac" } }).png().toBuffer();
    const form = new FormData(); form.set("file", new File([new Uint8Array(png)], "cc.png", { type: "image/png" }));
    attachment = await json("/api/uploads", "applicant", { method: "POST", form }); files.push(attachment.url.split("/").pop()!);
    const ticket = await createTicket("initial"); ticketId = ticket.id;
    assert.equal(await db.ticketCcRecipient.count({ where: { ticketId } }), 4);
    const notices = await db.notification.findMany({ where: { ticketId } });
    assert.equal(notices.length, 4); assert.equal(new Set(notices.map(n => n.eventKey)).size, 1);
    assert.equal(notices.filter(n => n.recipientKind === "CC").length, 2);
    assert.ok(notices.every(n => n.sendStatus === "SUCCESS"));
    for (const actor of ["applicant", "handler"] as Actor[]) assert.equal(notices.find(n => n.receiverUserId === actors[actor])?.recipientKind, "PRIMARY");
  });
  await t.test("CC detail, attachment and list are readable but all write operations remain forbidden", async () => {
    for (const actor of ["cc", "ccHandler"] as Actor[]) {
      const detail = await json(`/api/tickets/${ticketId}`, actor);
      assert.deepEqual(detail.permissions, { canComment: false, canSupplement: false, canRate: false, canOperate: false, isCcOnly: true });
      assert.equal((await request(attachment.url, actor)).status, 200);
      const ccList = await json("/api/tickets/my?scope=cc&page=1&pageSize=1", actor);
      assert.equal(ccList.total, 1); assert.equal(ccList.items[0].id, ticketId);
      assert.equal((await json("/api/tickets/my?page=1&pageSize=20", actor)).total, 0);
      const writes: Array<[string, unknown]> = [["comments", { remark: "Forbidden" }], ["status", { status: "PROCESSING" }], ["transfer", { handlerUserId: actors.ccHandler }], ["resolve", { resultSummary: "Forbidden" }], ["return", { remark: "Forbidden" }], ["resolve-deadline", { slaResolveDeadline: new Date(Date.now() + 7200000).toISOString() }], ["supplement", { remark: "Forbidden" }], ["satisfaction", { level: "SATISFIED" }]];
      for (const [action, body] of writes) await json(`/api/tickets/${ticketId}/${action}`, actor, { method: "POST", body }, 403);
      await json(`/api/admin/categories/${categoryId}`, actor, { method: "PUT", body: { ...categoryInput, ccUserIds: [] } }, 403);
    }
    await json(`/api/tickets/${ticketId}`, "outsider", {}, 403); assert.equal((await request(attachment.url, "outsider")).status, 403);
    await json("/api/tickets/my?scope=all", "cc", {}, 400);
    assert.equal((await json(`/api/tickets/${ticketId}`, "applicant")).permissions.canComment, true);
    assert.equal((await json(`/api/tickets/${ticketId}`, "handler")).permissions.canOperate, true);
    assert.equal(await db.ticketLog.count({ where: { ticketId } }), 1);
  });
  await t.test("clearing the category affects new tickets only, while omitted fields preserve configuration", async () => {
    await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: categoryInput });
    assert.equal(await db.categoryCcRecipient.count({ where: { categoryId } }), 4);
    await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: { ...categoryInput, ccUserIds: [] } });
    const next = await createTicket("after clear");
    assert.equal(await db.ticketCcRecipient.count({ where: { ticketId: next.id } }), 0);
    assert.equal(await db.notification.count({ where: { ticketId: next.id, recipientKind: "CC" } }), 0);
    await json(`/api/tickets/${next.id}`, "cc", {}, 403);
    assert.equal((await json(`/api/tickets/${ticketId}`, "cc")).permissions.isCcOnly, true);
    const logsBefore = await db.notification.count({ where: { ticketId, receiverUserId: actors.cc } });
    await json(`/api/tickets/${ticketId}/status`, "handler", { method: "POST", body: { status: "PROCESSING" } });
    assert.equal(await db.notification.count({ where: { ticketId, receiverUserId: actors.cc } }), logsBefore + 1);
    await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: { ...categoryInput, ccUserIds: [actors.outsider] } });
    await json(`/api/tickets/${ticketId}`, "outsider", {}, 403);
  });
  await t.test("disabled CC cannot read or receive subsequent events and manual resend cannot bypass disable", async () => {
    const notice = await db.notification.findFirstOrThrow({ where: { ticketId, receiverUserId: actors.cc } });
    await db.user.update({ where: { dingtalkUserId: actors.cc }, data: { status: "DISABLED" } });
    try {
      await json(`/api/tickets/${ticketId}`, "cc", {}, 403);
      const before = await db.notification.count({ where: { ticketId, receiverUserId: actors.cc } });
      await json(`/api/tickets/${ticketId}/resolve`, "handler", { method: "POST", body: { resultSummary: "Local test completed" } });
      assert.equal(await db.notification.count({ where: { ticketId, receiverUserId: actors.cc } }), before);
      await json(`/api/admin/notifications/${notice.id}/resend`, "admin", { method: "POST" }, 403);
    } finally { await db.user.update({ where: { dingtalkUserId: actors.cc }, data: { status: "ACTIVE" } }); }
  });
  await t.test("AI submission uses the same CC snapshot, private follow-up remains inaccessible, and retries do not duplicate", async () => {
    await json(`/api/admin/categories/${categoryId}`, "admin", { method: "PUT", body: { ...categoryInput, ccUserIds: [actors.cc] } });
    const conversation = await db.aiConversation.create({ data: { userId: actors.applicant, categoryId, categoryName: prefix, title: `${prefix} AI`, messages: { create: [{ role: "user", content: "Submitted issue", attachments: JSON.stringify([attachment]) }] }, draft: { create: { title: `${prefix} AI draft`, categoryId, description: "No external model called", attachments: JSON.stringify([attachment]) } } }, include: { draft: true } });
    const applicant = await db.user.findUniqueOrThrow({ where: { dingtalkUserId: actors.applicant }, include: { roleAssignments: true } });
    const ai = new AiService(db); const input = { draftId: conversation.draft!.id, version: conversation.draft!.version };
    const submitted = await ai.submit(conversation.id, input, applicant);
    assert.equal(await db.ticketCcRecipient.count({ where: { ticketId: submitted.ticket.id, userId: actors.cc } }), 1);
    const notices = await db.notification.count({ where: { ticketId: submitted.ticket.id } });
    assert.equal((await ai.submit(conversation.id, input, applicant)).ticket.id, submitted.ticket.id);
    assert.equal(await db.notification.count({ where: { ticketId: submitted.ticket.id } }), notices);
    await db.aiMessage.create({ data: { conversationId: conversation.id, role: "user", content: "Private later message" } });
    const context = await json(`/api/ai/ticket-context?ticketId=${submitted.ticket.id}`, "cc");
    assert.equal(context.conversation.messages.length, 1); assert.ok(!JSON.stringify(context).includes("Private later message"));
    await json(`/api/ai/conversations/${conversation.id}`, "cc", {}, 404);
    assert.equal((await request(attachment.url, "cc")).status, 200);
  });
});
