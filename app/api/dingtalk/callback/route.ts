// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { fail, ok, parseJson } from "@/src/lib/http";
import { DingTalkAuthService } from "@/src/server/services/dingtalkAuthService";
import { createAuthCookieValue } from "@/src/server/auth";

export async function POST(request: Request) {
  try {
    const body = await parseJson<{ code?: string }>(request);
    if (!body.code) throw new Error("缺少钉钉免登 code");
    const service = new DingTalkAuthService();
    const user = await service.loginByCode(body.code);
    const response = ok(user);
    // 中文注释：免登成功后写入后端签名 cookie，后续接口只信任该登录态。
    response.cookies.set("it_session", createAuthCookieValue(user.dingtalkUserId), {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    });
    response.cookies.delete("it_userid");
    return response;
  } catch (error) {
    return fail(error);
  }
}
