import net from "node:net";

const GLOBAL_KEY = Symbol.for("quran.ticket-correction.login-rate-limit.v2");

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_ENTRIES = 4096;
const CLEANUP_INTERVAL_MS = 60 * 1000;

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export function createLoginRateLimiter(options = {}) {
  const windowMs = positiveInteger(options.windowMs ?? WINDOW_MS, "windowMs");
  const lockMs = positiveInteger(options.lockMs ?? LOCK_MS, "lockMs");
  const maxFailures = positiveInteger(
    options.maxFailures ?? MAX_FAILURES,
    "maxFailures"
  );
  const maxEntries = positiveInteger(
    options.maxEntries ?? MAX_ENTRIES,
    "maxEntries"
  );
  const cleanupIntervalMs = options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS;
  if (!Number.isInteger(cleanupIntervalMs) || cleanupIntervalMs < 0) {
    throw new TypeError("cleanupIntervalMs must be a non-negative integer");
  }

  const attempts = new Map();
  let lastCleanupAt = Number.NEGATIVE_INFINITY;

  function expiresAt(entry) {
    return Math.max(entry.windowStartedAt + windowMs, entry.lockedUntil);
  }

  function cleanupExpired(now = Date.now(), force = false) {
    if (!force && now - lastCleanupAt < cleanupIntervalMs) return 0;
    let removed = 0;
    for (const [key, entry] of attempts) {
      if (expiresAt(entry) <= now) {
        attempts.delete(key);
        removed += 1;
      }
    }
    lastCleanupAt = now;
    return removed;
  }

  function makeRoom(now) {
    cleanupExpired(now, true);
    if (attempts.size < maxEntries) return;

    let oldestKey;
    let oldestTouchedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of attempts) {
      if (entry.lastTouchedAt < oldestTouchedAt) {
        oldestKey = key;
        oldestTouchedAt = entry.lastTouchedAt;
      }
    }
    if (oldestKey !== undefined) attempts.delete(oldestKey);
  }

  function loginAttemptState(key, now = Date.now()) {
    cleanupExpired(now);
    const entry = attempts.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };

    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.lockedUntil - now) / 1000)
        )
      };
    }

    if (now - entry.windowStartedAt >= windowMs) {
      attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  function recordLoginFailure(key, now = Date.now()) {
    cleanupExpired(now);
    const current = attempts.get(key);
    let entry;
    if (current && now - current.windowStartedAt < windowMs) {
      entry = current;
    } else {
      if (!current) makeRoom(now);
      entry = {
        failures: 0,
        windowStartedAt: now,
        lockedUntil: 0,
        lastTouchedAt: now
      };
    }

    entry.failures += 1;
    entry.lastTouchedAt = now;
    if (entry.failures >= maxFailures) {
      entry.lockedUntil = now + lockMs;
    }
    attempts.set(key, entry);
    return loginAttemptState(key, now);
  }

  function clearLoginFailures(key) {
    attempts.delete(key);
  }

  return {
    loginAttemptState,
    recordLoginFailure,
    clearLoginFailures,
    cleanupExpired,
    entryCount: () => attempts.size
  };
}

function limiter() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = createLoginRateLimiter();
  }
  return globalThis[GLOBAL_KEY];
}

export function loginAttemptState(key, now = Date.now()) {
  return limiter().loginAttemptState(key, now);
}

export function recordLoginFailure(key, now = Date.now()) {
  return limiter().recordLoginFailure(key, now);
}

export function clearLoginFailures(key) {
  limiter().clearLoginFailures(key);
}

export function requestIdentity(request) {
  const realIp = request.headers.get("x-real-ip")?.trim() || "";
  return net.isIP(realIp) ? realIp : "unknown";
}
