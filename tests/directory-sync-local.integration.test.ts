import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("directory synchronization persists schedules, lifecycle logs and mutual exclusion in local MySQL", { skip: process.env.RUN_LOCAL_DB_TESTS !== "1" }, async (t) => {
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "33427");
  assert.equal(url.pathname, "/itdesk_local");
  const [{ PrismaClient }, { DirectorySyncService }, { PersonnelIdentityService, personnelCorpId }] = await Promise.all([
    import("@prisma/client"), import("../src/server/services/directorySyncService"), import("../src/server/services/personnelIdentityService")
  ]);
  const prisma = new PrismaClient();
  const prefix = `directory-regression-${randomUUID().slice(0, 8)}`;
  const oldState = await prisma.directorySyncState.findUnique({ where: { id: "directory" } });
  assert.ok(!oldState?.lockedBy || !oldState.lockedUntil || oldState.lockedUntil < new Date(), "另有同步正在执行，本地集成测试不能覆盖其锁");
  const runIds: string[] = [];
  // The test exercises real transactions while limiting directory candidates to its own generated identities.
  const scoped = new Proxy(prisma, { get(target, property) {
    if (property === "user") return new Proxy(target.user, { get(delegate, method) {
      if (method === "findMany") return (args: any) => delegate.findMany({ ...args, where: { AND: [args.where || {}, { dingtalkUserId: { startsWith: prefix } }] } });
      return Reflect.get(delegate, method);
    } });
    return Reflect.get(target, property);
  } });
  const corpId = personnelCorpId();
  const identities = new PersonnelIdentityService(prisma);
  let people = [{ dingtalkUserId: `${prefix}-employee`, name: `${prefix} Employee`, unionId: `${prefix}-union` }];
  let departures: any[] = [];
  const client = { listUsers: async () => people, listDepartures: async () => departures };
  const service = new DirectorySyncService(scoped, client as never);
  let admin: any;
  const run = async () => {
    const result = await service.run({ trigger: "MANUAL", operator: admin });
    assert.ok("runId" in result);
    runIds.push(result.runId);
    return result;
  };
  try {
    admin = await prisma.user.create({ data: { dingtalkUserId: `${prefix}-admin`, name: prefix, roleAssignments: { create: { role: "SUPER_ADMIN" } } }, include: { roleAssignments: true } });
    const initialAdmin = { dingtalkUserId: admin.dingtalkUserId, name: admin.name, unionId: `${prefix}-admin-union` };
    people.push(initialAdmin);
    await t.test("default config, manual creation and unchanged second run", async () => {
      await service.updateSettings({ enabled: true, intervalMinutes: 60 }, admin);
      const settings = await service.settings(admin);
      assert.equal(settings.intervalMinutes, 60);
      const first = await run();
      assert.equal(first.status, "SUCCESS");
      assert.equal(first.createdCount, 1);
      const second = await run();
      assert.equal(second.status, "SUCCESS");
      assert.equal(second.unchangedCount, 2);
      const logs = await service.logs(new URLSearchParams({ keyword: `${prefix} Employee` }), admin);
      assert.ok(logs.items.some((entry) => entry.id === first.runId));
      const detail = await service.logDetail(first.runId, admin);
      assert.ok(detail.items.some((entry) => entry.action === "CREATED"));
      assert.ok(detail.finishedAt);
    });
    await t.test("fresh departure archives the account and persists a distinct log item", async () => {
      const employee = await prisma.user.findUniqueOrThrow({ where: { dingtalkUserId: `${prefix}-employee` } });
      await prisma.user.update({ where: { id: employee.id }, data: { lastSyncedAt: new Date(Date.now() - 20_000), createdAt: new Date(Date.now() - 60_000) } });
      departures = [{ externalUserId: employee.dingtalkUserId, occurredAt: new Date(Date.now() - 10_000), reason: "本地测试明确离职记录" }];
      people = [initialAdmin];
      const result = await run();
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.departedCount, 1);
      const archived = await prisma.user.findUniqueOrThrow({ where: { id: employee.id } });
      assert.equal(archived.employmentStatus, "DEPARTED");
      assert.equal(archived.status, "DISABLED");
      assert.ok((await service.logDetail(result.runId, admin)).items.some((entry) => entry.action === "DEPARTED"));
    });
    await t.test("verified changed external identity restores the same internal person", async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { dingtalkUserId: `${prefix}-employee` } });
      people = [initialAdmin, { dingtalkUserId: `${prefix}-rehired`, name: `${prefix} Employee`, unionId: `${prefix}-union` }];
      const result = await run();
      assert.equal(result.restoredCount, 1);
      const after = await prisma.user.findUniqueOrThrow({ where: { dingtalkUserId: `${prefix}-rehired` } });
      assert.equal(after.id, before.id);
      assert.equal(after.employmentStatus, "ACTIVE");
      assert.ok(await prisma.userIdentity.findUnique({ where: { corpId_externalUserId: { corpId, externalUserId: `${prefix}-employee` } } }));
    });
    await t.test("two database-backed manual triggers claim only one lease", async () => {
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { entered = resolve; });
      const blockedClient = { ...client, listUsers: async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); return people; } };
      const first = new DirectorySyncService(scoped, blockedClient as never, identities).run({ trigger: "MANUAL", operator: admin });
      await waiting;
      await assert.rejects(service.run({ trigger: "MANUAL", operator: admin }), (error: any) => error.code === "SYNC_ALREADY_RUNNING");
      release();
      const result = await first;
      assert.ok("runId" in result);
      runIds.push(result.runId);
      assert.equal(result.status, "SUCCESS");
    });
    await t.test("a dead worker is recovered with a persistent failure reason", async () => {
      const stale = await prisma.directorySyncRun.create({ data: { trigger: "AUTO", status: "RUNNING", lockToken: `${prefix}-dead` } });
      runIds.push(stale.id);
      await prisma.directorySyncState.update({ where: { id: "directory" }, data: { lockedBy: `${prefix}-dead`, lockedUntil: new Date(0) } });
      await run();
      const recovered = await prisma.directorySyncRun.findUniqueOrThrow({ where: { id: stale.id } });
      assert.equal(recovered.status, "FAILED");
      assert.match(recovered.errorMessage || "", /中断/);
    });
  } finally {
    await prisma.directorySyncRun.deleteMany({ where: { OR: [{ id: { in: runIds } }, { operatorId: admin?.id || "none" }] } });
    await prisma.personnelIdentityAudit.deleteMany({ where: { userId: { in: (await prisma.user.findMany({ where: { dingtalkUserId: { startsWith: prefix } }, select: { id: true } })).map((row) => row.id) } } });
    await prisma.user.deleteMany({ where: { dingtalkUserId: { startsWith: prefix } } });
    if (oldState) await prisma.directorySyncState.upsert({ where: { id: "directory" }, update: oldState, create: oldState });
    else await prisma.directorySyncState.deleteMany({ where: { id: "directory" } });
    await prisma.$disconnect();
  }
});
