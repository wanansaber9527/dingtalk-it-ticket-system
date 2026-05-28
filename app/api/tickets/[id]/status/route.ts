// 中文注释：处理人通用工单状态接口，服务层会校验是否为当前工单处理人或超级管理员。
import type { TicketStatus } from "@prisma/client";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ status: TicketStatus; remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.updateStatus(id, body.status, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
