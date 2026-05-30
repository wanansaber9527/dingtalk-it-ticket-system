// 中文注释：处理人调整工单预计处理时间接口，避免排期变化导致工单被直接判定超时。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ slaResolveDeadline?: string; remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.adjustResolveDeadline(id, user, body.slaResolveDeadline || "", body.remark));
  } catch (error) {
    return fail(error);
  }
}
