import test from "node:test";
import assert from "node:assert/strict";
import { DirectorySyncService, safeSyncError } from "../src/server/services/directorySyncService";

const admin = { id: "sync-admin", dingtalkUserId: "sync-admin", name: "Sync admin", status: "ACTIVE", employmentStatus: "ACTIVE", roleAssignments: [{ role: "SUPER_ADMIN" }] } as any;
const member = { ...admin, id: "employee", roleAssignments: [{ role: "EMPLOYEE" }] };
const person = { dingtalkUserId: "new-person", name: "New person", unionId: "union-new" };

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "OR") return condition.some((entry: any) => matches(row, entry));
    if (key === "AND") return condition.every((entry: any) => matches(row, entry));
    if (condition === undefined) return true;
    if (condition === null || typeof condition !== "object" || condition instanceof Date) return row[key] === condition;
    return Object.entries(condition).every(([op, value]: [string, any]) => {
      if (op === "lte") return row[key] <= value;
      if (op === "gt") return row[key] > value;
      if (op === "notIn") return !value.includes(row[key]);
      if (op === "not") return row[key] !== value;
      throw new Error(`Unsupported comparison ${op}`);
    });
  });
}

function harness() {
  let state: any = null;
  const runs: any[] = [];
  const items: any[] = [];
  const users: any[] = [];
  const changed: any[] = [];
  const archived: any[] = [];
  let gate = Promise.resolve();
  const db: any = {
    directorySyncState: {
      upsert: async ({ create }: any) => state ||= { lockedBy: null, lockedUntil: null, lastSuccessAt: null, ...create },
      update: async ({ data }: any) => Object.assign(state, data),
      updateMany: async ({ where, data }: any) => { if (!state || !matches(state, where)) return { count: 0 }; Object.assign(state, data); return { count: 1 }; },
      findUniqueOrThrow: async () => { if (!state) throw new Error("Missing state"); return { ...state }; }
    },
    directorySyncRun: {
      create: async ({ data }: any) => { const row = { id: `run-${runs.length}`, finishedAt: null, errorMessage: null, total: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, departedCount: 0, restoredCount: 0, pendingCount: 0, failedCount: 0, ...data }; runs.push(row); return row; },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of runs) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; },
      findFirst: async () => runs.at(-1) || null,
      findMany: async () => runs,
      count: async () => runs.length,
      findUnique: async ({ where }: any) => { const row = runs.find((entry) => entry.id === where.id); return row ? { ...row, items: items.filter((entry) => entry.runId === row.id) } : null; }
    },
    directorySyncItem: { create: async ({ data }: any) => { const row = { id: `item-${items.length}`, createdAt: new Date(), ...data }; items.push(row); return row; } },
    user: { findMany: async ({ where }: any) => users.filter((user) => matches(user, where)) },
    $transaction: async (fn: any) => {
      const previous = gate;
      let release!: () => void;
      gate = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone({ state, runs, items });
      try { return await fn(db); }
      catch (error) { state = snapshot.state; runs.splice(0, runs.length, ...snapshot.runs); items.splice(0, items.length, ...snapshot.items); throw error; }
      finally { release(); }
    }
  };
  const client = { listUsers: async () => [person], listDepartures: async () => [] as any[] };
  const identities = {
    upsertDirectoryPerson: async (input: any, options: any) => { changed.push({ input, options }); return { user: { id: "internal-new" }, action: "CREATED", changes: ["name"] }; },
    archiveUser: async (id: string, evidence: any) => { archived.push({ id, evidence }); return { id }; }
  };
  const service = new DirectorySyncService(db, client as never, identities as never);
  return { db, client, identities, service, runs, items, users, changed, archived, state: () => state };
}

