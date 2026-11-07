import crypto from "crypto";
import { AppError } from "@/src/lib/http";
import { assertSafeAuthMode, isDevelopmentAuthEnabled, isDingTalkMockEnabled } from "@/src/server/auth-config";

// 本地显式模拟时使用进程级随机密钥，重启后会话失效；生产绝不使用默认密钥。
const developmentSecret = crypto.randomBytes(32).toString("hex");

function authSecret() {
  assertSafeAuthMode();
  const secret = process.env.AUTH_COOKIE_SECRET || "";
  if (Buffer.byteLength(secret) >= 32 && !/CHANGE_ME|local-dev-auth-secret/i.test(secret)) return secret;
  if (process.env.NODE_ENV !== "production" && (isDevelopmentAuthEnabled() || isDingTalkMockEnabled())) {
    return developmentSecret;
  }
  throw new AppError(500, "AUTH_SECRET_MISSING", "登录服务未配置有效的独立认证密钥");
}

export function assertAuthConfiguration() {
  authSecret();
}

export function authSessionTtlSeconds() {
  const value = Number(process.env.AUTH_SESSION_TTL_SECONDS || 43200);
  if (!Number.isInteger(value) || value < 300 || value > 604800) {
    throw new AppError(500, "AUTH_TTL_INVALID", "登录有效期配置无效");
  }
  return value;
}

function sign(value: string) {
  return crypto.createHmac("sha256", authSecret()).update(value).digest("base64url");
}

export type AuthSessionIdentity = { id: string; sessionVersion: number };
export type AuthSession = { userId: string; sessionVersion: number; issuedAt: number };

export function createAuthCookieValue(identity: AuthSessionIdentity | string, now = Date.now()) {
  const userId = typeof identity === "string" ? identity : identity.id;
  const sessionVersion = typeof identity === "string" ? 0 : identity.sessionVersion;
  if (!userId || userId.length > 256 || !Number.isInteger(sessionVersion) || sessionVersion < 0) throw new AppError(400, "INVALID_USER_ID", "用户身份无效");
  const payload = Buffer.from(JSON.stringify({ sub: userId, ver: sessionVersion, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + authSessionTtlSeconds() })).toString("base64url");
  const value = `v3.${payload}`;
  return `${value}.${sign(value)}`;
}

export function verifyAuthSession(session: string | null, now = Date.now()): AuthSession | null {
  if (!session || session.length > 2048) return null;
  const parts = session.split(".");
  // v2 只含钉钉 ID，无法撤销离职前会话；切换后必须重新免登。
  if (parts.length !== 3 || parts[0] !== "v3") return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const current = Math.floor(now / 1000);
    if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 256 || !Number.isInteger(payload.ver) || payload.ver < 0 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.iat > current + 60 || payload.exp <= current || payload.exp <= payload.iat || payload.exp - payload.iat > 604800) return null;
    return { userId: payload.sub, sessionVersion: payload.ver, issuedAt: payload.iat };
  } catch {
    return null;
  }
}

export function verifyAuthCookieValue(session: string | null, now = Date.now()): string | null {
  return verifyAuthSession(session, now)?.userId || null;
}

export function authCookieOptions(request: Request) {
  return { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:", sameSite: "lax" as const, maxAge: authSessionTtlSeconds() };
}

export function safeLoginRedirect(value: string | null, requestUrl: string) {
  const base = new URL(requestUrl);
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return new URL("/", base);
  const target = new URL(value, base);
  return target.origin === base.origin ? target : new URL("/", base);
}
