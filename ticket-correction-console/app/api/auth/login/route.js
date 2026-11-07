import crypto from "node:crypto";
import { authConfig } from "@/lib/server-config";
import {
  assertSameOrigin,
  createSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions
} from "@/lib/auth";
import { AppError, jsonError, jsonOk, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import {
  clearLoginFailures,
  loginAttemptState,
  recordLoginFailure,
  requestIdentity
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function safeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const identity = requestIdentity(request);
    const attempt = loginAttemptState(identity);
    if (!attempt.allowed) {
      throw new AppError(
        429,
        "LOGIN_LOCKED",
        `登录失败次数过多，请在 ${attempt.retryAfterSeconds} 秒后重试`
      );
    }

    const body = await readJson(request, 8 * 1024);
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password || username.length > 191 || password.length > 1024) {
      recordLoginFailure(identity);
      throw new AppError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
    }

    const config = authConfig();
    const [usernameMatches, passwordMatches] = await Promise.all([
      Promise.resolve(safeTextEqual(username, config.username)),
      verifyPassword(password, config.passwordHash)
    ]);
    if (!usernameMatches || !passwordMatches) {
      const state = recordLoginFailure(identity);
      if (!state.allowed) {
        throw new AppError(
          429,
          "LOGIN_LOCKED",
          `登录失败次数过多，请在 ${state.retryAfterSeconds} 秒后重试`
        );
      }
      throw new AppError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
    }

    clearLoginFailures(identity);
    const { token, session } = createSession(config.username);
    const response = jsonOk({
      username: session.sub,
      csrf: session.csrf,
      expiresAt: new Date(session.exp).toISOString()
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(session));
    return response;
  } catch (error) {
    const response = jsonError(error);
    if (error instanceof AppError && error.status === 429) {
      response.headers.set("Retry-After", "900");
    }
    return response;
  }
}
