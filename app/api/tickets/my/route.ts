// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const service = new TicketService();
    return ok(await service.listMyTickets(user));
  } catch (error) {
    return fail(error);
  }
}
