import test from "node:test";
import assert from "node:assert/strict";
import { planPersonnelBackfill, productionBackfillOptions, type BackfillSnapshot } from "../scripts/personnel-backfill-plan";
import { runPersonnelProductionBackfill } from "../scripts/backfill-personnel-production";

const args = ["--expected-database", "ticket_fixture", "--expected-corp-id", "corp-fixture"];
const env = { NODE_ENV: "production", DATABASE_URL: "mysql://fixture:fixture@database.invalid:3306/ticket_fixture", DINGTALK_CORP_ID: "corp-fixture", NEXT_PUBLIC_DINGTALK_CORP_ID: "corp-fixture" };
const person = (id: string, external: string) => ({ id, dingtalkUserId: external, status: "ACTIVE", employmentStatus: "ACTIVE", manuallyDisabled: false, mergedIntoId: null });
function fixture(): BackfillSnapshot {
  return {
    users: [person("u1", "employee-1"), { ...person("u2", "employee-2"), status: "DISABLED" }], identities: [],
    relations: [
      { kind: "applicants", id: "ticket-1", externalId: "employee-1", personId: null },
      { kind: "handlers", id: "ticket-1", externalId: "employee-2", personId: null },
      { kind: "handlers", id: "ticket-2", externalId: null, personId: null },
      { kind: "categoryCc", id: "category-cc", externalId: "employee-2", personId: null },
      { kind: "ticketCc", id: "ticket-cc", externalId: "employee-2", personId: null },
      { kind: "notices", id: "notice", externalId: "employee-1", personId: null },
      { kind: "notices", id: "legacy-notice", externalId: "historical-nonuser", personId: null }
    ]
  };
}

test("production backfill requires exact explicit database and consistent corp identity, defaults to preview", () => {
  assert.deepEqual(productionBackfillOptions(args, env), { apply: false, database: "ticket_fixture", corpId: "corp-fixture" });
  assert.equal(productionBackfillOptions([...args, "--apply"], env).apply, true);
  assert.equal(productionBackfillOptions(args, { ...env, DINGTALK_CORP_ID: undefined }).corpId, "corp-fixture");
  for (const bad of [[], args.slice(0, 2), [...args, "--force"], [...args, "--apply", "--apply"], [...args, "--expected-database", "ticket_fixture"], ["--expected-database", "other", ...args.slice(2)]]) {
    assert.throws(() => productionBackfillOptions(bad, env));
  }
  for (const changed of [
    { NODE_ENV: "development" }, { NEXT_PUBLIC_DINGTALK_CORP_ID: "different-corp" },
    { DINGTALK_CORP_ID: "", NEXT_PUBLIC_DINGTALK_CORP_ID: "" },
    { DATABASE_URL: "postgres://fixture@database.invalid/ticket_fixture" },
    { DATABASE_URL: "mysql://fixture@database.invalid/other" },
    { DATABASE_URL: "not a URL" }
  ]) assert.throws(() => productionBackfillOptions(args, { ...env, ...changed }));
});

test("local, mock and fixture environments cannot use the production entry, even with production NODE_ENV", () => {
  for (const key of ["DEV_AUTH_ENABLED", "DINGTALK_MOCK_ENABLED", "AI_LOCAL_DEMO_ENABLED", "NEXT_PUBLIC_LOCAL_DEMO", "ITDESK_LOCAL_ISOLATED", "DIRECTORY_SYNC_LOCAL_FIXTURE", "LOCAL_NEXT_DIST_DIR"]) {
    assert.throws(() => productionBackfillOptions(args, { ...env, [key]: "true" }), key);
  }
  assert.throws(() => productionBackfillOptions(["--expected-database", "itdesk_local", ...args.slice(2)], { ...env, DATABASE_URL: "mysql://fixture@127.0.0.1:33427/itdesk_local" }));
  assert.throws(() => productionBackfillOptions([...args.slice(0, 2), "--expected-corp-id", "local-corp"], { ...env, DINGTALK_CORP_ID: "local-corp", NEXT_PUBLIC_DINGTALK_CORP_ID: "local-corp" }));
  const secretUrl = "mysql://fixture:NEVER_OUTPUT_THIS@database.invalid/other";
  try { productionBackfillOptions(args, { ...env, DATABASE_URL: secretUrl }); assert.fail(); }
  catch (error) { assert.ok(!String(error).includes("NEVER_OUTPUT_THIS")); assert.ok(!String(error).includes("database.invalid")); }
});

test("planning resolves all relation kinds, preserves unknown historical notification recipients and does not mutate data", () => {
  const data = fixture(), original = structuredClone(data);
  const plan = planPersonnelBackfill(data, "corp-fixture");
  assert.deepEqual(data, original);
  assert.deepEqual(plan.counts, { users: 2, inspectedRelations: 7, applicants: 1, handlers: 1, categoryCc: 1, ticketCc: 1, notices: 1, manuallyDisabled: 1, identities: 2, unresolvedApplicants: 0, unresolvedHandlers: 0, unresolvedCategoryCc: 0, unresolvedTicketCc: 0, unresolvedNotices: 1 });
  assert.deepEqual(plan.manuallyDisabledIds, ["u2"]);
  assert.ok(plan.identities.every(row => row.corpId === "corp-fixture" && !("unionId" in row)));
  assert.ok(plan.relations.every(row => ["u1", "u2"].includes(row.personId)));
});

