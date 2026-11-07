// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { AppError, fail, ok, parseJson } from "@/src/lib/http";
import { DingTalkAuthService } from "@/src/server/services/dingtalkAuthService";
import { createAuthCookieValue } from "@/src/server/auth";
import { authCookieOptions } from "@/src/server/auth-session";

export async function POST(request: Request) {
  try {
    const body = await parseJson<{ code?: string }>(request);
    if (typeof body.code !== "string" || !body.code.trim()) throw new AppError(400, "AUTH_CODE_REQUIRED", "缺少钉钉免登 code");
    const service = new DingTalkAuthService();
    const user = await service.loginByCode(body.code);
    const response = ok(user);
    // 中文注释：免登成功后写入后端签名 cookie，后续接口只信任该登录态。
    response.cookies.set("it_session", createAuthCookieValue(user), authCookieOptions(request));
    response.cookies.delete("it_userid");
    return response;
  } catch (error) {
    return fail(error);
  }
}
