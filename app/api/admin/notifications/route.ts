// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { prisma } from "@/src/lib/prisma";
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const items = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return ok(items);
  } catch (error) {
    return fail(error);
  }
}
