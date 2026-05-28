// 中文注释：用户身份工具，只基于 UserRoleAssignment 关联表判断身份，不兼容旧的单字段角色方案。
import type { User, UserRole, UserRoleAssignment } from "@prisma/client";

export type UserWithRoles = User & {
  roleAssignments: Pick<UserRoleAssignment, "role">[];
};

export type RoleCarrier = {
  roleAssignments?: Pick<UserRoleAssignment, "role">[] | null;
};

export const roleOrder: UserRole[] = ["EMPLOYEE", "IT_HANDLER", "SUPER_ADMIN"];

export const manageableRoles: UserRole[] = ["SUPER_ADMIN", "IT_HANDLER"];

export function normalizeRoles(roles: Iterable<UserRole>) {
  const unique = new Set<UserRole>();
  for (const role of roles) {
    if (roleOrder.includes(role)) unique.add(role);
  }
  return roleOrder.filter((role) => unique.has(role));
}

export function userRoles(user: RoleCarrier) {
  return normalizeRoles((user.roleAssignments || []).map((item) => item.role));
}

export function hasUserRole(user: RoleCarrier, roles: UserRole[]) {
  const assignedRoles = new Set(userRoles(user));
  return roles.some((role) => assignedRoles.has(role));
}

export function roleLabelList(user: RoleCarrier) {
  return userRoles(user);
}
