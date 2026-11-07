// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import type { TicketStatus } from "@prisma/client";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { TicketService, type TicketListFilters } from "@/src/server/services/ticketService";

import { parsePagination } from "@/src/server/services/serviceHelpers";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const url = new URL(request.url);
    const service = new TicketService();
    return ok(
      await service.listAdminTickets(
        {
          status: (url.searchParams.get("status") || undefined) as TicketStatus | undefined,
          statusGroup: (url.searchParams.get("statusGroup") || undefined) as TicketListFilters["statusGroup"],
          categoryId: url.searchParams.get("categoryId") || undefined,
          applicantDepartment: url.searchParams.get("applicantDepartment") || undefined,
          handlerUserId: url.searchParams.get("handlerUserId") || undefined,
          needsReassignment: url.searchParams.get("needsReassignment") === "true",
          overdue: url.searchParams.get("overdue") === "true",
          keyword: url.searchParams.get("keyword") || undefined,
          includeStats: url.searchParams.get("includeStats") === "true"
        },
        user,
        parsePagination(url.searchParams)
      )
    );
  } catch (error) {
    return fail(error);
  }
}
