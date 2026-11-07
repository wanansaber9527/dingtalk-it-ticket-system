import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  sessionCookieOptions,
  verifySessionToken
} from "../lib/auth.js";
import { authConfig } from "../lib/server-config.js";

process.env.CORRECTION_USERNAME = "test-corrector";
process.env.CORRECTION_PASSWORD_HASH = "unused-in-session-tests";
process.env.CORRECTION_SESSION_SECRET = "s".repeat(64);
process.env.CORRECTION_SESSION_TTL_MINUTES = "120";
process.env.CORRECTION_COOKIE_SECURE = "false";
process.env.NEXT_PUBLIC_CORRECTION_BASE_PATH = "/ticket-correction-console";
process.env.NODE_ENV = "test";

test("签名会话可校验且包含独立 CSRF 令牌", () => {
  const now = Date.UTC(2026, 6, 29, 10, 0, 0);
  const { token, session } = createSession("test-corrector", now);
  const verified = verifySessionToken(token, now + 1_000);
  assert.equal(verified.sub, "test-corrector");
  assert.equal(verified.csrf, session.csrf);
  assert.ok(verified.exp > now);
});

test("篡改或过期的会话被拒绝", () => {
  const now = Date.UTC(2026, 6, 29, 10, 0, 0);
  const { token, session } = createSession("test-corrector", now);
  assert.equal(verifySessionToken(`${token}x`, now + 1_000), null);
  assert.equal(verifySessionToken(token, session.exp + 1), null);
});

test("会话 Cookie 仅发送到配置的更正台路径", () => {
  const now = Date.UTC(2026, 6, 29, 10, 0, 0);
  const { session } = createSession("test-corrector", now);
  const options = sessionCookieOptions(session);
  assert.equal(options.path, "/ticket-correction-console");
  assert.equal(options.secure, false);
});

test("生产模式拒绝非 Secure Cookie 配置", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecure = process.env.CORRECTION_COOKIE_SECURE;
  try {
    process.env.NODE_ENV = "production";
    process.env.CORRECTION_COOKIE_SECURE = "false";
    assert.throws(
      () => authConfig(),
      /生产环境必须设置 CORRECTION_COOKIE_SECURE=true/
    );

    process.env.CORRECTION_COOKIE_SECURE = "true";
    assert.equal(authConfig().secureCookie, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.CORRECTION_COOKIE_SECURE = previousSecure;
  }
});

test("dotenv 转义的 scrypt 分隔符会在服务端还原", () => {
  const previousHash = process.env.CORRECTION_PASSWORD_HASH;
  try {
    process.env.CORRECTION_PASSWORD_HASH =
      "scrypt-v1\\$16384\\$8\\$1\\$salt\\$derived";
    assert.equal(
      authConfig().passwordHash,
      "scrypt-v1$16384$8$1$salt$derived"
    );
  } finally {
    process.env.CORRECTION_PASSWORD_HASH = previousHash;
  }
});
