// 中文注释：同步钉钉通讯录成员到系统用户表，供权限管理页批量维护角色。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { UserService } from "@/src/server/services/userService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const service = new UserService();
    return ok(await service.syncDingTalkDirectory(user));
  } catch (error) {
    return fail(error);
  }
}
