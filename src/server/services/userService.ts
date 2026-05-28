// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { Prisma, PrismaClient, User, UserRole, UserStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole, requireSuperAdmin } from "@/src/server/permissions";
import { AppError } from "@/src/lib/http";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkClient, type DingTalkSelectableUser } from "@/src/server/dingtalk/DingTalkClient";

export type PersonnelInput = Partial<DingTalkSelectableUser> & {
  dingtalkUserId: string;
};

type UserSummary = {
  dingtalkUserId: string;
  name: string;
  departmentName?: string | null;
};

type SyncFailure = UserSummary & {
  reason: string;
};

const userInclude = { roleAssignments: true } satisfies Prisma.UserInclude;

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function summary(user: Pick<User, "dingtalkUserId" | "name" | "departmentName">): UserSummary {
  return {
    dingtalkUserId: user.dingtalkUserId,
    name: user.name,
    departmentName: user.departmentName
  };
}

export class UserService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  list(operator: UserWithRoles, keyword?: string) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const search = textValue(keyword);
    return this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { dingtalkUserId: { contains: search } },
              { departmentName: { contains: search } },
              { position: { contains: search } },
              { mobile: { contains: search } }
            ]
          }
        : undefined,
      include: userInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 2000
    });
  }

  admins(operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE" },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  executors(operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "IT_HANDLER" } }, status: "ACTIVE" },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  async updateStatus(id: string, operator: UserWithRoles, status?: UserStatus) {
    requireSuperAdmin(operator);
    if (!status) {
      return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    }
    return this.prisma.user.update({ where: { id }, data: { status }, include: userInclude });
  }

  handlers(operator: UserWithRoles) {
    // 中文注释：处理人转交工单时也需要读取可转交的处理人列表。
    requireRole(operator, ["SUPER_ADMIN", "IT_HANDLER"]);
    return this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "IT_HANDLER" } }, status: "ACTIVE" },
      include: userInclude,
      orderBy: { name: "asc" }
    });
  }

  async addAdmin(input: PersonnelInput, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "SUPER_ADMIN");
  }

  async removeAdmin(id: string, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    await this.prisma.userRoleAssignment.deleteMany({ where: { userId: id, role: "SUPER_ADMIN" } });
    return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude });
  }

  async addExecutor(input: PersonnelInput, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    return this.upsertPersonnel(input, "IT_HANDLER");
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
    requireRole(operator, ["SUPER_ADMIN"]);
    const people = await this.searchDingTalkUsers(undefined, operator);
    const peopleIds = new Set(people.map((person) => person.dingtalkUserId));
    const existingUsers = await this.prisma.user.findMany({ include: userInclude });
    const existingByUserId = new Map(existingUsers.map((user) => [user.dingtalkUserId, user]));
    const created: UserSummary[] = [];
    const updated: UserSummary[] = [];
    const failed: SyncFailure[] = [];

    for (const person of people) {
      const existing = existingByUserId.get(person.dingtalkUserId) || null;
      try {
        const user = await this.upsertDirectoryUser(person, existing);
        if (existing) updated.push(summary(user));
        else created.push(summary(user));
      } catch (error) {
        failed.push({
          dingtalkUserId: person.dingtalkUserId,
          name: person.name || person.dingtalkUserId,
          departmentName: person.departmentName,
          reason: error instanceof Error ? error.message : "同步失败"
        });
      }
    }

    const removedCandidates = existingUsers.filter((user) => !peopleIds.has(user.dingtalkUserId) && user.status === "ACTIVE");
    const removed: UserSummary[] = [];
    for (const user of removedCandidates) {
      try {
        await this.prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
        removed.push(summary(user));
      } catch (error) {
        failed.push({
          ...summary(user),
          reason: error instanceof Error ? error.message : "停用失败"
        });
      }
    }

    return {
      total: people.length,
      createdCount: created.length,
      updatedCount: updated.length,
      removedCount: removed.length,
      failedCount: failed.length,
      created,
      updated,
      removed,
      failed
    };
  }

  private async upsertPersonnel(input: PersonnelInput, role: UserRole) {
    const person = await this.resolvePersonnel(input);
    const user = await this.prisma.user.upsert({
      where: { dingtalkUserId: person.dingtalkUserId },
      update: {
        name: person.name,
        mobile: person.mobile || null,
        departmentId: person.departmentId || null,
        departmentName: person.departmentName || null,
        position: person.position || null,
        avatar: person.avatar || null,
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
        status: "ACTIVE"
      }
    });
    await this.ensureRole(user.id, "EMPLOYEE");
    await this.ensureRole(user.id, role);
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
  }

  private async upsertDirectoryUser(person: DingTalkSelectableUser, existing: UserWithRoles | null) {
    const user = await this.prisma.user.upsert({
      where: { dingtalkUserId: person.dingtalkUserId },
      update: {
        name: person.name,
        mobile: person.mobile || null,
        departmentId: person.departmentId || null,
        departmentName: person.departmentName || null,
        position: person.position || null,
        avatar: person.avatar || null,
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
        status: existing?.status || "ACTIVE"
      }
    });
    await this.ensureRole(user.id, "EMPLOYEE");
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
  }

  private async ensureRole(userId: string, role: UserRole) {
    await this.prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId, role } },
      update: {},
      create: { userId, role }
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
