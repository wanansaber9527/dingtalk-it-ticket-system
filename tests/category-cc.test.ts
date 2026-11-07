import test from "node:test";
import assert from "node:assert/strict";
import { loadSecuritySource } from "./helpers/security-source";

const admin = { id: "admin", dingtalkUserId: "admin", name: "Admin", status: "ACTIVE", roleAssignments: [{ role: "SUPER_ADMIN" }] };
const employee = { ...admin, id: "employee", dingtalkUserId: "employee", roleAssignments: [{ role: "EMPLOYEE" }] };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function setup() {
  const users = [
    { dingtalkUserId: "cc-a", name: "甲", departmentName: "运营", status: "ACTIVE" },
    { dingtalkUserId: "cc-b", name: "乙", departmentName: "仓储", status: "ACTIVE" },
    { dingtalkUserId: "disabled", name: "已停用", departmentName: "仓储", status: "DISABLED" }
  ];
  let rows: any[] = [];
  let inTransaction = false;
  let failSave = false;
  const hydrate = (row: any) => ({ ...row, ccRecipients: row.ccRecipients.map(({ userId }: any) => ({ userId, user: users.find((user) => user.dingtalkUserId === userId) })) });
  const save = async (id: string, data: any) => {
    assert.equal(inTransaction, true, "category and recipient writes must share the transaction");
    const existing = rows.find((row) => row.id === id);
    const { ccRecipients, ...fields } = data;
    const next = { ...existing, ...fields, id, ccRecipients: ccRecipients === undefined ? existing?.ccRecipients || [] : plain(ccRecipients.create) };
    rows = [...rows.filter((row) => row.id !== id), next];
    if (failSave) throw new Error("Recipient write failed");
    return hydrate(next);
  };
  const db: any = {
    user: { findMany: async ({ where }: any) => { assert.equal(inTransaction, true); return users.filter((user) => where.dingtalkUserId.in.includes(user.dingtalkUserId)); } },
    categoryCcRecipient: { findMany: async ({ where }: any) => rows.find((row) => row.id === where.categoryId)?.ccRecipients || [] },
    ticketCategory: {
      create: async ({ data }: any) => save(`cat-${rows.length + 1}`, data),
      update: async ({ where, data }: any) => save(where.id, data),
      findMany: async ({ select, where }: any) => rows.filter((row) => !where?.enabled || row.enabled).map((row) => select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : hydrate(row))
    },
    $transaction: async (run: any) => {
      const before = structuredClone(rows);
      inTransaction = true;
      try { return await run(db); }
      catch (error) { rows = before; throw error; }
      finally { inTransaction = false; }
    }
  };
  const { CategoryService } = loadSecuritySource("src/server/services/categoryService.ts");
  return { service: new CategoryService(db), db, users, rows: () => rows, failSave: () => { failSave = true; } };
}

test("category CC defaults to empty, deduplicates recipients, and preserves omitted updates", async () => {
  const h = setup();
  assert.deepEqual(plain((await h.service.create({ name: "空分类" }, admin)).ccUserIds), []);
  const created = await h.service.create({ name: "硬件", ccUserIds: ["cc-a", "cc-a", "cc-b"] }, admin);
  assert.deepEqual(plain(created.ccUserIds), ["cc-a", "cc-b"]);
  assert.deepEqual(plain(created.ccRecipients), [
    { userId: "cc-a", name: "甲", departmentName: "运营", status: "ACTIVE" },
    { userId: "cc-b", name: "乙", departmentName: "仓储", status: "ACTIVE" }
  ]);
  assert.deepEqual(plain((await h.service.update(created.id, { name: "硬件更新" }, admin)).ccUserIds), ["cc-a", "cc-b"]);
  assert.deepEqual(plain((await h.service.update(created.id, { name: "硬件更新", ccUserIds: [] }, admin)).ccUserIds), []);
});

