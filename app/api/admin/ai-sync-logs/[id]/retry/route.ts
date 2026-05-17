// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { DingTalkAiTableClient } from "@/src/server/dingtalk/DingTalkAiTableClient";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const { id } = await context.params;
    const client = new DingTalkAiTableClient();
    return ok(await client.retryFailedSyncLog(id));
  } catch (error) {
    return fail(error);
  }
}
