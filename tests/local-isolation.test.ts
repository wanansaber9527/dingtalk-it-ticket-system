import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSecuritySource } from "./helpers/security-source";

const localEnv = { NODE_ENV: "development", DEV_AUTH_ENABLED: "true", NEXT_PUBLIC_LOCAL_DEMO: "true", AUTH_COOKIE_SECRET: "local-test-secret-123456789012345678901234567890" };
const request = (url: string, body = '{"userId":"local-admin"}', headers = {}) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("local identity switching is unavailable in production, on remote hosts, or without explicit demo flags", async () => {
  for (const env of [{ ...localEnv, NODE_ENV: "production" }, { ...localEnv, DEV_AUTH_ENABLED: "false" }, { ...localEnv, NEXT_PUBLIC_LOCAL_DEMO: "false" }]) {
    const route = loadSecuritySource("app/api/dev/session/route.ts", { env });
    assert.equal((await route.POST(request("http://127.0.0.1:3100/api/dev/session"))).status, 404);
  }
  const route = loadSecuritySource("app/api/dev/session/route.ts", { env: localEnv });
  assert.equal((await route.POST(request("https://public.invalid/api/dev/session"))).status, 404);
  assert.equal((await route.POST(request("http://127.0.0.1:3100/api/dev/session", undefined, { origin: "https://evil.invalid" }))).status, 403);
  assert.equal((await route.POST(request("http://127.0.0.1:3100/api/dev/session", undefined, { "sec-fetch-site": "cross-site" }))).status, 403);
});

test("local identity switching validates input and issues only expiring allowlisted identities", async () => {
  const route = loadSecuritySource("app/api/dev/session/route.ts", { env: localEnv, prisma: { user: { findUniqueOrThrow: async () => ({ id: "local-admin-person", sessionVersion: 3, status: "ACTIVE", employmentStatus: "ACTIVE" }) } } });
  for (const body of ["null", "{", '{"userId":"production-admin"}']) assert.equal((await route.POST(request("http://127.0.0.1:3100/api/dev/session", body))).status, 400);
  const response = await route.POST(request("http://127.0.0.1:3100/api/dev/session"));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  const auth = loadSecuritySource("src/server/auth-session.ts", { env: localEnv });
  const session = decodeURIComponent(cookie!.match(/it_session=([^;]+)/)![1]);
  assert.equal(auth.verifyAuthSession(session).userId, "local-admin-person");
  assert.equal(auth.verifyAuthSession(session).sessionVersion, 3);
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Max-Age=/i); assert.match(cookie, /SameSite=strict/i);
  const normalized = await route.POST(request("http://localhost:3100/api/dev/session", undefined, { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }));
  assert.equal(normalized.status, 200);
  assert.equal((await route.POST(request("http://localhost:3100/api/dev/session", undefined, { host: "localhost:3100", origin: "http://127.0.0.1:3100" }))).status, 403);
  assert.equal((await route.POST(request("http://localhost:3100/api/dev/session", undefined, { host: "evil.invalid", origin: "http://evil.invalid" }))).status, 404);
});

test("the isolated runtime refuses dotenv reads, including Next env loading", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-env-isolation-"));
  t.after(async () => {
    // 本地隔离的 lstat 会隐藏 .env，显式移除本测试创建的固定 canary 后再清理目录。
    await unlink(path.join(directory, ".env")).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, ".env"), "ISOLATION_CANARY=must-not-load\n");
  await writeFile(path.join(directory, ".env.example"), "SAFE_EXAMPLE=example\n");
  const script = `const fs=require('node:fs'); const assert=require('node:assert/strict'); const path=require('node:path'); const root=process.argv[1]; assert.throws(()=>fs.readFileSync(path.join(root,'.env'),'utf8'),{code:'ENOENT'}); assert.ok(fs.readFileSync(path.join(root,'.env.example'),'utf8').includes('SAFE_EXAMPLE')); require('@next/env').loadEnvConfig(root,true); assert.equal(process.env.ISOLATION_CANARY,undefined); console.log('isolated');`;
  const child = spawnSync(process.execPath, ["--require", path.join(process.cwd(), "scripts/local-no-dotenv.cjs"), "-e", script, directory], { encoding: "utf8", env: { PATH: process.env.PATH, ITDESK_LOCAL_ISOLATED: "1", NODE_ENV: "development" } });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), "isolated");
});
