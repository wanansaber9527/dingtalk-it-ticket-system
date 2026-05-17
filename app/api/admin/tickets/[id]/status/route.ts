// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import type { TicketStatus } from "@prisma/client";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台状态修改接口在路由层统一限制管理员身份。
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const { id } = await context.params;
    const body = await parseJson<{ status: TicketStatus; remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.updateStatus(id, body.status, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
