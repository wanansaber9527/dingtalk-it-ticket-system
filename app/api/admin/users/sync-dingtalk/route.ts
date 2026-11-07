// 中文注释：同步钉钉通讯录成员到系统用户表，供权限管理页批量维护角色。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const service = new DirectorySyncService();
    return ok(await service.run({ trigger: "MANUAL", operator: user }));
  } catch (error) {
    return fail(error);
  }
}
