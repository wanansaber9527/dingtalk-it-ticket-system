// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<{ resultSummary: string; toKnowledgeBase?: boolean }>(request);
    const service = new TicketService();
    return ok(await service.resolve(id, user, body.resultSummary, body.toKnowledgeBase));
  } catch (error) {
    return fail(error);
  }
}