test("category CC rejects unknown, disabled, malformed and oversized new recipient lists before writes", async () => {
  const h = setup();
  for (const ccUserIds of [["missing"], ["disabled"]]) {
    await assert.rejects(h.service.create({ name: "硬件", ccUserIds }, admin), { code: "CC_USER_NOT_FOUND" });
  }
  for (const ccUserIds of [[""], "cc-a", null, Array.from({ length: 51 }, (_, i) => `person-${i}`)]) {
    await assert.rejects(h.service.create({ name: "硬件", ccUserIds }, admin), { code: "INVALID_CATEGORY" });
  }
  assert.equal(h.rows().length, 0);
  await assert.rejects(h.service.create({ name: "硬件", ccUserIds: ["cc-a"] }, employee), { code: "FORBIDDEN" });
  await assert.rejects(h.service.update("any", { name: "硬件", ccUserIds: [] }, { ...admin, status: "DISABLED" }), { code: "USER_DISABLED" });
});

test("category edits can retain a previously configured disabled recipient but cannot newly add one", async () => {
  const h = setup();
  const created = await h.service.create({ name: "硬件", ccUserIds: ["cc-a"] }, admin);
  h.users[0].status = "DISABLED";
  const retained = await h.service.update(created.id, { name: "硬件", ccUserIds: ["cc-a", "cc-b"] }, admin);
  assert.equal(retained.ccRecipients[0].status, "DISABLED");
  await assert.rejects(h.service.create({ name: "另一分类", ccUserIds: ["cc-a"] }, admin), { code: "CC_USER_NOT_FOUND" });
  await h.service.update(created.id, { name: "硬件", ccUserIds: [] }, admin);
  await assert.rejects(h.service.update(created.id, { name: "硬件", ccUserIds: ["cc-a"] }, admin), { code: "CC_USER_NOT_FOUND" });
});

test("category CC save failures roll back the category and its recipient replacement", async () => {
  const h = setup();
  const created = await h.service.create({ name: "原分类", ccUserIds: ["cc-a"] }, admin);
  h.failSave();
  await assert.rejects(h.service.update(created.id, { name: "不应保存", ccUserIds: ["cc-b"] }, admin), /Recipient write failed/);
  assert.equal(h.rows()[0].name, "原分类");
  assert.deepEqual(h.rows()[0].ccRecipients, [{ userId: "cc-a" }]);
});

test("public categories never expose CC identities while administrator categories include them", async () => {
  const h = setup();
  await h.service.create({ name: "硬件", description: "硬件报修", ccUserIds: ["cc-a"] }, admin);
  assert.deepEqual(plain((await h.service.list())[0].ccUserIds), ["cc-a"]);
  const route = loadSecuritySource("app/api/categories/route.ts", { prisma: h.db });
  const response = await route.GET();
  const body = await response.json();
  assert.deepEqual(body.data, [{ id: "cat-1", name: "硬件", description: "硬件报修" }]);
  assert.equal(JSON.stringify(body).includes("cc-a"), false);
});

test("CC option search is admin-only, active-only, bounded and limited to non-sensitive fields", async () => {
  let currentUser = admin;
  let reads = 0;
  let query: any;
  const route = loadSecuritySource("app/api/admin/users/cc-options/route.ts", {
    prisma: { user: { findMany: async (args: any) => { reads++; query = args; return [{ dingtalkUserId: "cc-a", name: "甲", departmentName: "运营", status: "ACTIVE" }]; } } },
    modules: { "@/src/server/auth": { getCurrentUser: async () => currentUser } }
  });
  const response = await route.GET(new Request("https://example.invalid/api/admin/users/cc-options?keyword=%20运营%20"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ userId: "cc-a", name: "甲", departmentName: "运营", status: "ACTIVE" }]);
  assert.deepEqual(plain(query.where), { status: "ACTIVE", OR: [{ name: { contains: "运营" } }, { departmentName: { contains: "运营" } }] });
  assert.deepEqual(Object.keys(query.select).sort(), ["departmentName", "dingtalkUserId", "name", "status"]);
  assert.equal(query.take, 100);
  currentUser = employee;
  assert.equal((await route.GET(new Request("https://example.invalid/api/admin/users/cc-options"))).status, 403);
  assert.equal(reads, 1);
});
