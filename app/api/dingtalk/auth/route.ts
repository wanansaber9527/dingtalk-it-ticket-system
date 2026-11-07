// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { NextResponse } from "next/server";
import { AppError, fail, ok } from "@/src/lib/http";
import { DingTalkAuthService } from "@/src/server/services/dingtalkAuthService";
import { createAuthCookieValue } from "@/src/server/auth";
import { authCookieOptions, safeLoginRedirect } from "@/src/server/auth-session";

function setLoginCookie(response: NextResponse, user: { id: string; sessionVersion: number }, request: Request) {
  // 中文注释：登录态使用后端签名 cookie，避免用户手动伪造钉钉 userId。
  response.cookies.set("it_session", createAuthCookieValue(user), authCookieOptions(request));
  response.cookies.delete("it_userid");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const redirect = url.searchParams.get("redirect") || "/";
    if (!code) throw new AppError(400, "AUTH_CODE_REQUIRED", "缺少钉钉免登 code");
    const service = new DingTalkAuthService();
    const user = await service.loginByCode(code);
    if (url.searchParams.get("json") === "true") {
      const response = ok(user);
      setLoginCookie(response, user, request);
      return response;
    }
    const response = NextResponse.redirect(safeLoginRedirect(redirect, request.url));
    setLoginCookie(response, user, request);
    return response;
  } catch (error) {
    return fail(error);
  }
}
