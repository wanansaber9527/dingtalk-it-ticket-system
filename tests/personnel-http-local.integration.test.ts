import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("personnel lifecycle across real local HTTP: retained tickets, CC, settings, logs and revoked sessions", { skip: process.env.RUN_LOCAL_HTTP_TESTS !== "1" }, async (t) => {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(process.env.ITDESK_LOCAL_ISOLATED, "1");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "33427"); assert.equal(url.pathname, "/itdesk_local");
  assert.equal(process.env.DINGTALK_MOCK_ENABLED, "true");
  const [{ PrismaClient }, { PersonnelIdentityService }, { createAuthCookieValue }] = await Promise.all([
    import("@prisma/client"), import("../src/server/services/personnelIdentityService"), import("../src/server/auth-session")
  ]);
  const db = new PrismaClient();
  const prefix = `life-http-${randomUUID().slice(0, 8)}`;
  const service = new PersonnelIdentityService(db);
  const actors: Record<string, string> = {};
  const ids: string[] = [];
  let categoryId = "";
  let ticketId = "";
  const originalState = await db.directorySyncState.findUnique({ where: { id: "directory" } });
  const originalRuns = (await db.directorySyncRun.findMany({ select: { id: true } })).map((r) => r.id);
  const newPerson = async (key: string, role: "SUPER_ADMIN" | "IT_HANDLER" | "EMPLOYEE") => {
    const external = `${prefix}-${key}`; actors[key] = external;
    const { user } = await service.upsertDirectoryPerson({ dingtalkUserId: external, name: key, unionId: `${prefix}-union-${key}` }, { source: "SYNC", corpId: "local-corp" });
    ids.push(user.id);
    if (role !== "EMPLOYEE") await db.userRoleAssignment.create({ data: { userId: user.id, role } });
    return db.user.findUniqueOrThrow({ where: { id: user.id }, include: { roleAssignments: true } });
  };
  async function call(path: string, actor: string, options: { method?: string; body?: unknown; cookie?: string } = {}, status = 200) {
    const response = await fetch(`http://127.0.0.1:3100${path}`, {
      method: options.method || "GET", headers: { ...(options.cookie ? { cookie: `it_session=${options.cookie}` } : { "x-dingtalk-userid": actors[actor] }), ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(30_000)
    });
    const data = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`); return data.data;
  }
  t.after(async () => {
    try {
      await db.notification.deleteMany({ where: { OR: [{ receiverPersonId: { in: ids } }, { ticketId }] } });
      await db.ticket.deleteMany({ where: { title: { startsWith: prefix } } });
      await db.ticketCategory.deleteMany({ where: { name: prefix } });
      await db.personnelIdentityAudit.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.directorySyncRun.deleteMany({ where: { id: { notIn: originalRuns } } });
      if (originalState) await db.directorySyncState.update({ where: { id: "directory" }, data: originalState });
      else await db.directorySyncState.deleteMany({ where: { id: "directory" } });
    } finally { await db.$disconnect(); }
  });
  const admin = await newPerson("admin", "SUPER_ADMIN");
  const employee = await newPerson("employee", "EMPLOYEE");
  const handler = await newPerson("handler", "IT_HANDLER");
  const copied = await newPerson("copied", "EMPLOYEE");
  await newPerson("outsider", "EMPLOYEE");

  await t.test("settings and persistent logs are administrator-only and configurable", async () => {
    for (const endpoint of ["sync-settings", "sync-logs"]) await call(`/api/admin/users/${endpoint}`, "employee", {}, 403);
    const saved = await call("/api/admin/users/sync-settings", "admin", { method: "PUT", body: { enabled: false, intervalMinutes: 60 } });
    assert.equal(saved.intervalMinutes, 60); assert.equal(saved.enabled, false);
    await call("/api/admin/users/sync-settings", "admin", { method: "PUT", body: { enabled: true, intervalMinutes: 0 } }, 400);
    const result = await call("/api/admin/users/sync-dingtalk", "admin", { method: "POST" });
    assert.ok(result.runId); assert.equal(result.status, "PARTIAL");
    const logs = await call(`/api/admin/users/sync-logs?keyword=${prefix}&status=PARTIAL`, "admin");
    assert.ok(logs.items.some((r: { id: string }) => r.id === result.runId));
    const detail = await call(`/api/admin/users/sync-logs/${result.runId}`, "admin");
    assert.ok(detail.items.some((row: { externalUserId: string; action: string }) => row.externalUserId === employee.dingtalkUserId && row.action === "PENDING"));
    assert.equal("lockToken" in detail, false);
    await call(`/api/admin/users/sync-logs/${result.runId}`, "outsider", {}, 403);
  });
  await t.test("new ticket persists permanent applicant, handler and CC identity", async () => {
    const category = await call("/api/admin/categories", "admin", { method: "POST", body: { name: prefix, defaultHandlerUserId: handler.dingtalkUserId, ccUserIds: [copied.dingtalkUserId] } }, 201);
    categoryId = category.id;
    const created = await call("/api/tickets", "employee", { method: "POST", body: { title: prefix, description: "Retained lifecycle history", categoryId, priority: "NORMAL" } }, 201);
    ticketId = created.ticket.id;
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { ccRecipients: true } });
    assert.equal(ticket.applicantId, employee.id); assert.equal(ticket.handlerId, handler.id); assert.equal(ticket.ccRecipients[0].personId, copied.id);
  });
  await t.test("archive removes active listing, keeps tickets and blocks old and current sessions", async () => {
    const oldCookie = createAuthCookieValue(employee);
    await call(`/api/admin/users/${employee.id}/archive`, "outsider", { method: "POST", body: { reason: "unauthorized" } }, 403);
    await call(`/api/admin/users/${employee.id}/archive`, "admin", { method: "POST", body: { reason: "Local departure confirmed" } });
    assert.equal(await db.ticket.count({ where: { id: ticketId } }), 1);
    const active = await call(`/api/admin/users?keyword=${prefix}&employment=ACTIVE`, "admin");
    assert.ok(!active.some((u: { id: string }) => u.id === employee.id));
    const archived = await call(`/api/admin/users?keyword=${prefix}&employment=DEPARTED`, "admin");
    assert.ok(archived.some((u: { id: string }) => u.id === employee.id));
    await call(`/api/tickets/${ticketId}`, "employee", {}, 403);
    await call(`/api/tickets/${ticketId}`, "employee", { cookie: oldCookie }, 403);
    const restored = await service.upsertDirectoryPerson({ dingtalkUserId: `${prefix}-new-employee`, name: "employee返聘", unionId: `${prefix}-union-employee` }, { source: "SYNC", corpId: "local-corp" });
    actors.employee = restored.user.dingtalkUserId;
    assert.equal(restored.user.id, employee.id); assert.equal(restored.action, "RESTORED");
    const mine = await call("/api/tickets/my?page=1&pageSize=20", "employee");
    assert.ok(mine.items.some((row: { id: string }) => row.id === ticketId));
    assert.equal((await call(`/api/tickets/${ticketId}`, "employee")).permissions.canComment, true);
    await call(`/api/tickets/${ticketId}`, "employee", { cookie: oldCookie }, 401);
    await call(`/api/tickets/${ticketId}`, "outsider", {}, 403);
    const historical = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(historical.applicantUserId, employee.dingtalkUserId); assert.equal(historical.applicantName, "employee");
  });
  await t.test("departed handlers require reassignment; returning CC retains read-only history", async () => {
    await call(`/api/admin/users/${handler.id}/archive`, "admin", { method: "POST", body: { reason: "Local handler departure" } });
    const list = await call("/api/admin/tickets?needsReassignment=true&page=1&pageSize=20", "admin");
    assert.ok(list.items.some((row: { id: string }) => row.id === ticketId));
    assert.equal((await db.ticketCategory.findUniqueOrThrow({ where: { id: categoryId } })).defaultHandlerUserId, null);
    const rehiredHandler = await service.upsertDirectoryPerson({ dingtalkUserId: `${prefix}-new-handler`, name: "handler返聘", unionId: `${prefix}-union-handler` }, { source: "SYNC", corpId: "local-corp" });
    actors.handler = rehiredHandler.user.dingtalkUserId;
    assert.ok((await call("/api/admin/tickets?needsReassignment=true&page=1&pageSize=20", "admin")).items.some((row: { id: string }) => row.id === ticketId));
    assert.ok((await call(`/api/admin/tickets?handlerUserId=${actors.handler}&page=1&pageSize=20`, "admin")).items.some((row: { id: string }) => row.id === ticketId));
    await call(`/api/admin/users/${copied.id}/archive`, "admin", { method: "POST", body: { reason: "Local CC departure" } });
    const restored = await service.upsertDirectoryPerson({ dingtalkUserId: `${prefix}-new-copied`, name: "copied返聘", unionId: `${prefix}-union-copied` }, { source: "LOGIN", corpId: "local-corp" });
    actors.copied = restored.user.dingtalkUserId;
    assert.equal((await call(`/api/tickets/${ticketId}`, "copied")).permissions.isCcOnly, true);
    assert.ok((await call("/api/tickets/my?scope=cc&page=1&pageSize=20", "copied")).items.some((row: { id: string }) => row.id === ticketId));
    await call(`/api/tickets/${ticketId}/comments`, "copied", { method: "POST", body: { remark: "Forbidden CC write" } }, 403);
    assert.ok(await db.personnelIdentityAudit.count({ where: { userId: copied.id } }));
  });
  void admin;
});
