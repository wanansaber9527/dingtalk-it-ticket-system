// 中文注释：服务端基础能力，处理身份识别和权限判断。
import type { Ticket, User, UserRole } from "@prisma/client";
import { AppError } from "@/src/lib/http";

const roleRank: Record<UserRole, number> = {
  // 中文注释：角色等级用于判断“至少具备某角色”的权限场景。
  EMPLOYEE: 1,
  IT_HANDLER: 2,
  IT_ADMIN: 3,
  SUPER_ADMIN: 4
};

export function hasAnyRole(user: User, roles: UserRole[]) {
  return roles.includes(user.role);
}

export function hasAtLeastRole(user: User, role: UserRole) {
  return roleRank[user.role] >= roleRank[role];
}

export function requireActiveUser(user: User) {
  if (user.status !== "ACTIVE") {
    throw new AppError(403, "USER_DISABLED", "当前用户已被禁用");
  }
}

export function requireRole(user: User, roles: UserRole[]) {
  requireActiveUser(user);
  if (!hasAnyRole(user, roles)) {
    const adminOnly = roles.every((role) => ["IT_ADMIN", "SUPER_ADMIN"].includes(role));
    throw new AppError(403, "FORBIDDEN", adminOnly ? "无管理员权限，禁止访问后台。" : "无权访问该资源");
  }
}

export function isAdmin(user: Pick<User, "role" | "status">) {
  return user.status === "ACTIVE" && ["IT_ADMIN", "SUPER_ADMIN"].includes(user.role);
}

export function requireAdmin(user: User) {
  requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
}

export function canViewTicket(user: User, ticket: Pick<Ticket, "applicantUserId" | "handlerUserId">) {
  // 中文注释：工单查看权限必须在后端判断，不能只依赖前端页面隐藏。
  if (hasAnyRole(user, ["IT_ADMIN", "SUPER_ADMIN"])) return true;
  if (user.role === "IT_HANDLER" && ticket.handlerUserId === user.dingtalkUserId) return true;
  return ticket.applicantUserId === user.dingtalkUserId;
}

export function requireCanViewTicket(user: User, ticket: Pick<Ticket, "applicantUserId" | "handlerUserId">) {
  requireActiveUser(user);
  if (!canViewTicket(user, ticket)) {
    throw new AppError(403, "FORBIDDEN", "只能查看自己的工单或分配给自己的工单");
  }
}

export function requireTicketOperator(user: User, ticket: Pick<Ticket, "handlerUserId">) {
  requireActiveUser(user);
  if (hasAnyRole(user, ["IT_ADMIN", "SUPER_ADMIN"])) return;
  if (user.role === "IT_HANDLER" && ticket.handlerUserId === user.dingtalkUserId) return;
  throw new AppError(403, "FORBIDDEN", "无权处理该工单");
}

export function requireSuperAdmin(user: User) {
  requireRole(user, ["SUPER_ADMIN"]);
}
