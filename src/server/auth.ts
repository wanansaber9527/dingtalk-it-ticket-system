// 中文注释：服务端基础能力，处理身份识别和权限判断。
import { prisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { isDevelopmentAuthEnabled } from "@/src/server/auth-config";
import { assertAuthConfiguration, verifyAuthSession } from "@/src/server/auth-session";
export { createAuthCookieValue } from "@/src/server/auth-session";

type CurrentUserOptions = {
  unauthorizedMessage?: string;
};

function readHeader(request: Request, name: string) {
  return request.headers.get(name) ?? request.headers.get(name.toLowerCase());
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  try {
    return pair ? decodeURIComponent(pair.split("=").slice(1).join("=")) : null;
  } catch {
    return null;
  }
}

function findUserWithRoles(dingtalkUserId: string) {
  return prisma.user.findUnique({
    where: { dingtalkUserId },
    include: { roleAssignments: true }
  });
}

function findUserWithRolesOrThrow(dingtalkUserId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { dingtalkUserId },
    include: { roleAssignments: true }
  });
}

async function ensureUserRole(userId: string, role: "EMPLOYEE" | "SUPER_ADMIN") {
  await prisma.userRoleAssignment.upsert({
    where: { userId_role: { userId, role } },
    update: {},
    create: { userId, role }
  });
}

export async function getCurrentUser(request: Request, options: CurrentUserOptions = {}) {
  assertAuthConfiguration();
  // 中文注释：正式环境只信任后端签发的免登 cookie，避免用户通过 header/query 伪造身份。
  const url = new URL(request.url);
  const devAuthEnabled = isDevelopmentAuthEnabled();
  const session = verifyAuthSession(readCookie(request, "it_session"));
  const developmentUserId = devAuthEnabled
    ? readHeader(request, "x-dingtalk-userid") ?? url.searchParams.get("dingtalkUserId") ?? readCookie(request, "it_userid")
    : null;
  if (session || developmentUserId) {
    const user = session
      ? await prisma.user.findUnique({ where: { id: session.userId }, include: { roleAssignments: true } })
      : await findUserWithRoles(developmentUserId!);
    if (!user) throw new AppError(401, "USER_NOT_FOUND", "未找到当前用户，请重新从钉钉进入系统");
    if (user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId || user.manuallyDisabled) {
      throw new AppError(403, "USER_DISABLED", "当前用户已离职或被禁用");
    }
    if (session && session.sessionVersion !== user.sessionVersion) throw new AppError(401, "SESSION_REVOKED", "登录状态已失效，请重新从钉钉进入系统");
    return user;
  }

  if (devAuthEnabled) {
    // 中文注释：开发模式自动创建超级管理员，方便未接入钉钉时完整体验后台功能。
    const dingtalkUserId = process.env.DEV_DINGTALK_USER_ID || "demo-super";
    const user = await prisma.user.upsert({
      where: { dingtalkUserId },
      update: {
        name: process.env.DEV_USER_NAME || "超级管理员",
        mobile: process.env.DEV_USER_MOBILE || null,
        departmentId: process.env.DEV_USER_DEPARTMENT_ID || null,
        departmentName: process.env.DEV_USER_DEPARTMENT_NAME || "信息技术部",
        position: process.env.DEV_USER_POSITION || null
      },
      create: {
        dingtalkUserId,
        name: process.env.DEV_USER_NAME || "超级管理员",
        mobile: process.env.DEV_USER_MOBILE || null,
        departmentId: process.env.DEV_USER_DEPARTMENT_ID || null,
        departmentName: process.env.DEV_USER_DEPARTMENT_NAME || "信息技术部",
        position: process.env.DEV_USER_POSITION || null
      }
    });
    if (user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId || user.manuallyDisabled) throw new AppError(403, "USER_DISABLED", "当前用户已被禁用");
    await ensureUserRole(user.id, "EMPLOYEE");
    await ensureUserRole(user.id, "SUPER_ADMIN");
    return findUserWithRolesOrThrow(dingtalkUserId);
  }

  throw new AppError(401, "UNAUTHORIZED", options.unauthorizedMessage || "未识别到钉钉身份，请重新从钉钉进入系统");
}
