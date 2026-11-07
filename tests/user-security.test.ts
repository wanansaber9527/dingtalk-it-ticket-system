import test from "node:test";
import assert from "node:assert/strict";
import { loadSecuritySource } from "./helpers/security-source";

const admin = { id: "admin", dingtalkUserId: "admin", name: "Admin", status: "ACTIVE", roleAssignments: [{ role: "SUPER_ADMIN" }] };

test("legacy manual synchronization delegates to the logged and locked directory service", async () => {
  let call: any;
  const db = {};
  const client = {};
  const { UserService } = loadSecuritySource("src/server/services/userService.ts", { modules: {
    "@/src/server/services/directorySyncService": { DirectorySyncService: class { constructor(prisma: unknown, dingtalk: unknown) { assert.equal(prisma, db); assert.equal(dingtalk, client); } async run(input: unknown) { call = input; return { runId: "one" }; } } }
  } });
  assert.equal((await new UserService(db, client).syncDingTalkDirectory(admin)).runId, "one");
  assert.equal(call.trigger, "MANUAL");
  assert.equal(call.operator, admin);
});

test("the final active admin cannot be disabled or lose the administrator role", async () => {
  let writes = 0;
  let options: any;
  const db: any = { user: { findUnique: async () => admin, findUniqueOrThrow: async () => admin, count: async () => 1, update: async () => { writes++; } }, userRoleAssignment: { deleteMany: async () => { writes++; } } };
  db.$transaction = async (run: any, opts: any) => { options = opts; return run(db); };
  const { UserService } = loadSecuritySource("src/server/services/userService.ts");
  const service = new UserService(db, {});
  await assert.rejects(service.updateStatus(admin.id, admin, "DISABLED"), (e: any) => e.code === "LAST_ADMIN_REQUIRED");
  await assert.rejects(service.removeAdmin(admin.id, admin), (e: any) => e.code === "LAST_ADMIN_REQUIRED");
  assert.equal(writes, 0);
  assert.equal(options.isolationLevel, "Serializable");
});

test("administrator changes still work when another active administrator remains", async () => {
  const db: any = { user: { findUnique: async () => admin, findUniqueOrThrow: async () => admin, count: async () => 2, update: async ({ data }: any) => ({ ...admin, ...data }) }, userRoleAssignment: { deleteMany: async () => ({ count: 1 }) } };
  db.$transaction = async (run: any) => run(db);
  const { UserService } = loadSecuritySource("src/server/services/userService.ts");
  assert.equal((await new UserService(db, {}).updateStatus(admin.id, admin, "DISABLED")).status, "DISABLED");
  assert.ok(await new UserService(db, {}).removeAdmin(admin.id, admin));
});

test("category validation rejects malformed inputs and requires an active execution role", async () => {
  let query: any;
  let writes = 0;
  const db = { user: { findFirst: async (args: any) => { query = args; return null; } }, ticketCategory: { create: async () => { writes++; } } };
  const { CategoryService } = loadSecuritySource("src/server/services/categoryService.ts");
  const service = new CategoryService(db);
  await assert.rejects(service.create({}, admin), (e: any) => e.code === "INVALID_CATEGORY");
  await assert.rejects(service.create({ name: "IT", firstResponseMinutes: -10 }, admin), (e: any) => e.code === "INVALID_CATEGORY");
  await assert.rejects(service.create({ name: "IT", defaultHandlerUserId: "disabled" }, admin), (e: any) => e.code === "HANDLER_NOT_FOUND");
  assert.equal(query.where.status, "ACTIVE");
  assert.equal(query.where.roleAssignments.some.role, "IT_HANDLER");
  assert.equal(writes, 0);
});
