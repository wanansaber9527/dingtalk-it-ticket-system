// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "@/src/server/services/ticketService";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台详情接口必须由管理员访问，避免处理人绕过前端直接进入后台。
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const { id } = await context.params;
    const service = new TicketService();
    return ok(await service.getTicketForUser(id, user));
  } catch (error) {
    return fail(error);
  }
}
