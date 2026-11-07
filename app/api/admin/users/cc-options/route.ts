import { getCurrentUser } from "@/src/server/auth";
import { requireRole } from "@/src/server/permissions";
import { prisma } from "@/src/lib/prisma";
import { fail, ok } from "@/src/lib/http";

export async function GET(request: Request) {
  try {
    const operator = await getCurrentUser(request);
    requireRole(operator, ["SUPER_ADMIN"]);
    const keyword = (new URL(request.url).searchParams.get("keyword") || "").trim().slice(0, 191);
    const users = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        ...(keyword ? { OR: [{ name: { contains: keyword } }, { departmentName: { contains: keyword } }] } : {})
      },
      select: { dingtalkUserId: true, name: true, departmentName: true, status: true },
      orderBy: [{ name: "asc" }, { dingtalkUserId: "asc" }],
      take: 100
    });
    return ok(users.map(({ dingtalkUserId, ...user }) => ({ userId: dingtalkUserId, ...user })));
  } catch (error) {
    return fail(error);
  }
}
