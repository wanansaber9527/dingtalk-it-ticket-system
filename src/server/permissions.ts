// 中文注释：服务端基础能力，处理身份识别和权限判断。
import type { Ticket, UserRole } from "@prisma/client";
import { AppError } from "@/src/lib/http";
import { hasUserRole, roleOrder, userRoles, type RoleCarrier, type UserWithRoles } from "@/src/lib/userRoles";
import { matchesPerson } from "@/src/server/personnelAccess";

export function hasAnyRole(user: RoleCarrier, roles: UserRole[]) {
  return hasUserRole(user, roles);
}

export function hasAtLeastRole(user: RoleCarrier, role: UserRole) {
  const highestRole = userRoles(user)
    .sort((a, b) => roleOrder.indexOf(b) - roleOrder.indexOf(a))[0];
  return roleOrder.indexOf(highestRole) >= roleOrder.indexOf(role);
}

export function requireActiveUser(user: UserWithRoles) {
  if (user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId) {
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

export type TicketAccess = Pick<Ticket, "applicantUserId" | "handlerUserId"> & {
  applicantId?: string | null;
  handlerId?: string | null;
  ccRecipients?: { userId: string; personId?: string | null }[];
};

export function isTicketApplicant(user: UserWithRoles, ticket: Pick<TicketAccess, "applicantId" | "applicantUserId">) {
  return matchesPerson(user, ticket.applicantId, ticket.applicantUserId);
}

export function isTicketHandler(user: UserWithRoles, ticket: Pick<TicketAccess, "handlerId" | "handlerUserId">) {
  return matchesPerson(user, ticket.handlerId, ticket.handlerUserId);
}

export function canCommentTicket(user: UserWithRoles, ticket: TicketAccess) {
  if (user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId) return false;
  if (hasAnyRole(user, ["SUPER_ADMIN"])) return true;
  if (hasAnyRole(user, ["IT_HANDLER"]) && isTicketHandler(user, ticket)) return true;
  return isTicketApplicant(user, ticket);
}

export function canViewTicket(user: UserWithRoles, ticket: TicketAccess) {
  // 抄送仅增加该工单的读取权限，不能复用为评论或处理授权。
  if (user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId) return false;
  return canCommentTicket(user, ticket) || Boolean(ticket.ccRecipients?.some((recipient) => matchesPerson(user, recipient.personId, recipient.userId)));
}

export function requireCanViewTicket(user: UserWithRoles, ticket: TicketAccess) {
  requireActiveUser(user);
  if (!canViewTicket(user, ticket)) {
    throw new AppError(403, "FORBIDDEN", "只能查看自己发起、负责处理或被抄送的工单");
  }
}

export function requireCanCommentTicket(user: UserWithRoles, ticket: TicketAccess) {
  requireActiveUser(user);
  if (!canCommentTicket(user, ticket)) {
    throw new AppError(403, "FORBIDDEN", "仅发起人、当前处理人或管理员可以添加工单说明");
  }
}

export function ticketPermissions(user: UserWithRoles, ticket: TicketAccess & Pick<Ticket, "status">) {
  const active = user.status === "ACTIVE" && user.employmentStatus !== "DEPARTED" && !user.mergedIntoId;
  const isApplicant = active && isTicketApplicant(user, ticket);
  const canComment = canCommentTicket(user, ticket);
  return {
    canComment,
    canSupplement: isApplicant && ticket.status === "RETURNED",
    canRate: isApplicant && ["COMPLETED", "CLOSED"].includes(ticket.status),
    canOperate: active && (hasAnyRole(user, ["SUPER_ADMIN"]) || (hasAnyRole(user, ["IT_HANDLER"]) && isTicketHandler(user, ticket))),
    isCcOnly: canViewTicket(user, ticket) && !canComment
  };
}

export function requireTicketOperator(user: UserWithRoles, ticket: Pick<TicketAccess, "handlerId" | "handlerUserId">) {
  requireActiveUser(user);
  if (hasAnyRole(user, ["SUPER_ADMIN"])) return;
  if (hasAnyRole(user, ["IT_HANDLER"]) && isTicketHandler(user, ticket)) return;
  throw new AppError(403, "FORBIDDEN", "无权处理该工单");
}

export function requireSuperAdmin(user: UserWithRoles) {
  requireRole(user, ["SUPER_ADMIN"]);
}
