// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { DashboardService } from "@/src/server/services/dashboardService";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const service = new DashboardService();
    return ok(await service.dashboard(user));
  } catch (error) {
    return fail(error);
  }
}
