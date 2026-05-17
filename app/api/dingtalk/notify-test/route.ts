// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { NotificationService } from "@/src/server/services/notificationService";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const body = await parseJson<{ receiverUserId?: string; receiverName?: string; content?: string }>(request);
    const service = new NotificationService();
    return ok(
      await service.sendTicketNotification(
        null,
        { dingtalkUserId: body.receiverUserId || user.dingtalkUserId, name: body.receiverName || user.name },
        "STATUS_UPDATED",
        body.content || "IT工单系统通知测试"
      )
    );
  } catch (error) {
    return fail(error);
  }
}
