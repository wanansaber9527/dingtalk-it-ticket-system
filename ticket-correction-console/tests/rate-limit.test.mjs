import test from "node:test";
import assert from "node:assert/strict";
import {
  createLoginRateLimiter,
  requestIdentity
} from "../lib/rate-limit.js";

test("登录来源只信任 Nginx 覆盖的 X-Real-IP", () => {
  const request = new Request("https://example.test/login", {
    headers: {
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.8, 203.0.113.9"
    }
  });
  assert.equal(requestIdentity(request), "203.0.113.9");
});

test("不接受缺失或畸形的 X-Real-IP", () => {
  const spoofed = new Request("https://example.test/login", {
    headers: { "x-forwarded-for": "198.51.100.8" }
  });
  const malformed = new Request("https://example.test/login", {
    headers: { "x-real-ip": "not-an-ip" }
  });
  assert.equal(requestIdentity(spoofed), "unknown");
  assert.equal(requestIdentity(malformed), "unknown");
});

test("登录失败达到上限后锁定来源", () => {
  const limiter = createLoginRateLimiter({
    maxFailures: 3,
    maxEntries: 8,
    windowMs: 1_000,
    lockMs: 2_000,
    cleanupIntervalMs: 0
  });
  assert.equal(limiter.recordLoginFailure("203.0.113.1", 0).allowed, true);
  assert.equal(limiter.recordLoginFailure("203.0.113.1", 1).allowed, true);
  const locked = limiter.recordLoginFailure("203.0.113.1", 2);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfterSeconds, 2);
});

test("限流存储有容量上限并主动清理过期项", () => {
  const limiter = createLoginRateLimiter({
    maxFailures: 5,
    maxEntries: 2,
    windowMs: 100,
    lockMs: 100,
    cleanupIntervalMs: 0
  });
  limiter.recordLoginFailure("203.0.113.1", 0);
  limiter.recordLoginFailure("203.0.113.2", 1);
  limiter.recordLoginFailure("203.0.113.3", 2);
  assert.equal(limiter.entryCount(), 2);

  limiter.cleanupExpired(103, true);
  assert.equal(limiter.entryCount(), 0);
});
