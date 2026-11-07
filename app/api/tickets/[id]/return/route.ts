// 中文注释：处理人退回工单给发起人补充信息，服务层会校验当前处理权限和状态。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.returnToApplicant(id, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
