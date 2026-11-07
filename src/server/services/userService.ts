// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { Prisma, PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole, requireSuperAdmin } from "@/src/server/permissions";
import { AppError } from "@/src/lib/http";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkClient, type DingTalkSelectableUser } from "@/src/server/dingtalk/DingTalkClient";
import { PersonnelIdentityService } from "@/src/server/services/personnelIdentityService";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export type PersonnelInput = Partial<DingTalkSelectableUser> & {
  dingtalkUserId: string;
};

const userInclude = { roleAssignments: true } satisfies Prisma.UserInclude;

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export class UserService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  list(operator: UserWithRoles, keyword?: string, employment: "ACTIVE" | "DEPARTED" | "ALL" = "ACTIVE") {
    requireRole(operator, ["SUPER_ADMIN"]);
    const search = textValue(keyword);
    return this.prisma.user.findMany({
      where: {
        mergedIntoId: null,
        ...(employment === "ALL" ? {} : { employmentStatus: employment }),
        ...(search ? { OR: [
          { name: { contains: search } }, { dingtalkUserId: { contains: search } },
          { departmentName: { contains: search } }, { position: { contains: search } }, { mobile: { contains: search } }
        ] } : {})
      },
      include: userInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 2000
    });
  }

  admins(operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE", employmentStatus: "ACTIVE", mergedIntoId: null },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  executors(operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "IT_HANDLER" } }, status: "ACTIVE", employmentStatus: "ACTIVE", mergedIntoId: null },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  async updateStatus(id: string, operator: UserWithRoles, status?: UserStatus) {
    requireSuperAdmin(operator);
    if (!status) {
      return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    }
    if (status !== "ACTIVE" && status !== "DISABLED") throw new AppError(400, "INVALID_USER_STATUS", "用户状态无效");
    return this.prisma.$transaction(async (tx) => {
      await this.requireCurrentAdmin(tx, operator);
      if (status === "DISABLED") await this.protectLastAdmin(tx, id);
      const target = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      if (target.employmentStatus === "DEPARTED" || target.mergedIntoId) throw new AppError(409, "USER_DEPARTED", "离职人员需先完成返聘身份核验，不能直接启用");
      return tx.user.update({ where: { id }, data: { status, manuallyDisabled: status === "DISABLED", sessionVersion: { increment: 1 } }, include: userInclude });
    }, { isolationLevel: "Serializable" });
  }

  handlers(operator: UserWithRoles) {
    // 中文注释：处理人转交工单时也需要读取可转交的处理人列表。
    requireRole(operator, ["SUPER_ADMIN", "IT_HANDLER"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "IT_HANDLER" } }, status: "ACTIVE", employmentStatus: "ACTIVE", mergedIntoId: null },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  async addAdmin(input: PersonnelInput, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "SUPER_ADMIN", operator);
  }

  async removeAdmin(id: string, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    return this.prisma.$transaction(async (tx) => {
      await this.requireCurrentAdmin(tx, operator);
      await this.protectLastAdmin(tx, id);
      await tx.userRoleAssignment.deleteMany({ where: { userId: id, role: "SUPER_ADMIN" } });
      return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    }, { isolationLevel: "Serializable" });
  }

  private async requireCurrentAdmin(tx: Prisma.TransactionClient, operator: UserWithRoles) {
    const current = await tx.user.findUnique({ where: { id: operator.id }, include: userInclude });
    if (!current) throw new AppError(403, "FORBIDDEN", "无管理员权限，禁止访问后台。");
    requireSuperAdmin(current);
  }

  private async protectLastAdmin(tx: Prisma.TransactionClient, id: string) {
    const target = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    if (target.status !== "ACTIVE" || !target.roleAssignments.some((item) => item.role === "SUPER_ADMIN")) return;
    const count = await tx.user.count({ where: { status: "ACTIVE", roleAssignments: { some: { role: "SUPER_ADMIN" } } } });
    if (count <= 1) throw new AppError(409, "LAST_ADMIN_REQUIRED", "至少需要保留一名启用的超级管理员，请先添加其他管理员");
  }

  async addExecutor(input: PersonnelInput, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "IT_HANDLER", operator);
  }

  async removeExecutor(id: string, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    await this.prisma.userRoleAssignment.deleteMany({ where: { userId: id, role: "IT_HANDLER" } });
    return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
  }

  async searchDingTalkUsers(keyword: string | undefined, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    try {
      return await this.dingtalkClient.listUsers(keyword);
    } catch (error) {
      console.error("钉钉人员列表获取失败：", error);
      throw new AppError(502, "DINGTALK_USERS_FAILED", "钉钉人员列表获取失败，请手动输入 userId");
    }
  }

  async syncDingTalkDirectory(operator: UserWithRoles) {
    return new DirectorySyncService(this.prisma, this.dingtalkClient).run({ trigger: "MANUAL", operator });
  }

  private async upsertPersonnel(input: PersonnelInput, role: UserRole, operator: UserWithRoles) {
    const userId = input.dingtalkUserId?.trim();
    if (!userId) throw new AppError(400, "DINGTALK_USER_ID_REQUIRED", "请填写钉钉 userId");
    let user: UserWithRoles | null = await this.prisma.user.findUnique({ where: { dingtalkUserId: userId }, include: userInclude });
    if (!user) {
      const person = await this.resolvePersonnel(input);
      user = (await new PersonnelIdentityService(this.prisma).upsertDirectoryPerson(person, { source: "SYNC" })).user;
    }
    const resolvedId = user.id;
    return this.prisma.$transaction(async (tx) => {
      await this.requireCurrentAdmin(tx, operator);
      const current = await tx.user.findUniqueOrThrow({ where: { id: resolvedId }, include: userInclude });
      if (current.status !== "ACTIVE" || current.manuallyDisabled || current.employmentStatus === "DEPARTED" || current.mergedIntoId) {
        throw new AppError(409, "USER_DISABLED", "不能给离职或禁用人员授予角色，请先核验人员状态");
      }
      for (const assignedRole of ["EMPLOYEE", role] as UserRole[]) {
        await tx.userRoleAssignment.upsert({ where: { userId_role: { userId: resolvedId, role: assignedRole } }, create: { userId: resolvedId, role: assignedRole }, update: {} });
      }
      return tx.user.findUniqueOrThrow({ where: { id: resolvedId }, include: userInclude });
    }, { isolationLevel: "Serializable" });
  }

  private async resolvePersonnel(input: PersonnelInput): Promise<DingTalkSelectableUser> {
    const userId = input.dingtalkUserId?.trim();
    if (!userId) throw new AppError(400, "DINGTALK_USER_ID_REQUIRED", "请填写钉钉 userId");

    try {
      const detail = await this.dingtalkClient.getUserDetail(userId);
      return this.dingtalkClient.toSelectableUser(detail);
    } catch (error) {
      console.error("钉钉用户详情获取失败：", error);
      throw new AppError(502, "DINGTALK_USER_DETAIL_FAILED", "钉钉用户信息获取失败，请检查 userId 或使用钉钉选择人员");
    }
  }
}
