// 中文注释：执行人员维护接口，删除执行人员时只取消角色，不物理删除用户。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { UserService } from "@/src/server/services/userService";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const service = new UserService();
    return ok(await service.removeExecutor(id, user));
  } catch (error) {
    return fail(error);
  }
}
