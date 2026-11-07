import test from "node:test";
import assert from "node:assert/strict";
import { loadSecuritySource } from "./helpers/security-source";

const env = { NODE_ENV: "production", AUTH_COOKIE_SECRET: "test-only-independent-secret-12345678901234567890", AUTH_SESSION_TTL_SECONDS: "300" };

test("production fails closed without an independent strong authentication secret", () => {
  for (const bad of [{ NODE_ENV: "production" }, { NODE_ENV: "production", DINGTALK_CLIENT_SECRET: "upstream-secret" }, { NODE_ENV: "production", AUTH_COOKIE_SECRET: "CHANGE_ME_TO_A_LONG_RANDOM_SECRET" }]) {
    const auth = loadSecuritySource("src/server/auth-session.ts", { env: bad });
    assert.throws(() => auth.assertAuthConfiguration(), (e: any) => e.code === "AUTH_SECRET_MISSING");
  }
});

test("production rejects both explicit development identity switches", () => {
  for (const flag of ["DEV_AUTH_ENABLED", "DINGTALK_MOCK_ENABLED"]) {
    const auth = loadSecuritySource("src/server/auth-session.ts", { env: { ...env, [flag]: "true" } });
    assert.throws(() => auth.assertAuthConfiguration(), (e: any) => e.code === "UNSAFE_AUTH_CONFIGURATION");
  }
});

test("missing mock flag never treats the auth code as a user identity", async () => {
  const { DingTalkClient } = loadSecuritySource("src/server/dingtalk/DingTalkClient.ts", { env: { NODE_ENV: "production" } });
  await assert.rejects(new DingTalkClient().getUserIdByAuthCode("arbitrary-admin-id"));
  const local = loadSecuritySource("src/server/dingtalk/DingTalkClient.ts", { env: { NODE_ENV: "development", DINGTALK_MOCK_ENABLED: "true" } });
  assert.equal(await new local.DingTalkClient().getUserIdByAuthCode("local-user"), "local-user");
});

test("sessions enforce signed expiration, reject tampering and the legacy unbounded cookie", () => {
  const auth = loadSecuritySource("src/server/auth-session.ts", { env });
  const issued = 1_800_000_000_000;
  const token = auth.createAuthCookieValue("employee", issued);
  assert.equal(auth.verifyAuthCookieValue(token, issued + 299000), "employee");
  assert.equal(auth.verifyAuthCookieValue(token, issued + 300000), null);
  assert.equal(auth.verifyAuthCookieValue(token.slice(0, -1) + "!", issued), null);
  assert.equal(auth.verifyAuthCookieValue(token + ".extra", issued), null);
  assert.equal(auth.verifyAuthCookieValue("dXNlcg.signature", issued), null);
  assert.equal(auth.verifyAuthCookieValue(token, issued - 120000), null);
});

test("explicit local simulation has a random per-process signing key", () => {
  const first = loadSecuritySource("src/server/auth-session.ts", { env: { NODE_ENV: "development", DINGTALK_MOCK_ENABLED: "true" } });
  const second = loadSecuritySource("src/server/auth-session.ts", { env: { NODE_ENV: "development", DINGTALK_MOCK_ENABLED: "true" } });
  const token = first.createAuthCookieValue("local-user");
  assert.equal(first.verifyAuthCookieValue(token), "local-user");
  assert.equal(second.verifyAuthCookieValue(token), null);
});

test("login redirects stay on the origin and local cookies work over HTTP", () => {
  const auth = loadSecuritySource("src/server/auth-session.ts", { env: { NODE_ENV: "development", DEV_AUTH_ENABLED: "true" } });
  for (const value of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\nevil.invalid", "javascript:alert(1)"]) assert.equal(auth.safeLoginRedirect(value, "https://ticket.invalid/api/auth").href, "https://ticket.invalid/");
  assert.equal(auth.safeLoginRedirect("/tickets/my?q=one", "https://ticket.invalid/api/auth").href, "https://ticket.invalid/tickets/my?q=one");
  assert.equal(auth.authCookieOptions(new Request("http://localhost/api/auth")).secure, false);
  assert.equal(auth.authCookieOptions(new Request("https://ticket.invalid/api/auth")).secure, true);
});

test("malformed cookies and disabled accounts do not authenticate", async () => {
  const prisma = { user: { findUnique: async () => ({ status: "DISABLED" }) } };
  const auth = loadSecuritySource("src/server/auth.ts", { env, prisma });
  await assert.rejects(auth.getCurrentUser(new Request("https://ticket.invalid/api/me", { headers: { cookie: "it_session=%malformed" } })), (e: any) => e.code === "UNAUTHORIZED");
  const token = auth.createAuthCookieValue("disabled-user");
  await assert.rejects(auth.getCurrentUser(new Request("https://ticket.invalid/api/me", { headers: { cookie: `it_session=${token}` } })), (e: any) => e.code === "USER_DISABLED");
});

test("invalid JSON never becomes an empty mutation", async () => {
  const http = loadSecuritySource("src/lib/http.ts");
  for (const body of ["{", "null", "[]", '"text"']) await assert.rejects(http.parseJson(new Request("https://ticket.invalid", { method: "POST", body })), (e: any) => e.code === "INVALID_JSON");
  assert.deepEqual(JSON.parse(JSON.stringify(await http.parseJson(new Request("https://ticket.invalid", { method: "POST", body: '{"name":"ok"}' })))), { name: "ok" });
});


test("v3 sessions bind a permanent person id and revocation version", async () => {
  const user = { id: "person-id", dingtalkUserId: "new-dingtalk-id", status: "ACTIVE", employmentStatus: "ACTIVE", manuallyDisabled: false, mergedIntoId: null, sessionVersion: 4, roleAssignments: [{ role: "EMPLOYEE" }] };
  const queries: any[] = [];
  const prisma = { user: { findUnique: async (query: any) => { queries.push(query); return user; } } };
  const auth = loadSecuritySource("src/server/auth.ts", { env, prisma });
  const current = auth.createAuthCookieValue(user);
  const result = await auth.getCurrentUser(new Request("https://ticket.invalid/api/me", { headers: { cookie: `it_session=${current}` } }));
  assert.equal(result.id, "person-id");
  assert.equal(queries[0].where.id, "person-id");
  assert.equal(queries[0].where.dingtalkUserId, undefined);
  const old = auth.createAuthCookieValue({ id: user.id, sessionVersion: 3 });
  await assert.rejects(auth.getCurrentUser(new Request("https://ticket.invalid/api/me", { headers: { cookie: `it_session=${old}` } })), (error: any) => error.code === "SESSION_REVOKED");
});
