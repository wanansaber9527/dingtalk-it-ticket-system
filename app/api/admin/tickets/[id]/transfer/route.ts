// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "@/src/server/services/ticketService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台转交接口只开放给管理员，执行人员使用员工/处理端流程。
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const { id } = await context.params;
    const body = await parseJson<{ handlerUserId: string; remark?: string }>(request);
    const service = new TicketService();
    return ok(await service.transfer(id, body.handlerUserId, user, body.remark));
  } catch (error) {
    return fail(error);
  }
}
