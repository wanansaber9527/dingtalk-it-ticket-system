import crypto from "node:crypto";
import { authConfig } from "./server-config.js";
import { AppError } from "./http.js";

export const SESSION_COOKIE_NAME = "quran_ticket_correction_session";

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(username, now = Date.now()) {
  const config = authConfig();
  const payload = {
    sub: username,
    iat: now,
    exp: now + config.sessionTtlMinutes * 60 * 1000,
    csrf: crypto.randomBytes(24).toString("base64url"),
    sid: crypto.randomUUID()
  };
  const encoded = encode(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded, config.sessionSecret)}`,
    session: payload
  };
}

export function verifySessionToken(token, now = Date.now()) {
  if (!token || typeof token !== "string") return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) return null;

  const config = authConfig();
  if (!safeEqual(signature, sign(encoded, config.sessionSecret))) return null;

  try {
    const payload = JSON.parse(decode(encoded));
    if (
      payload.sub !== config.username ||
      !Number.isFinite(payload.iat) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now ||
      typeof payload.csrf !== "string" ||
      typeof payload.sid !== "string"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const item = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return item ? decodeURIComponent(item.slice(SESSION_COOKIE_NAME.length + 1)) : null;
}

export function sessionFromRequest(request) {
  return verifySessionToken(cookieValue(request));
}

export function requireSession(request) {
  const session = sessionFromRequest(request);
  if (!session) {
    throw new AppError(401, "UNAUTHORIZED", "登录已失效，请重新登录");
  }
  return session;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) {
    throw new AppError(403, "ORIGIN_REQUIRED", "请求来源校验失败");
  }

  try {
    if (new URL(origin).host !== host) {
      throw new AppError(403, "ORIGIN_MISMATCH", "请求来源校验失败");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(403, "ORIGIN_INVALID", "请求来源校验失败");
  }
}

export function assertMutationRequest(request, session) {
  assertSameOrigin(request);
  const csrf = request.headers.get("x-correction-csrf");
  if (!csrf || !safeEqual(csrf, session.csrf)) {
    throw new AppError(403, "CSRF_INVALID", "页面令牌已失效，请刷新后重试");
  }
}

export function sessionCookieOptions(session) {
  const config = authConfig();
  return {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "strict",
    path: config.cookiePath,
    expires: new Date(session.exp)
  };
}
