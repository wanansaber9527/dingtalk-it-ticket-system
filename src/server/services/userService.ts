// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { PrismaClient, User, UserRole } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole, requireSuperAdmin } from "@/src/server/permissions";
import { AppError } from "@/src/lib/http";
import { DingTalkClient, type DingTalkSelectableUser } from "@/src/server/dingtalk/DingTalkClient";

export type PersonnelInput = Partial<DingTalkSelectableUser> & {
  dingtalkUserId: string;
};

export class UserService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  list(operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      orderBy: [{ role: "desc" }, { createdAt: "desc" }],
      take: 200
    });
  }

  admins(operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { role: { in: ["IT_ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      orderBy: [{ role: "desc" }, { name: "asc" }]
    });
  }

  executors(operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { role: "IT_HANDLER", status: "ACTIVE" },
      orderBy: { name: "asc" }
    });
  }

  async updateRole(id: string, role: UserRole, operator: User, status?: "ACTIVE" | "DISABLED") {
    requireSuperAdmin(operator);
    return this.prisma.user.update({
      where: { id },
      data: {
        role,
        ...(status ? { status } : {})
      }
    });
  }

  handlers(operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { role: { in: ["IT_HANDLER", "IT_ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      orderBy: { name: "asc" }
    });
  }

  async addAdmin(input: PersonnelInput, operator: User) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "IT_ADMIN");
  }

  async removeAdmin(id: string, operator: User) {
    requireSuperAdmin(operator);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");
    if (target.role === "SUPER_ADMIN") {
      throw new AppError(400, "SUPER_ADMIN_PROTECTED", "超级管理员不能在此删除");
    }
    return this.prisma.user.update({ where: { id }, data: { role: "EMPLOYEE", status: "ACTIVE" } });
  }

  async addExecutor(input: PersonnelInput, operator: User) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "IT_HANDLER");
  }

  async removeExecutor(id: string, operator: User) {
    requireSuperAdmin(operator);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, "USER_NOT_FOUND", "用户不存在");
    if (["IT_ADMIN", "SUPER_ADMIN"].includes(target.role)) {
      throw new AppError(400, "ADMIN_NOT_EXECUTOR", "管理员不需要从执行人员中删除");
    }
    return this.prisma.user.update({ where: { id }, data: { role: "EMPLOYEE", status: "ACTIVE" } });
  }

  async searchDingTalkUsers(keyword: string | undefined, operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    try {
      return await this.dingtalkClient.listUsers(keyword);
    } catch (error) {
      console.error("钉钉人员列表获取失败：", error);
      throw new AppError(502, "DINGTALK_USERS_FAILED", "钉钉人员列表获取失败，请手动输入 userId");
    }
  }

  private async upsertPersonnel(input: PersonnelInput, role: UserRole) {
    const person = await this.resolvePersonnel(input);
    const existing = await this.prisma.user.findUnique({ where: { dingtalkUserId: person.dingtalkUserId } });
    const nextRole = existing?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : role;
    return this.prisma.user.upsert({
      where: { dingtalkUserId: person.dingtalkUserId },
      update: {
        name: person.name,
        mobile: person.mobile || null,
        departmentId: person.departmentId || null,
        departmentName: person.departmentName || null,
        position: person.position || null,
        avatar: person.avatar || null,
        role: nextRole,
        status: "ACTIVE"
      },
      create: {
        dingtalkUserId: person.dingtalkUserId,
        name: person.name,
        mobile: person.mobile || null,
        departmentId: person.departmentId || null,
        departmentName: person.departmentName || null,
        position: person.position || null,
        avatar: person.avatar || null,
        role: nextRole,
        status: "ACTIVE"
      }
    });
  }

  private async resolvePersonnel(input: PersonnelInput): Promise<DingTalkSelectableUser> {
    const userId = input.dingtalkUserId?.trim();
    if (!userId) throw new AppError(400, "DINGTALK_USER_ID_REQUIRED", "请填写钉钉 userId");
    if (input.name?.trim()) {
      return {
        dingtalkUserId: userId,
        name: input.name.trim(),
        departmentId: input.departmentId || "",
        departmentName: input.departmentName || "",
        position: input.position || "",
        mobile: input.mobile || "",
        avatar: input.avatar || ""
      };
    }

    try {
      const detail = await this.dingtalkClient.getUserDetail(userId);
      return this.dingtalkClient.toSelectableUser(detail);
    } catch (error) {
      console.error("钉钉用户详情获取失败：", error);
      throw new AppError(502, "DINGTALK_USER_DETAIL_FAILED", "钉钉用户信息获取失败，请检查 userId 或使用钉钉选择人员");
    }
  }
}
