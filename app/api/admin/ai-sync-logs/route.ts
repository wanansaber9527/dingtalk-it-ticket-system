// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { DingTalkAiTableClient } from "@/src/server/dingtalk/DingTalkAiTableClient";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const logs = await prisma.aiTableSyncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return ok(logs);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const client = new DingTalkAiTableClient();
    return ok(await client.retryFailedSyncLog());
  } catch (error) {
    return fail(error);
  }
}
