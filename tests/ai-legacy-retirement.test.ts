import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { loadSecuritySource } from "./helpers/security-source";

const employee = { id: "employee", dingtalkUserId: "employee", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };
const admin = { ...employee, id: "admin", dingtalkUserId: "admin", roleAssignments: [{ role: "SUPER_ADMIN" }] };

test("retired knowledge APIs remain authenticated and administrator mutations remain restricted", async () => {
  let currentUser = employee;
  let authenticated = true;
  const modules = { "@/src/server/auth": { getCurrentUser: async () => {
    if (!authenticated) throw new Error("authentication required");
    return currentUser;
  } } };
  const employeeRoute = loadSecuritySource("app/api/knowledge-base/search/route.ts", { modules });
  const request = new Request("https://it.example.invalid/api/knowledge-base/search");
  assert.equal((await employeeRoute.GET(request)).status, 410);
  for (const [file, methods] of [
    ["app/api/admin/knowledge-base/route.ts", ["GET", "POST"]],
    ["app/api/admin/knowledge-base/[id]/route.ts", ["PUT"]]
  ] as const) {
    const route = loadSecuritySource(file, { modules });
    for (const method of methods) {
      currentUser = employee;
      assert.equal((await route[method](request)).status, 403);
      currentUser = admin;
      const retired = await route[method](request);
      assert.equal(retired.status, 410);
      assert.equal((await retired.json()).code, "KNOWLEDGE_BASE_RETIRED");
    }
  }
  authenticated = false;
  const muted = loadSecuritySource("app/api/knowledge-base/search/route.ts", {
    modules: { "@/src/server/auth": { getCurrentUser: async () => { throw { denied: true }; } }, "@/src/lib/http": { AppError: Error, fail: () => new Response(null, { status: 401 }) } }
  });
  assert.equal((await muted.GET(request)).status, 401);
});

test("AI homepage and direct ticket entry share DingTalk access policy, with local development bypass", () => {
  const production = loadSecuritySource("middleware.ts", { env: { NODE_ENV: "production", APP_BASE_URL: "https://it.example.invalid" } });
  for (const route of ["/", "/ai-assistant", "/tickets/new"]) {
    const denied = production.middleware(new NextRequest(`https://it.example.invalid${route}`));
    assert.equal(denied.headers.get("location"), "https://it.example.invalid/open-in-dingtalk");
    const allowed = production.middleware(new NextRequest(`https://it.example.invalid${route}`, { headers: { "user-agent": "DingTalk" } }));
    assert.equal(allowed.headers.get("location"), null);
  }
  const local = loadSecuritySource("middleware.ts", { env: { NODE_ENV: "development", DEV_AUTH_ENABLED: "true" } });
  assert.equal(local.middleware(new NextRequest("http://127.0.0.1:3100/ai-assistant")).headers.get("location"), null);
});

test("categories referenced by AI conversations or archived knowledge can only be disabled", async () => {
  let aiCount = 1;
  let knowledgeCount = 0;
  let deleted = false;
  const prisma = {
    ticketCategory: { findUnique: async () => ({ id: "category" }), delete: async () => { deleted = true; } },
    ticket: { count: async () => 0 },
    knowledgeBase: { count: async () => knowledgeCount },
    aiConversation: { count: async () => aiCount }
  };
  const { CategoryService } = loadSecuritySource("src/server/services/categoryService.ts", { prisma });
  const service = new CategoryService(prisma);
  await assert.rejects(service.delete("category", admin), (error: any) => error.code === "CATEGORY_IN_USE");
  assert.equal(deleted, false);
  aiCount = 0;
  knowledgeCount = 1;
  await assert.rejects(service.delete("category", admin), (error: any) => error.code === "CATEGORY_IN_USE");
  assert.equal(deleted, false);
  knowledgeCount = 0;
  await service.delete("category", admin);
  assert.equal(deleted, true);
});