test("directory scheduler persists default sixty minutes and obeys enable / due settings", async () => {
  const h = harness();
  const settings = await h.service.settings(admin);
  assert.equal(settings.intervalMinutes, 60);
  assert.equal(settings.enabled, true);
  assert.ok(settings.nextRunAt.getTime() - Date.now() > 59 * 60_000);
  assert.deepEqual(await h.service.run({ trigger: "AUTO" }), { skipped: true, reason: "NOT_DUE" });
  await h.service.updateSettings({ enabled: false, intervalMinutes: 120 }, admin);
  h.state().nextRunAt = new Date(0);
  assert.deepEqual(await h.service.run({ trigger: "AUTO" }), { skipped: true, reason: "DISABLED" });
  assert.equal(h.changed.length, 0);
  await assert.rejects(h.service.updateSettings({ enabled: true, intervalMinutes: 0 }, admin), (e: any) => e.code === "INVALID_SYNC_SETTINGS");
  await assert.rejects(h.service.updateSettings({ enabled: true, intervalMinutes: 60 }, member), (e: any) => e.code === "FORBIDDEN");
});

test("manual run records each person and bypasses disabled schedule without bypassing authorization", async () => {
  process.env.DINGTALK_CORP_ID = "directory-test-corp";
  const h = harness();
  await h.service.updateSettings({ enabled: false, intervalMinutes: 60 }, admin);
  const result = await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal("status" in result && result.status, "SUCCESS");
  assert.equal(h.items[0].action, "CREATED");
  assert.ok(h.changed[0].options.syncLockToken);
  assert.equal(h.changed[0].options.now, h.runs[0].startedAt);
  assert.equal(h.state().lockedBy, null);
  assert.ok(h.state().lastSuccessAt instanceof Date);
  const detail = await h.service.logDetail(h.runs[0].id, admin);
  assert.equal("lockToken" in detail, false);
  assert.deepEqual(detail.items[0].changes, ["name"]);
  await assert.rejects(h.service.run({ trigger: "MANUAL", operator: member }), (e: any) => e.code === "FORBIDDEN");
  await assert.rejects(h.service.logDetail(h.runs[0].id, member), (e: any) => e.code === "FORBIDDEN");
});

test("manual and scheduled jobs share one lease and cannot overlap", async () => {
  const h = harness();
  let release!: () => void;
  let entered!: () => void;
  const fetching = new Promise<void>((resolve) => { entered = resolve; });
  h.client.listUsers = async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); return [person]; };
  const first = h.service.run({ trigger: "MANUAL", operator: admin });
  await fetching;
  await assert.rejects(h.service.run({ trigger: "MANUAL", operator: admin }), (e: any) => e.code === "SYNC_ALREADY_RUNNING");
  assert.deepEqual(await h.service.run({ trigger: "AUTO" }), { skipped: true, reason: "RUNNING" });
  release();
  await first;
  assert.equal(h.changed.length, 1);
  assert.equal(h.runs.length, 1);
});

test("empty or malformed directory fails before mutation and does not archive anyone", async () => {
  for (const people of [[], [person, person], [{ ...person, name: "" }]]) {
    const h = harness();
    h.client.listUsers = async () => people;
    const result = await h.service.run({ trigger: "MANUAL", operator: admin });
    assert.equal("status" in result && result.status, "FAILED");
    assert.equal(h.changed.length, 0);
    assert.equal(h.archived.length, 0);
    assert.equal(h.state().lastSuccessAt, null);
  }
});

test("missing users require fresh explicit departure evidence and lookup failure is visible", async () => {
  const h = harness();
  const now = Date.now();
  h.users.push({ id: "gone", dingtalkUserId: "gone", name: "Gone", employmentStatus: "ACTIVE", createdAt: new Date(now - 10 * 86400000), lastSyncedAt: new Date(now - 2 * 86400000) });
  h.client.listDepartures = async () => { throw new Error("permission denied"); };
  const first = await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal("status" in first && first.status, "PARTIAL");
  assert.equal(h.archived.length, 0);
  assert.equal(h.items.at(-1).action, "PENDING");
  assert.match(h.items.at(-1).errorMessage, /permission denied/);
  assert.equal(h.state().lastSuccessAt, null);
  h.client.listDepartures = async () => [{ externalUserId: "gone", occurredAt: new Date(now - 3 * 86400000), reason: "old leave" }];
  await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal(h.archived.length, 0);
  h.client.listDepartures = async () => [{ externalUserId: "gone", occurredAt: new Date(now - 86400000), reason: "verified leave" }];
  const third = await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal("departedCount" in third && third.departedCount, 1);
  assert.equal(h.archived[0].evidence.source, "DINGTALK_DEPARTURE");
  assert.ok(h.archived[0].evidence.syncLockToken);
});

