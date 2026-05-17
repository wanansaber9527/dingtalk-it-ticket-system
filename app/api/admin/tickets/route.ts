// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import type { TicketStatus } from "@prisma/client";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const url = new URL(request.url);
    const service = new TicketService();
    return ok(
      await service.listAdminTickets(
        {
          status: (url.searchParams.get("status") || undefined) as TicketStatus | undefined,
          categoryId: url.searchParams.get("categoryId") || undefined,
          applicantDepartment: url.searchParams.get("applicantDepartment") || undefined,
          handlerUserId: url.searchParams.get("handlerUserId") || undefined,
          overdue: url.searchParams.get("overdue") === "true",
          keyword: url.searchParams.get("keyword") || undefined
        },
        user
      )
    );
  } catch (error) {
    return fail(error);
  }
}
