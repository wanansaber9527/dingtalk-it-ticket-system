// 中文注释：处理人通用转交接口，服务层校验当前用户是否有权处理该工单。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ handlerUserId: string; remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.transfer(id, body.handlerUserId, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
