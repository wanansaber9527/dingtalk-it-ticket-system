// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { DingTalkAiTableClient } from "@/src/server/dingtalk/DingTalkAiTableClient";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const { id } = await context.params;
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    const client = new DingTalkAiTableClient();
    await client.syncTicket(ticket);
    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
