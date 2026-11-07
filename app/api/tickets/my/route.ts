// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail, ok } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

import { parsePagination } from "@/src/server/services/serviceHelpers";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const service = new TicketService();
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") || "mine";
    if (scope !== "mine" && scope !== "cc") throw new AppError(400, "INVALID_SCOPE", "无效的工单范围");
    return ok(await service.listMyTickets(user, parsePagination(params), scope));
  } catch (error) {
    return fail(error);
  }
}
