// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台处理完成操作只允许管理员从后台接口发起。
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const { id } = await context.params;
    const body = await parseJson<{ resultSummary: string; toKnowledgeBase?: boolean }>(request);
    const service = new TicketService();
    return ok(await service.resolve(id, user, body.resultSummary, body.toKnowledgeBase));
  } catch (error) {
    return fail(error);
  }
}
