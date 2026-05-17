// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { NotificationService } from "@/src/server/services/notificationService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const { id } = await context.params;
    const service = new NotificationService();
    return ok(await service.resend(id));
  } catch (error) {
    return fail(error);
  }
}
