import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";

// Run only through the isolated local runner. No production/environment-file fallback.
test("isolated local HTTP workflow", { skip: process.env.RUN_LOCAL_HTTP_TESTS !== "1" }, async (t) => {
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
  const origin = new URL(process.env.LOCAL_HTTP_TEST_ORIGIN || "http://127.0.0.1:3100");
  assert.equal(origin.href, "http://127.0.0.1:3100/");
  const uploadDirectory = path.join(process.cwd(), ".local-dev", "uploads");
  assert.equal(path.resolve(process.env.UPLOAD_DIR || "invalid"), uploadDirectory);

  const [{ PrismaClient }, { default: sharp }] = await Promise.all([import("@prisma/client"), import("sharp")]);
  const prisma = new PrismaClient({ datasourceUrl: database.href });
  const prefix = `http-regression-${randomUUID()}`;
  const uploadedNames: string[] = [];
  const actors = { applicant: `${prefix}-applicant`, handler: `${prefix}-handler`, otherHandler: `${prefix}-handler-2`, admin: `${prefix}-admin`, outsider: `${prefix}-outsider` };
  let ticketId = "";
  let attachment: { name: string; url: string; size: number; type: string };

  t.after(async () => {
    try {
      const tickets = await prisma.ticket.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
      await prisma.notification.deleteMany({ where: { ticketId: { in: tickets.map((row) => row.id) } } });
      await prisma.knowledgeBase.deleteMany({ where: { maintainerUserId: { startsWith: prefix } } });
      await prisma.ticket.deleteMany({ where: { title: { startsWith: prefix } } });
      await prisma.ticketCategory.deleteMany({ where: { name: prefix } });
      await prisma.user.deleteMany({ where: { dingtalkUserId: { startsWith: prefix } } });
      for (const name of uploadedNames) {
        assert.match(name, /^[a-f0-9-]+\.(png|jpg|gif|webp)$/);
        await unlink(path.join(uploadDirectory, name)).catch((error) => { if (error.code !== "ENOENT") throw error; });
        await unlink(path.join(uploadDirectory, ".owners", `${name}.json`)).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
    } finally { await prisma.$disconnect(); }
  });

  for (const [actor, userId] of Object.entries(actors)) {
    const role = actor === "admin" ? "SUPER_ADMIN" : actor.toLowerCase().includes("handler") ? "IT_HANDLER" : "EMPLOYEE";
    await prisma.user.create({ data: { dingtalkUserId: userId, name: `HTTP test ${actor}`, roleAssignments: { create: { role } } } });
  }
  const category = await prisma.ticketCategory.create({ data: { name: prefix, defaultHandlerUserId: actors.handler, defaultHandlerName: "HTTP test handler", firstResponseMinutes: 60, resolveMinutes: 120 } });

  async function request(url: string, actor: keyof typeof actors, options: { method?: string; body?: unknown; form?: FormData } = {}) {
    assert.ok(url.startsWith("/") && !url.startsWith("//"));
    return fetch(new URL(url, origin), {
      method: options.method || "GET",
      headers: { "x-dingtalk-userid": actors[actor], ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: options.form || (options.body === undefined ? undefined : JSON.stringify(options.body)),
      redirect: "manual", signal: AbortSignal.timeout(30000)
    });
  }
  async function json(url: string, actor: keyof typeof actors, options: { method?: string; body?: unknown; form?: FormData } = {}, expectedStatus = 200) {
    const response = await request(url, actor, options);
    const body = await response.json();
    assert.equal(response.status, expectedStatus, `${url}: ${body.code || ""} ${body.message || ""}`);
    return body;
  }

  // A newly generated identity must resolve before any HTTP writes. This proves the target server uses this isolated database and development auth.
  for (const actor of Object.keys(actors) as (keyof typeof actors)[]) assert.equal((await json("/api/me", actor)).data.dingtalkUserId, actors[actor]);

  await t.test("real upload rejects spoofed image MIME and accepts a private decodable PNG", async () => {
    const invalid = new FormData(); invalid.set("file", new File(["NOT AN IMAGE"], "fake.jpg", { type: "image/jpeg" }));
    const rejected = await json("/api/uploads", "applicant", { method: "POST", form: invalid }, 400);
    assert.equal(rejected.code, "UPLOAD_IMAGE_ONLY");
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#287dd1" } }).png().toBuffer();
    const form = new FormData(); form.set("file", new File([png], `${prefix}.png`, { type: "image/png" }));
    const uploaded = await json("/api/uploads", "applicant", { method: "POST", form });
    attachment = uploaded.data;
    assert.match(attachment.url, /^\/api\/uploads\/[a-f0-9-]+\.png$/);
    uploadedNames.push(attachment.url.split("/").pop()!);
    const own = await request(attachment.url, "applicant");
    assert.equal(own.status, 200);
    assert.equal((await sharp(Buffer.from(await own.arrayBuffer())).metadata()).width, 8);
    await json(attachment.url, "outsider", {}, 403);
  });

  await t.test("ticket creation retains the uploaded image and pagination reaches every new record", async () => {
    assert.ok(attachment, "Upload stage failed");
    for (let index = 0; index < 3; index++) {
      const created = await json("/api/tickets", "applicant", { method: "POST", body: { title: `${prefix} ticket ${index}`, description: "Local HTTP regression only", categoryId: category.id, priority: "NORMAL", attachments: index === 0 ? [attachment] : [] } }, 201);
      if (index === 0) ticketId = created.data.ticket.id;
      assert.equal(created.data.ticket.status, "PENDING");
      assert.equal(created.data.ticket.handlerUserId, actors.handler);
    }
    const page1 = (await json(`/api/admin/tickets?page=1&pageSize=1&keyword=${prefix}`, "admin")).data;
    const page2 = (await json(`/api/admin/tickets?page=2&pageSize=1&keyword=${prefix}`, "admin")).data;
    assert.equal(page1.total, 3); assert.equal(page1.items.length, 1); assert.equal(page2.items.length, 1);
    assert.notEqual(page1.items[0].id, page2.items[0].id);
    const mine = (await json("/api/tickets/my?page=1&pageSize=2", "applicant")).data;
    assert.equal(mine.total, 3); assert.equal(mine.items.length, 2);
    await json(`/api/admin/tickets?page=0&pageSize=1`, "admin", {}, 400);
  });

  await t.test("detail and current/legacy attachment routes enforce ticket permissions", async () => {
    assert.ok(ticketId, "Create stage failed");
    assert.equal((await json(`/api/tickets/${ticketId}`, "applicant")).data.id, ticketId);
    await json(`/api/tickets/${ticketId}`, "outsider", {}, 403);
    await json(attachment.url, "outsider", {}, 403);
    await json(attachment.url.replace("/api/uploads/", "/uploads/"), "outsider", {}, 403);
    for (const actor of ["handler", "admin"] as const) {
      const response = await request(attachment.url, actor);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      await response.arrayBuffer();
    }
    const legacy = await request(attachment.url.replace("/api/uploads/", "/uploads/"), "applicant");
    assert.equal(legacy.status, 200); await legacy.arrayBuffer();
    await json("/api/tickets", "outsider", { method: "POST", body: { title: `${prefix} steal`, description: "Must be rejected", categoryId: category.id, priority: "NORMAL", attachments: [attachment] } }, 403);
  });

  await t.test("handler completion preserves logs and ignores retired knowledge draft requests", async () => {
    assert.ok(ticketId, "Create stage failed");
    const accepted = await json(`/api/tickets/${ticketId}/status`, "handler", { method: "POST", body: { status: "PROCESSING", remark: "HTTP test accepted" } });
    assert.equal(accepted.data.status, "PROCESSING"); assert.ok(accepted.data.firstResponseAt);
    const completed = await json(`/api/tickets/${ticketId}/resolve`, "handler", { method: "POST", body: { resultSummary: "HTTP test repaired", toKnowledgeBase: true } });
    assert.equal(completed.data.status, "COMPLETED"); assert.ok(completed.data.resolvedAt);
    assert.equal(await prisma.ticketLog.count({ where: { ticketId, actionType: "RESOLVE" } }), 1);
    assert.equal(await prisma.knowledgeBase.count({ where: { sourceTicketId: ticketId } }), 0);
  });

  await t.test("employee ratings work, the removed confirmation stays disabled, and finished tickets cannot transfer", async () => {
    assert.ok(ticketId, "Create stage failed");
    await json(`/api/tickets/${ticketId}/satisfaction`, "applicant", { method: "POST", body: { level: "NORMAL" } }, 400);
    const rated = await json(`/api/tickets/${ticketId}/satisfaction`, "applicant", { method: "POST", body: { level: "SATISFIED", comment: "HTTP test satisfied" } });
    assert.equal(rated.data.satisfactionLevel, "SATISFIED");
    const confirmation = await json(`/api/tickets/${ticketId}/confirm`, "applicant", { method: "POST", body: {} }, 410);
    assert.equal(confirmation.code, "CONFIRM_DISABLED");
    await json(`/api/tickets/${ticketId}/transfer`, "handler", { method: "POST", body: { handlerUserId: actors.otherHandler } }, 400);
    await json(`/api/admin/tickets/${ticketId}/assign`, "admin", { method: "POST", body: { handlerUserId: actors.otherHandler } }, 400);
    const unchanged = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(unchanged.status, "COMPLETED"); assert.equal(unchanged.handlerUserId, actors.handler);
  });
});
