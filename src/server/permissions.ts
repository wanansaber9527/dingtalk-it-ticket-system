// 中文注释：服务端基础能力，处理身份识别和权限判断。
import type { Ticket, UserRole } from "@prisma/client";
import { AppError } from "@/src/lib/http";
import { hasUserRole, roleOrder, userRoles, type RoleCarrier, type UserWithRoles } from "@/src/lib/userRoles";

export function hasAnyRole(user: RoleCarrier, roles: UserRole[]) {
  return hasUserRole(user, roles);
}

export function hasAtLeastRole(user: RoleCarrier, role: UserRole) {
  const highestRole = userRoles(user)
    .sort((a, b) => roleOrder.indexOf(b) - roleOrder.indexOf(a))[0];
  return roleOrder.indexOf(highestRole) >= roleOrder.indexOf(role);
}

export function requireActiveUser(user: UserWithRoles) {
  if (user.status !== "ACTIVE") {
    throw new AppError(403, "USER_DISABLED", "当前用户已被禁用");
  }
}

export function requireRole(user: UserWithRoles, roles: UserRole[]) {
  requireActiveUser(user);
  if (!hasAnyRole(user, roles)) {
    const adminOnly = roles.every((role) => role === "SUPER_ADMIN");
    throw new AppError(403, "FORBIDDEN", adminOnly ? "无管理员权限，禁止访问后台。" : "无权访问该资源");
  }
}

export function isAdmin(user: Pick<UserWithRoles, "roleAssignments" | "status">) {
  return user.status === "ACTIVE" && hasAnyRole(user, ["SUPER_ADMIN"]);
}

export function requireAdmin(user: UserWithRoles) {
  requireRole(user, ["SUPER_ADMIN"]);
}

export function canViewTicket(user: UserWithRoles, ticket: Pick<Ticket, "applicantUserId" | "handlerUserId">) {
  // 中文注释：工单查看权限必须在后端判断，不能只依赖前端页面隐藏。
  if (hasAnyRole(user, ["SUPER_ADMIN"])) return true;
  if (hasAnyRole(user, ["IT_HANDLER"]) && ticket.handlerUserId === user.dingtalkUserId) return true;
  return ticket.applicantUserId === user.dingtalkUserId;
}

export function requireCanViewTicket(user: UserWithRoles, ticket: Pick<Ticket, "applicantUserId" | "handlerUserId">) {
  requireActiveUser(user);
  if (!canViewTicket(user, ticket)) {
    throw new AppError(403, "FORBIDDEN", "只能查看自己的工单或分配给自己的工单");
  }
}

export function requireTicketOperator(user: UserWithRoles, ticket: Pick<Ticket, "handlerUserId">) {
  requireActiveUser(user);
  if (hasAnyRole(user, ["SUPER_ADMIN"])) return;
  if (hasAnyRole(user, ["IT_HANDLER"]) && ticket.handlerUserId === user.dingtalkUserId) return;
  throw new AppError(403, "FORBIDDEN", "无权处理该工单");
}

export function requireSuperAdmin(user: UserWithRoles) {
  requireRole(user, ["SUPER_ADMIN"]);
}