test("repeating a completed plan is a no-op and never marks automatically departed personnel as manually disabled", () => {
  const data = fixture(), first = planPersonnelBackfill(data, "corp-fixture");
  for (const row of first.relations) data.relations.find(value => value.id === row.id && value.kind === row.kind)!.personId = row.personId;
  for (const id of first.manuallyDisabledIds) data.users.find(user => user.id === id)!.manuallyDisabled = true;
  data.identities.push(...first.identities);
  data.users.push({ ...person("departed", "departed-external"), status: "DISABLED", employmentStatus: "DEPARTED" });
  data.identities.push({ userId: "departed", externalUserId: "departed-external", corpId: "corp-fixture" });
  const second = planPersonnelBackfill(data, "corp-fixture");
  assert.equal(second.relations.length + second.identities.length + second.manuallyDisabledIds.length, 0);
  assert.equal(second.counts.unresolvedNotices, 1);
});

test("missing applicant or nonempty handler blocks the whole plan; absent handler is valid", () => {
  for (const kind of ["applicants", "handlers"] as const) {
    const data = fixture(); data.relations.find(row => row.kind === kind)!.externalId = "unknown";
    assert.throws(() => planPersonnelBackfill(data, "corp-fixture"), /工单人员无法完整关联/);
  }
  const data = fixture(); data.relations.find(row => row.kind === "applicants")!.externalId = null;
  assert.throws(() => planPersonnelBackfill(data, "corp-fixture"), /申请人 1/);
});

test("existing wrong internal IDs and conflicting or cross-corp bindings are rejected without overwriting", () => {
  const wrong = fixture(); wrong.relations[0].personId = "u2";
  assert.throws(() => planPersonnelBackfill(wrong, "corp-fixture"), /已有内部人员关联/);
  assert.equal(wrong.relations[0].personId, "u2");
  const conflict = fixture(); conflict.identities.push({ corpId: "corp-fixture", externalUserId: "employee-1", userId: "u2" });
  assert.throws(() => planPersonnelBackfill(conflict, "corp-fixture"), /绑定与人员档案冲突/);
  const crossCorp = fixture(); crossCorp.identities.push({ corpId: "other-corp", externalUserId: "employee-1", userId: "u1" });
  assert.throws(() => planPersonnelBackfill(crossCorp, "corp-fixture"), /企业范围/);
});

test("verified historical external identities support already-linked and unfilled historical tickets after rehire", () => {
  const data = fixture(); data.users[0].dingtalkUserId = "new-external";
  data.identities.push({ corpId: "corp-fixture", externalUserId: "employee-1", userId: "u1" });
  data.relations[0].personId = "u1";
  const plan = planPersonnelBackfill(data, "corp-fixture");
  assert.equal(plan.counts.applicants, 0);
  assert.equal(plan.relations.find(row => row.kind === "notices")?.personId, "u1");
  assert.ok(plan.identities.some(row => row.externalUserId === "new-external" && row.userId === "u1"));
});

function previewDb(data: BackfillSnapshot) {
  const ticketRows = new Map<string, any>();
  for (const row of data.relations.filter(row => row.kind === "applicants" || row.kind === "handlers")) {
    const ticket = ticketRows.get(row.id) || { id: row.id, applicantId: null, handlerId: null, applicantUserId: "employee-1", handlerUserId: null };
    if (row.kind === "applicants") { ticket.applicantId = row.personId; ticket.applicantUserId = row.externalId; }
    else { ticket.handlerId = row.personId; ticket.handlerUserId = row.externalId; }
    ticketRows.set(row.id, ticket);
  }
  let writeCalls = 0;
  const tx = {
    user: { findMany: async () => data.users }, userIdentity: { findMany: async () => data.identities, createMany: async () => { writeCalls++; throw new Error("Unexpected write"); } },
    ticket: { findMany: async () => [...ticketRows.values()] },
    categoryCcRecipient: { findMany: async () => data.relations.filter(row => row.kind === "categoryCc").map(row => ({ id: row.id, userId: row.externalId, personId: row.personId })) },
    ticketCcRecipient: { findMany: async () => data.relations.filter(row => row.kind === "ticketCc").map(row => ({ id: row.id, userId: row.externalId, personId: row.personId })) },
    notification: { findMany: async () => data.relations.filter(row => row.kind === "notices").map(row => ({ id: row.id, receiverUserId: row.externalId, receiverPersonId: row.personId })) },
    $executeRaw: async () => { writeCalls++; throw new Error("Unexpected write"); }
  };
  return { db: { $transaction: async (work: any, options: any) => { assert.equal(options.isolationLevel, "Serializable"); return work(tx); } } as any, writes: () => writeCalls };
}