test("one failed identity does not hide successful rows or mark the run fully successful", async () => {
  const h = harness();
  h.client.listUsers = async () => [person, { ...person, dingtalkUserId: "conflict" }];
  const original = h.identities.upsertDirectoryPerson;
  h.identities.upsertDirectoryPerson = async (value, options) => {
    if (value.dingtalkUserId === "conflict") throw new Error("Identity conflict");
    return original(value, options);
  };
  const result = await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal("status" in result && result.status, "PARTIAL");
  assert.equal("createdCount" in result && result.createdCount, 1);
  assert.equal("failedCount" in result && result.failedCount, 1);
  assert.equal(h.items.length, 2);
  assert.equal(h.state().lastSuccessAt, null);
});

test("expired run is marked failed on recovery and resumed only once", async () => {
  const h = harness();
  await h.service.settings(admin);
  Object.assign(h.state(), { nextRunAt: new Date(0), lockedBy: "expired-token", lockedUntil: new Date(0) });
  h.runs.push({ id: "interrupted", status: "RUNNING", lockToken: "expired-token" });
  const result = await h.service.run({ trigger: "AUTO" });
  assert.equal("status" in result && result.status, "SUCCESS");
  assert.equal(h.runs[0].status, "FAILED");
  assert.match(h.runs[0].errorMessage, /中断/);
  assert.deepEqual(await h.service.run({ trigger: "AUTO" }), { skipped: true, reason: "NOT_DUE" });
});

test("finishing a running job preserves a newly saved schedule", async () => {
  const h = harness();
  let savedNextRunAt = 0;
  h.client.listUsers = async () => {
    await h.service.updateSettings({ enabled: false, intervalMinutes: 120 }, admin);
    savedNextRunAt = h.state().nextRunAt.getTime();
    return [person];
  };
  await h.service.run({ trigger: "MANUAL", operator: admin });
  assert.equal(h.state().enabled, false);
  assert.equal(h.state().intervalMinutes, 120);
  assert.equal(h.state().nextRunAt.getTime(), savedNextRunAt);
});

test("expired log is recovered immediately even before the next scheduled run", async () => {
  const h = harness();
  await h.service.settings(admin);
  const next = h.state().nextRunAt.getTime();
  Object.assign(h.state(), { lockedBy: "expired-token", lockedUntil: new Date(0) });
  h.runs.push({ id: "interrupted", status: "RUNNING", lockToken: "expired-token" });
  assert.deepEqual(await h.service.run({ trigger: "AUTO" }), { skipped: true, reason: "NOT_DUE" });
  assert.equal(h.runs[0].status, "FAILED");
  assert.equal(h.state().lockedBy, null);
  assert.equal(h.state().nextRunAt.getTime(), next);
});

test("a worker that lost its lease cannot mutate or overwrite a newer run", async () => {
  const h = harness();
  h.client.listUsers = async () => { h.state().lockedBy = "new-worker"; return [person]; };
  await assert.rejects(h.service.run({ trigger: "MANUAL", operator: admin }), (e: any) => e.code === "SYNC_LEASE_LOST");
  assert.equal(h.changed.length, 0);
  assert.equal(h.state().lockedBy, "new-worker");
  assert.equal(h.runs[0].status, "RUNNING");
});

test("log filters reject malformed bounds and sanitize accidental access-bearing errors", async () => {
  const h = harness();
  await assert.rejects(h.service.logs(new URLSearchParams("page=-1"), admin), (e: any) => e.code === "INVALID_PAGINATION");
  await assert.rejects(h.service.logs(new URLSearchParams("from=invalid"), admin), (e: any) => e.code === "INVALID_DATE");
  await assert.rejects(h.service.logs(new URLSearchParams("status=bogus"), admin), (e: any) => e.code === "INVALID_SYNC_STATUS");
  assert.doesNotMatch(safeSyncError(new Error("failed https://example.invalid/?access_token=private secret=private")), /private/);
});
