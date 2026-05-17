// 中文注释：钉钉通讯录人员选择接口，供后台新增管理员和执行人员时搜索选择。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { UserService } from "@/src/server/services/userService";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const url = new URL(request.url);
    const service = new UserService();
    return ok(await service.searchDingTalkUsers(url.searchParams.get("keyword") || undefined, user));
  } catch (error) {
    return fail(error);
  }
}
