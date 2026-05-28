// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台关闭工单属于管理员后台能力，路由层先做管理员权限校验。
    requireRole(user, ["SUPER_ADMIN"]);
    const { id } = await context.params;
    const body = await parseJson<{ remark?: string; silentDelete?: boolean }>(request);
    const service = new TicketService();
    if (body.silentDelete) {
      return ok(await service.silentDelete(id, user));
    }
    return ok(await service.close(id, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
