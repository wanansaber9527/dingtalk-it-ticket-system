// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService, type CreateTicketInput } from "@/src/server/services/ticketService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request, { unauthorizedMessage: "未获取到钉钉用户信息，禁止提交工单。" });
    const input = await parseJson<CreateTicketInput>(request);
    const service = new TicketService();
    return ok(await service.createTicket(input, user), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
