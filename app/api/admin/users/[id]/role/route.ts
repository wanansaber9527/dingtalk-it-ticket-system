// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import type { UserRole, UserStatus } from "@prisma/client";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { UserService } from "@/src/server/services/userService";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ role: UserRole; status?: UserStatus }>(request);
    const service = new UserService();
    return ok(await service.updateRole(id, body.role, user, body.status));
  } catch (error) {
    return fail(error);
  }
}
