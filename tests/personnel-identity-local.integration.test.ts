import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// These lifecycle tests may only use the explicitly isolated local database.
test("personnel identities retain tickets across departure and verified rehire", { skip: process.env.RUN_LOCAL_DB_TESTS !== "1" }, async (t) => {
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "33427");
  assert.equal(url.pathname, "/itdesk_local");
  assert.equal(process.env.ITDESK_LOCAL_ISOLATED, "1");
  assert.equal(process.env.DINGTALK_MOCK_ENABLED, "true");
  const [{ PrismaClient }, { PersonnelIdentityService }, { UserService }, { getCurrentUser, createAuthCookieValue }] = await Promise.all([
    import("@prisma/client"), import("../src/server/services/personnelIdentityService"), import("../src/server/services/userService"), import("../src/server/auth")
  ]);
  const db = new PrismaClient();
  const service = new PersonnelIdentityService(db);
  const prefix = `personnel-${randomUUID().slice(0, 8)}`;
  const corpId = "local-corp";
  const now = new Date(Date.now() - 1000);
  const person = (key: string, unionId = key) => ({ dingtalkUserId: `${prefix}-${key}`, unionId: `${prefix}-${unionId}`, name: `${prefix} ${key}`, departmentName: "原部门", mobile: "10000000000" });
  const sync = (key: string, unionId = key) => service.upsertDirectoryPerson(person(key, unionId), { source: "SYNC", corpId, now: new Date() });
  const userIds: string[] = [];
  let categoryId = "";
  try {
    const admin = await db.user.create({ data: { dingtalkUserId: `${prefix}-admin`, name: `${prefix} admin`, roleAssignments: { create: { role: "SUPER_ADMIN" } } }, include: { roleAssignments: true } });
    userIds.push(admin.id);
    const initial = await sync("old", "stable");
    const employee = initial.user;
    userIds.push(employee.id);
    const category = await db.ticketCategory.create({ data: { name: prefix, defaultHandlerUserId: employee.dingtalkUserId, defaultHandlerName: employee.name,
      ccRecipients: { create: { userId: employee.dingtalkUserId, personId: employee.id } } } });
    categoryId = category.id;
    const ticket = await db.ticket.create({ data: { ticketNo: `${prefix}-original`, title: prefix, categoryName: "原分类", description: "保留历史", applicantUserId: employee.dingtalkUserId, applicantId: employee.id, applicantName: "原姓名", applicantDepartment: "原部门",
      handlerUserId: employee.dingtalkUserId, handlerId: employee.id, handlerName: "原处理人", status: "PROCESSING",
      ccRecipients: { create: { userId: employee.dingtalkUserId, personId: employee.id, userName: "原姓名" } } } });
    const oldCookie = createAuthCookieValue(employee);

    await t.test("repeated synchronization retains one identity and does not blank missing profile fields", async () => {
      const again = await service.upsertDirectoryPerson({ ...person("old", "stable"), departmentName: "", mobile: undefined }, { source: "SYNC", corpId, now });
      assert.equal(again.user.id, employee.id);
      assert.equal(again.action, "UNCHANGED");
      assert.equal(again.user.departmentName, "原部门");
      assert.equal(again.user.mobile, "10000000000");
      assert.equal(await db.userIdentity.count({ where: { userId: employee.id } }), 1);
    });

    await t.test("departure revokes privileged roles and assignments without deleting tickets", async () => {
      await db.userRoleAssignment.createMany({ data: [{ userId: employee.id, role: "SUPER_ADMIN" }, { userId: employee.id, role: "IT_HANDLER" }] });
      const archived = await service.archiveUser(employee.id, { source: "DINGTALK_DEPARTURE", reason: "本地离职证据", externalUserId: employee.dingtalkUserId, occurredAt: new Date() });
      assert.equal(archived.employmentStatus, "DEPARTED");
      assert.equal(archived.status, "DISABLED");
      assert.deepEqual(archived.roleAssignments.map((role) => role.role), ["EMPLOYEE"]);
      assert.equal((await db.ticketCategory.findUniqueOrThrow({ where: { id: category.id } })).defaultHandlerUserId, null);
      assert.equal(await db.categoryCcRecipient.count({ where: { categoryId: category.id } }), 0);
      const retained = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(retained.status, "PROCESSING");
      assert.equal(retained.applicantName, "原姓名");
      assert.equal(retained.handlerId, employee.id);
      await assert.rejects(getCurrentUser(new Request("http://127.0.0.1:3100/api/me", { headers: { cookie: `it_session=${oldCookie}` } })), (error: any) => error.code === "USER_DISABLED");
    });

    await t.test("verified new DingTalk ID restores the internal owner and never revives an old cookie", async () => {
      const rehire = await sync("new", "stable");
      assert.equal(rehire.action, "RESTORED");
      assert.equal(rehire.user.id, employee.id);
      assert.equal(rehire.user.dingtalkUserId, `${prefix}-new`);
      assert.equal(rehire.user.status, "ACTIVE");
      assert.deepEqual(rehire.user.roleAssignments.map((role) => role.role), ["EMPLOYEE"]);
      const retained = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(retained.applicantId, rehire.user.id);
      assert.equal(retained.applicantUserId, `${prefix}-old`);
      assert.equal(retained.applicantName, "原姓名");
      assert.equal(await db.ticketCcRecipient.count({ where: { ticketId: ticket.id, personId: rehire.user.id } }), 1);
      await assert.rejects(getCurrentUser(new Request("http://127.0.0.1:3100/api/me", { headers: { cookie: `it_session=${oldCookie}` } })), (error: any) => error.code === "SESSION_REVOKED");
      const current = await getCurrentUser(new Request("http://127.0.0.1:3100/api/me", { headers: { cookie: `it_session=${createAuthCookieValue(rehire.user)}` } }));
      assert.equal(current.id, employee.id);
    });

    await t.test("a retired account and a conflicting union identity cannot take over history", async () => {
      await assert.rejects(sync("old", "stable"), (error: any) => error.code === "PERSONNEL_IDENTITY_CONFLICT");
      await assert.rejects(sync("new", "someone-else"), (error: any) => error.code === "PERSONNEL_IDENTITY_CONFLICT");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).dingtalkUserId, `${prefix}-new`);
    });

    await t.test("manual disable survives departure and rehire", async () => {
      const manual = await sync("manual");
      userIds.push(manual.user.id);
      const users = new UserService(db);
      await users.updateStatus(manual.user.id, admin, "DISABLED");
      await service.archiveUser(manual.user.id, { source: "ADMIN_CONFIRMED", reason: "管理员核验离职", operatorId: admin.id });
      const restored = await sync("manual");
      assert.equal(restored.user.employmentStatus, "ACTIVE");
      assert.equal(restored.user.status, "DISABLED");
      assert.equal(restored.user.manuallyDisabled, true);
      await assert.rejects(users.addExecutor({ dingtalkUserId: restored.user.dingtalkUserId }, admin), (error: any) => error.code === "USER_DISABLED");
    });

    await t.test("a stale observation cannot undo a later departure", async () => {
      const old = await sync("stale");
      userIds.push(old.user.id);
      const observedAt = new Date(Date.now() - 1000);
      await service.archiveUser(old.user.id, { source: "ADMIN_CONFIRMED", reason: "人工离职核验", operatorId: admin.id });
      await assert.rejects(service.upsertDirectoryPerson(person("stale"), { source: "SYNC", corpId, now: observedAt }), (error: any) => error.code === "STALE_DIRECTORY_OBSERVATION");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: old.user.id } })).employmentStatus, "DEPARTED");
    });

    await t.test("missing historical union identity needs an audited live manual restore", async () => {
      const personWithoutUnion = { ...person("legacy"), unionId: undefined };
      const old = await service.upsertDirectoryPerson(personWithoutUnion, { source: "SYNC", corpId });
      userIds.push(old.user.id);
      await service.archiveUser(old.user.id, { source: "ADMIN_CONFIRMED", reason: "人工离职核验", operatorId: admin.id });
      await assert.rejects(service.upsertDirectoryPerson(personWithoutUnion, { source: "SYNC", corpId }), (error: any) => error.code === "PERSONNEL_REHIRE_REVIEW_REQUIRED");
      const wrongClient = new PersonnelIdentityService(db, { getUserDetail: async () => ({ userid: "wrong", name: "wrong" }) } as never);
      await assert.rejects(wrongClient.restoreArchivedUser(old.user.id, admin, "核对本人"), (error: any) => error.code === "PERSONNEL_IDENTITY_CONFLICT");
      const verified = new PersonnelIdentityService(db, { getUserDetail: async () => ({ userid: old.user.dingtalkUserId, name: old.user.name, unionid: `${prefix}-legacy-verified` }) } as never);
      const restored = await verified.restoreArchivedUser(old.user.id, admin, "已与人事核实本人返聘");
      assert.equal(restored.id, old.user.id);
      assert.equal(restored.status, "ACTIVE");
      assert.equal(restored.archivedAt, null);
      assert.equal(await db.personnelIdentityAudit.count({ where: { action: "MANUAL_RESTORE", userId: old.user.id, operatorId: admin.id } }), 1);
    });

    await t.test("identity scopes cannot move history to another enterprise", async () => {
      await assert.rejects(service.upsertDirectoryPerson(person("new", "stable"), { source: "SYNC", corpId: "another-corporation" }), (error: any) => error.code === "PERSONNEL_IDENTITY_CONFLICT");
      assert.equal(await db.userIdentity.count({ where: { userId: employee.id, corpId: "another-corporation" } }), 0);
    });

    await t.test("expired worker leases cannot change a person", async () => {
      await assert.rejects(service.upsertDirectoryPerson(person("expired"), { source: "SYNC", corpId, syncLockToken: "not-a-current-lock" }), (error: any) => error.code === "SYNC_LEASE_LOST");
      assert.equal(await db.user.count({ where: { dingtalkUserId: `${prefix}-expired` } }), 0);
    });

    await t.test("manual verified rehire merges both sets of tickets and records who confirmed it", async () => {
      const previous = await sync("historical");
      const current = await sync("fresh-account");
      userIds.push(previous.user.id, current.user.id);
      await service.archiveUser(previous.user.id, { source: "ADMIN_CONFIRMED", reason: "已离职", operatorId: admin.id });
      const makeTicket = (key: string, user: typeof employee) => db.ticket.create({ data: { ticketNo: `${prefix}-${key}`, title: prefix, categoryName: prefix, description: "身份合并", applicantUserId: user.dingtalkUserId, applicantId: user.id, applicantName: user.name } });
      const oldTicket = await makeTicket("older", previous.user);
      const newTicket = await makeTicket("newer", current.user);
      await db.aiConversation.create({ data: { userId: previous.user.dingtalkUserId, categoryId, categoryName: prefix, title: prefix } });
      await db.aiDailyUsage.createMany({ data: [
        { id: `${prefix}-usage-old`, userId: previous.user.dingtalkUserId, day: "2026-11-08", count: 2 },
        { id: `${prefix}-usage-new`, userId: current.user.dingtalkUserId, day: "2026-11-08", count: 3 }
      ] });
      await assert.rejects(service.linkRehire(current.user.id, previous.user.id, current.user, "同一员工身份核实"), (error: any) => error.code === "FORBIDDEN");
      const merged = await service.linkRehire(current.user.id, previous.user.id, admin, "经人事确认是同一员工，钉钉账号已更换");
      assert.equal(merged.id, previous.user.id);
      assert.equal(merged.dingtalkUserId, current.user.dingtalkUserId);
      const rows = await db.ticket.findMany({ where: { id: { in: [oldTicket.id, newTicket.id] } } });
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.applicantId === previous.user.id));
      const source = await db.user.findUniqueOrThrow({ where: { id: current.user.id } });
      assert.equal(source.mergedIntoId, previous.user.id);
      assert.equal(source.status, "DISABLED");
      assert.equal(await db.aiConversation.count({ where: { userId: current.user.dingtalkUserId, title: prefix } }), 1);
      assert.equal((await db.aiDailyUsage.findUniqueOrThrow({ where: { userId_day: { userId: current.user.dingtalkUserId, day: "2026-11-08" } } })).count, 5);
      assert.equal(await db.personnelIdentityAudit.count({ where: { action: "MANUAL_LINK", userId: previous.user.id, operatorId: admin.id } }), 1);
      const lists = new UserService(db);
      const active = await lists.list(admin, prefix);
      assert.ok(active.every((user) => user.employmentStatus === "ACTIVE" && !user.mergedIntoId));
    });
  } finally {
    await db.aiDailyUsage.deleteMany({ where: { userId: { startsWith: prefix } } });
    await db.aiConversation.deleteMany({ where: { title: prefix } });
    await db.ticket.deleteMany({ where: { ticketNo: { startsWith: prefix } } });
    await db.ticketCategory.deleteMany({ where: { name: prefix } });
    await db.personnelIdentityAudit.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { operatorId: { in: userIds } }] } });
    await db.userIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
