import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { AiAttachment, AiStreamEvent } from "../src/lib/ai";

// These tests cannot use a dotenv file, a remote database, a real model, or real DingTalk delivery.
test("AI assistant isolated MySQL and local HTTP integration", { skip: process.env.RUN_LOCAL_DB_TESTS !== "1" }, async (t) => {
  const database = new URL(process.env.DATABASE_URL || "invalid:");
  assert.equal(database.protocol, "mysql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "33427");
  assert.equal(database.pathname, "/itdesk_local");
  assert.equal(database.username, "local_app");
  assert.equal(process.env.ITDESK_LOCAL_ISOLATED, "1");
  assert.equal(process.env.NODE_ENV, "development");
  assert.equal(process.env.DEV_AUTH_ENABLED, "true");
  assert.equal(process.env.DINGTALK_MOCK_ENABLED, "true");
  assert.equal(process.env.NEXT_PUBLIC_LOCAL_DEMO, "true");
  assert.equal(process.env.AI_LOCAL_DEMO_ENABLED, "true");
  const origin = new URL(process.env.LOCAL_HTTP_TEST_ORIGIN || "http://127.0.0.1:3100");
  assert.equal(origin.href, "http://127.0.0.1:3100/");
  const uploads = path.join(process.cwd(), ".local-dev", "uploads");
  assert.equal(path.resolve(process.env.UPLOAD_DIR || "invalid"), uploads);

  const [{ PrismaClient }, { AiService }, { DEFAULT_AI_SETTINGS, getCategoryConfig, saveCategoryConfig }, { buildContext }, { storeOwnedUpload }, { default: sharp }] = await Promise.all([
    import("@prisma/client"), import("../src/server/services/aiService"), import("../src/server/ai/config"),
    import("../src/server/ai/context"), import("../src/server/upload-storage"), import("sharp")
  ]);
  const prisma = new PrismaClient({ datasourceUrl: database.href });
  const prefix = `ai-test-${randomUUID().slice(0, 12)}`;
  const files: string[] = [];
  // Configuration is injected only into this service instance; the user's saved settings are never modified.
  const settings = { ...DEFAULT_AI_SETTINGS, apiKey: undefined, supportsVision: true, dailyMessageLimit: 50 };
  const isolatedDb = new Proxy(prisma, {
    get(target, property) {
      if (property === "systemConfig") return new Proxy(target.systemConfig, {
        get(config, method) {
          if (method === "findUnique") return async (args: { where: { configKey: string } }) => args.where.configKey === "ai.settings.v1"
            ? { configKey: "ai.settings.v1", configValue: JSON.stringify(settings) }
            : config.findUnique(args);
          const value = Reflect.get(config, method);
          return typeof value === "function" ? value.bind(config) : value;
        }
      });
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const service = new AiService(isolatedDb);
  const createUser = (suffix: string, role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN") => prisma.user.create({
    data: { dingtalkUserId: `${prefix}-${suffix}`, name: `AI test ${suffix}`, roleAssignments: { create: { role } } }, include: { roleAssignments: true }
  });
  const [applicant, outsider, handler, admin, limited] = await Promise.all([
    createUser("applicant", "EMPLOYEE"), createUser("outsider", "EMPLOYEE"), createUser("handler", "IT_HANDLER"), createUser("admin", "SUPER_ADMIN"), createUser("limited", "EMPLOYEE")
  ]);
  const users = { applicant, outsider, handler, admin, limited };
  const category = await prisma.ticketCategory.create({ data: { name: `${prefix}-网络`, defaultHandlerUserId: handler.dingtalkUserId, defaultHandlerName: handler.name, firstResponseMinutes: 60, resolveMinutes: 120 } });
  const disabledCategory = await prisma.ticketCategory.create({ data: { name: `${prefix}-停用`, enabled: false } });
  const conversation = await service.create({ categoryId: category.id, title: `${prefix} 网络故障` }, applicant);
  const outsiderConversation = await service.create({ categoryId: category.id }, outsider);
  const history = await service.create({ categoryId: category.id, title: `${prefix} 昨日故障` }, applicant);
  let attachment: AiAttachment;
  let excludedAttachment: AiAttachment;
  let draft: Awaited<ReturnType<typeof service.createDraft>>;
  let ticketId = "";

  t.after(async () => {
    try {
      const tickets = await prisma.ticket.findMany({ where: { applicantUserId: { startsWith: prefix } }, select: { id: true } });
      await prisma.notification.deleteMany({ where: { ticketId: { in: tickets.map(row => row.id) } } });
      await prisma.ticket.deleteMany({ where: { applicantUserId: { startsWith: prefix } } });
      await prisma.aiConversation.deleteMany({ where: { userId: { startsWith: prefix } } });
      await prisma.aiDailyUsage.deleteMany({ where: { userId: { startsWith: prefix } } });
      const categories = await prisma.ticketCategory.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } });
      await prisma.systemConfig.deleteMany({ where: { configKey: { in: categories.map(row => `ai.category.${row.id}`) } } });
      await prisma.ticketCategory.deleteMany({ where: { name: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { dingtalkUserId: { startsWith: prefix } } });
      for (const file of files) {
        assert.match(file, /^[a-f0-9-]+\.png$/);
        for (const target of [path.join(uploads, file), path.join(uploads, ".owners", `${file}.json`)]) {
          await unlink(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
      }
    } finally { await prisma.$disconnect(); }
  });

  async function ask(id: string, content: string, extra: Record<string, unknown> = {}) {
    const events: AiStreamEvent[] = [];
    const prepared = await service.prepareMessage(id, { content, attachments: [], clientRequestId: randomUUID(), demo: true, ...extra }, applicant);
    await service.respond(prepared, event => events.push(event));
    assert.equal(events.some(event => event.type === "error"), false, JSON.stringify(events));
    assert.ok(events.some(event => event.type === "done"));
    return events;
  }

  await t.test("long Chinese category rules and revision history fit the configuration column", async () => {
    let version = 0;
    for (let i = 0; i < 3; i++) {
      const config = await saveCategoryConfig(disabledCategory.id, { enabled: false, prompt: "规".repeat(12000), environment: "环".repeat(20000), examples: ["测试示例"], version }, admin, prisma);
      version = config.version;
    }
    const stored = await prisma.systemConfig.findUniqueOrThrow({ where: { configKey: `ai.category.${disabledCategory.id}` } });
    assert.ok(Buffer.byteLength(stored.configValue, "utf8") > 65535);
    assert.equal(JSON.parse(stored.configValue).version, 3);
  });

  await t.test("conversation owner isolation and valid category selection are enforced by the service", async () => {
    await assert.rejects(service.detail(conversation.id, outsider), (error: any) => error.code === "AI_CONVERSATION_NOT_FOUND");
    await assert.rejects(service.update(conversation.id, { title: "stolen" }, outsider), (error: any) => error.code === "AI_CONVERSATION_NOT_FOUND");
    await assert.rejects(service.remove(conversation.id, outsider), (error: any) => error.code === "AI_CONVERSATION_NOT_FOUND");
    await assert.rejects(service.create({ categoryId: disabledCategory.id }, applicant), (error: any) => error.code === "AI_INVALID_INPUT");
    assert.equal((await service.list(outsider)).some(item => item.id === conversation.id), false);
    await assert.rejects(service.prepareMessage(conversation.id, { content: "偷看历史", clientRequestId: randomUUID(), demo: true, referenceConversationIds: [outsiderConversation.id] }, applicant), (error: any) => error.code === "AI_INVALID_INPUT");
    const categoryConfig = await getCategoryConfig(category.id, isolatedDb);
    await prisma.systemConfig.create({ data: { configKey: `ai.category.${category.id}`, configValue: JSON.stringify({ ...categoryConfig, enabled: true }) } });
    await prisma.ticketCategory.update({ where: { id: category.id }, data: { enabled: false } });
    try {
      await assert.rejects(service.prepareMessage(conversation.id, { content: "停用分类不可继续咨询", clientRequestId: randomUUID(), demo: true }, applicant), (error: any) => error.code === "AI_INVALID_INPUT");
    } finally {
      await prisma.ticketCategory.update({ where: { id: category.id }, data: { enabled: true } });
    }
  });

  await t.test("private historical pictures are re-read only for their authorized owner", async () => {
    const fileName = `${randomUUID()}.png`;
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#287dd1" } }).png().toBuffer();
    await storeOwnedUpload(fileName, bytes, applicant.dingtalkUserId);
    files.push(fileName);
    attachment = { name: "昨日错误截图.png", url: `/api/uploads/${fileName}`, size: bytes.length, type: "image/png" };
    await assert.rejects(service.prepareMessage(outsiderConversation.id, { content: "借用别人的图片", attachments: [attachment], clientRequestId: randomUUID(), demo: true }, outsider), (error: any) => error.code === "UPLOAD_FORBIDDEN");
    await ask(history.id, "昨日网络断开时的截图", { attachments: [attachment] });
    const prior = await service.own(history.id, applicant);
    const current = await service.own(conversation.id, applicant);
    const context = await buildContext({ settings, category: await getCategoryConfig(category.id, isolatedDb), user: applicant, messages: current.messages, histories: [prior] });
    const parts = context.flatMap(item => Array.isArray(item.content) ? item.content : []);
    assert.equal(parts.filter(part => part.type === "image_url").length, 1);
    assert.ok(parts.some(part => part.type === "image_url" && part.image_url.url.startsWith("data:image/jpeg;base64,")));
    const text = JSON.stringify(context);
    assert.ok(text.includes("用户引用的历史问题"));
    assert.ok(text.includes("昨日网络断开时的截图"));
    const excludedName = `${randomUUID()}.png`;
    await storeOwnedUpload(excludedName, bytes, applicant.dingtalkUserId);
    files.push(excludedName);
    excludedAttachment = { name: "不随工单提交的图片.png", url: `/api/uploads/${excludedName}`, size: bytes.length, type: "image/png" };
    await ask(conversation.id, "今天还是同样的问题，请结合昨天的图片", { referenceConversationIds: [history.id], attachments: [attachment, excludedAttachment] });
  });

  await t.test("message request IDs and conversation locks prevent duplicate prompts and duplicate quota charges", async () => {
    const requestId = randomUUID();
    const payload = { content: "确认仅本机不能访问", attachments: [], clientRequestId: requestId, demo: true };
    const first = await service.prepareMessage(conversation.id, payload, applicant);
    assert.equal(first.reused, false);
    const usageBefore = await prisma.aiDailyUsage.findFirstOrThrow({ where: { userId: applicant.dingtalkUserId } });
    const duplicate = await service.prepareMessage(conversation.id, payload, applicant);
    assert.equal(duplicate.reused, true);
    assert.equal((await prisma.aiDailyUsage.findFirstOrThrow({ where: { id: usageBefore.id } })).count, usageBefore.count);
    await assert.rejects(service.prepareMessage(conversation.id, { ...payload, clientRequestId: randomUUID() }, applicant), (error: any) => error.code === "AI_BUSY");
    await service.respond(first, () => undefined);
    assert.equal(await prisma.aiMessage.count({ where: { requestKey: `${conversation.id}:${requestId}` } }), 1);
    const completed = await service.prepareMessage(conversation.id, payload, applicant);
    assert.equal(completed.reused, true);
    assert.equal((await prisma.aiDailyUsage.findFirstOrThrow({ where: { id: usageBefore.id } })).count, usageBefore.count);
  });

  await t.test("follow-up pairs survive real database reload without becoming diagnosis context", async () => {
    const detail = await service.detail(conversation.id, applicant);
    const answers = detail.messages!.filter(row => row.role === "assistant" && row.status === "COMPLETE");
    assert.ok(answers.length >= 2);
    for (const answer of answers) {
      assert.equal(answer.suggestions?.length, 2);
      assert.ok(!answer.content.includes("itdesk_suggestions"));
      const stored = await prisma.aiMessage.findUniqueOrThrow({ where: { id: answer.id } });
      assert.deepEqual(JSON.parse(stored.suggestions!), answer.suggestions);
    }
    const original = await service.own(conversation.id, applicant);
    const categoryConfig = await getCategoryConfig(category.id, isolatedDb);
    const context = JSON.stringify(await buildContext({ settings, category: categoryConfig, user: applicant, messages: original.messages, histories: [] }));
    for (const suggestion of answers.at(-1)!.suggestions!) assert.ok(!context.includes(suggestion));
    const old = await prisma.aiMessage.create({ data: { conversationId: history.id, role: "assistant", content: "旧版本的排查说明" } });
    const oldDto = (await service.detail(history.id, applicant)).messages!.find(row => row.id === old.id)!;
    assert.deepEqual(oldDto.suggestions, []);
    assert.equal(oldDto.content, "旧版本的排查说明");
  });

  await t.test("concurrent conversations share an atomic per-user daily limit", async () => {
    const left = await service.create({ categoryId: category.id }, limited);
    const right = await service.create({ categoryId: category.id }, limited);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await prisma.aiDailyUsage.create({ data: { id: `${limited.id}:${day}`, userId: limited.dingtalkUserId, day, count: 0 } });
    settings.dailyMessageLimit = 1;
    try {
      const results = await Promise.allSettled([left, right].map(item => service.prepareMessage(item.id, { content: "同一天额度测试", clientRequestId: randomUUID(), demo: true }, limited)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "AI_DAILY_LIMIT");
      assert.equal((await prisma.aiDailyUsage.findUniqueOrThrow({ where: { id: `${limited.id}:${day}` } })).count, 1);
      for (const result of results) if (result.status === "fulfilled") await service.respond(result.value, () => undefined);
      assert.equal(await prisma.aiMessage.count({ where: { conversationId: { in: [left.id, right.id] }, role: "user" } }), 1);
    } finally { settings.dailyMessageLimit = 50; }
  });

  await t.test("draft versions reject stale edits and stale submits without creating a ticket", async () => {
    const generated = await Promise.all([
      service.createDraft(conversation.id, applicant, { useModel: false }),
      service.createDraft(conversation.id, applicant, { useModel: false })
    ]);
    assert.equal(generated[0].id, generated[1].id);
    assert.equal(await prisma.aiTicketDraft.count({ where: { conversationId: conversation.id } }), 1);
    draft = generated[0];
    const original = draft;
    draft = await service.updateDraft(conversation.id, { ...original, title: `${prefix} 确认报修`, description: "仅本机无法访问内部系统，重连网络后仍未恢复。", attachments: [attachment] }, applicant);
    assert.equal(draft.version, original.version + 1);
    await assert.rejects(service.updateDraft(conversation.id, { ...original, title: "过期修改" }, applicant), (error: any) => error.code === "AI_DRAFT_CHANGED");
    await assert.rejects(service.submit(conversation.id, { draftId: draft.id, version: original.version }, applicant), (error: any) => error.code === "AI_DRAFT_CHANGED");
    assert.equal(await prisma.ticket.count({ where: { aiConversationId: conversation.id } }), 0);
  });

  await t.test("simultaneous confirmations create one ticket, one creation log and one notification per recipient", async () => {
    const payload = { draftId: draft.id, version: draft.version };
    const results = await Promise.all([service.submit(conversation.id, payload, applicant), service.submit(conversation.id, payload, applicant)]);
    assert.equal(results[0].ticket.id, results[1].ticket.id);
    ticketId = results[0].ticket.id;
    assert.equal(await prisma.ticket.count({ where: { aiConversationId: conversation.id } }), 1);
    assert.equal(await prisma.ticketLog.count({ where: { ticketId, actionType: "CREATE" } }), 1);
    assert.equal(await prisma.notification.count({ where: { ticketId, notificationType: "TICKET_CREATED" } }), 1);
    assert.equal(await prisma.notification.count({ where: { ticketId, notificationType: "NEW_TICKET_PENDING" } }), 1);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(ticket.applicantUserId, applicant.dingtalkUserId);
    assert.equal(ticket.handlerUserId, handler.dingtalkUserId);
    assert.ok(ticket.slaFirstResponseDeadline && ticket.slaResolveDeadline);
    assert.match(ticket.attachments || "", /昨日错误截图/);
  });

  await t.test("ticket context is an immutable authorized snapshot, and deleting the chat preserves the ticket", async () => {
    assert.ok(ticketId);
    const before = await service.ticketContext(ticketId, handler);
    assert.ok(before.conversation?.messages?.length);
    assert.ok(JSON.stringify(before).includes(attachment.url));
    assert.equal(JSON.stringify(before).includes(excludedAttachment.url), false, "removed draft images must not remain in the ticket snapshot");
    await assert.rejects(service.ticketContext(ticketId, outsider), (error: any) => error.code === "FORBIDDEN");
    await ask(conversation.id, "提交后的私人补充不得进入之前的工单快照");
    const after = await service.ticketContext(ticketId, handler);
    assert.deepEqual(after, before);
    assert.equal(JSON.stringify(after).includes("提交后的私人补充"), false);
    await service.remove(conversation.id, applicant);
    assert.equal(await prisma.aiMessage.count({ where: { conversationId: conversation.id } }), 0);
    assert.ok(await prisma.ticket.findUnique({ where: { id: ticketId } }));
    assert.deepEqual(await service.ticketContext(ticketId, handler), before);
  });

  await t.test("local HTTP enforces permissions, private history and explicit demo SSE", { skip: process.env.RUN_LOCAL_HTTP_TESTS !== "1" }, async () => {
    async function request(route: string, actor: keyof typeof users, method = "GET", body?: unknown) {
      assert.ok(route.startsWith("/") && !route.startsWith("//"));
      return fetch(new URL(route, origin), { method, headers: { "x-dingtalk-userid": users[actor].dingtalkUserId, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(30000) });
    }
    async function json(route: string, actor: keyof typeof users, method = "GET", body?: unknown, status = 200) {
      const response = await request(route, actor, method, body);
      const result = await response.json();
      assert.equal(response.status, status, `${route}: ${result.code || ""} ${result.message || ""}`);
      return result.data;
    }
    // The generated identity proves this HTTP server uses the same isolated database before any writes.
    assert.equal((await json("/api/me", "applicant")).dingtalkUserId, applicant.dingtalkUserId);
    await json("/api/admin/ai/settings", "applicant", "GET", undefined, 403);
    await json("/api/admin/ai/settings", "applicant", "PUT", { apiKey: "forbidden-test-value" }, 403);
    const bootstrap = await json("/api/ai/bootstrap", "applicant");
    assert.equal(bootstrap.assistantName, "趣然IT工单智能助手");
    assert.equal(bootstrap.localDemoAvailable, true);
    const created = await json("/api/ai/conversations", "applicant", "POST", { categoryId: category.id }, 201);
    await json(`/api/ai/conversations/${created.id}`, "outsider", "GET", undefined, 404);
    const payload = { content: "本地接口排查测试", clientRequestId: randomUUID(), demo: true };
    const response = await request(`/api/ai/conversations/${created.id}/messages`, "applicant", "POST", payload);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const text = await response.text();
    assert.ok(text.includes('"type":"done"'), text);
    assert.ok(text.includes("本地模拟回答"), text);
    assert.equal(text.includes('"type":"error"'), false, text);
    const repeated = await request(`/api/ai/conversations/${created.id}/messages`, "applicant", "POST", payload);
    assert.equal(repeated.status, 200);
    assert.ok((await repeated.text()).includes('"type":"done"'));
    assert.equal(await prisma.aiMessage.count({ where: { requestKey: `${created.id}:${payload.clientRequestId}` } }), 1);
    await json(`/api/ai/conversations/${created.id}/messages`, "applicant", "POST", { content: "非法历史引用", clientRequestId: randomUUID(), demo: true, referenceConversationIds: [outsiderConversation.id] }, 400);
    const inProgress = await service.prepareMessage(created.id, { content: "锁定状态测试", clientRequestId: randomUUID(), demo: true }, applicant);
    try {
      await json(`/api/ai/conversations/${created.id}/draft`, "applicant", "POST", { demo: "true" }, 400);
      await json(`/api/ai/conversations/${created.id}/draft`, "applicant", "POST", { demo: true }, 409);
      assert.equal(await prisma.aiTicketDraft.count({ where: { conversationId: created.id } }), 0);
      // The server's internal auto-card may exist just before the answer releases its lock.
      // Public edit/submit must still wait; a caller cannot use demo=true to bypass that lock.
      const pendingDraft = await service.createDraft(created.id, applicant, { useModel: false });
      await json(`/api/ai/conversations/${created.id}/draft`, "applicant", "PUT", { ...pendingDraft, title: "不能在回答中覆盖卡片" }, 409);
      await json(`/api/ai/conversations/${created.id}/submit`, "applicant", "POST", { draftId: pendingDraft.id, version: pendingDraft.version }, 409);
      assert.equal(await prisma.ticket.count({ where: { aiConversationId: created.id } }), 0);
    } finally {
      await service.respond(inProgress, () => undefined);
    }
    await json(`/api/ai/ticket-context?ticketId=${ticketId}`, "outsider", "GET", undefined, 403);
    await json(`/api/ai/ticket-context?ticketId=${ticketId}`, "handler");
    await json(`/api/ai/conversations/${created.id}`, "applicant", "DELETE");
  });
});