test("the runner dry run reads a consistent snapshot, writes nothing and emits counts only", async () => {
  const fake = previewDb(fixture());
  const report = await runPersonnelProductionBackfill(fake.db, { apply: false, corpId: "corp-fixture" });
  assert.equal(report.mode, "preview"); assert.equal(fake.writes(), 0);
  const serialized = JSON.stringify(report);
  for (const privateValue of ["employee-1", "employee-2", "historical-nonuser", "corp-fixture", "ticket-1"]) assert.ok(!serialized.includes(privateValue));
  assert.ok(Object.entries(report).every(([key, value]) => key === "mode" || typeof value === "number"));
});

test("the runner rejects a preflight conflict before any mutation even in apply mode", async () => {
  const data = fixture(); data.relations[0].personId = "u2";
  const fake = previewDb(data);
  await assert.rejects(runPersonnelProductionBackfill(fake.db, { apply: true, corpId: "corp-fixture" }), /已有内部人员关联/);
  assert.equal(fake.writes(), 0);
});

function transactionalFixture(initial: BackfillSnapshot, interrupt = false) {
  let committed = structuredClone(initial);
  const statements: string[] = [];
  const db = { $transaction: async (work: any) => {
    const data = structuredClone(committed);
    const tx = {
      user: { findMany: async () => data.users },
      userIdentity: { findMany: async () => data.identities, createMany: async ({ data: rows }: any) => { data.identities.push(...rows); return { count: rows.length }; } },
      ticket: { findMany: async () => data.relations.filter(row => row.kind === "applicants").map(row => {
        const handler = data.relations.find(other => other.id === row.id && other.kind === "handlers");
        return { id: row.id, applicantUserId: row.externalId, applicantId: row.personId, handlerUserId: handler?.externalId || null, handlerId: handler?.personId || null };
      }) },
      categoryCcRecipient: { findMany: async () => data.relations.filter(row => row.kind === "categoryCc").map(row => ({ id: row.id, userId: row.externalId, personId: row.personId })) },
      ticketCcRecipient: { findMany: async () => data.relations.filter(row => row.kind === "ticketCc").map(row => ({ id: row.id, userId: row.externalId, personId: row.personId })) },
      notification: { findMany: async () => data.relations.filter(row => row.kind === "notices").map(row => ({ id: row.id, receiverUserId: row.externalId, receiverPersonId: row.personId })) },
      $executeRaw: async (query: any) => {
        const sql = query.sql as string; statements.push(sql);
        assert.ok(!sql.includes("updatedAt"), "migration must preserve business timestamps");
        assert.ok(!sql.includes("TicketLog"), "migration cannot add business logs");
        let count = 0;
        if (sql.startsWith("UPDATE User SET manuallyDisabled")) {
          for (const user of data.users) if (query.values.includes(user.id) && user.status === "DISABLED" && user.employmentStatus === "ACTIVE" && !user.manuallyDisabled) { user.manuallyDisabled = true; count++; }
        } else {
          const kind = sql.includes("`applicantId`") ? "applicants" : sql.includes("`handlerId`") ? "handlers" : sql.includes("`CategoryCcRecipient`") ? "categoryCc" : sql.includes("`TicketCcRecipient`") ? "ticketCc" : "notices";
          const [personId, ...ids] = query.values;
          for (const row of data.relations) if (row.kind === kind && ids.includes(row.id) && row.personId === null) { row.personId = personId; count++; }
        }
        if (interrupt) throw new Error("fixture transaction failure");
        return count;
      }
    };
    const report = await work(tx);
    committed = data;
    return report;
  } } as any;
  return { db, state: () => structuredClone(committed), statements };
}

test("apply binds only NULL relationships, creates identities, preserves timestamps and becomes a no-op on repeat", async () => {
  const data = fixture(); data.relations = data.relations.filter(row => row.id !== "ticket-2");
  const fake = transactionalFixture(data);
  const result = await runPersonnelProductionBackfill(fake.db, { apply: true, corpId: "corp-fixture" });
  assert.equal(result.mode, "applied");
  assert.equal(result.applicants, 1); assert.equal(result.handlers, 1); assert.equal(result.identities, 2);
  assert.equal(fake.state().relations.filter(row => row.personId !== null).length, 5);
  const writes = fake.statements.length;
  const repeated = await runPersonnelProductionBackfill(fake.db, { apply: true, corpId: "corp-fixture" });
  assert.equal(repeated.applicants + repeated.handlers + repeated.categoryCc + repeated.ticketCc + repeated.notices + repeated.identities + repeated.manuallyDisabled, 0);
  assert.equal(fake.statements.length, writes);
});

test("a failure after the first mutation aborts the transaction rather than committing a partial backfill", async () => {
  const data = fixture(); data.relations = data.relations.filter(row => row.id !== "ticket-2");
  const fake = transactionalFixture(data, true);
  await assert.rejects(runPersonnelProductionBackfill(fake.db, { apply: true, corpId: "corp-fixture" }), /fixture transaction failure/);
  assert.ok(fake.statements.length > 0);
  assert.deepEqual(fake.state(), data);
});
