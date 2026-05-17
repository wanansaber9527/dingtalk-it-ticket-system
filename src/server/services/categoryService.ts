// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { PrismaClient, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";

export type CategoryInput = {
  name: string;
  description?: string | null;
  defaultHandlerUserId?: string | null;
  firstResponseMinutes?: number | null;
  resolveMinutes?: number | null;
  needAdminConfirm?: boolean;
  enabled?: boolean;
  sortOrder?: number;
};

export class CategoryService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  list(enabledOnly = false) {
    return this.prisma.ticketCategory.findMany({
      where: enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
  }

  async create(input: CategoryInput, operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    const handler = input.defaultHandlerUserId
      ? await this.prisma.user.findUnique({ where: { dingtalkUserId: input.defaultHandlerUserId } })
      : null;
    if (input.defaultHandlerUserId && !handler) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "默认处理人不存在");
    }
    return this.prisma.ticketCategory.create({
      data: {
        name: input.name,
        description: input.description || null,
        defaultHandlerUserId: handler?.dingtalkUserId || null,
        defaultHandlerName: handler?.name || null,
        firstResponseMinutes: input.firstResponseMinutes ?? null,
        resolveMinutes: input.resolveMinutes ?? null,
        needAdminConfirm: input.needAdminConfirm ?? false,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0
      }
    });
  }

  async update(id: string, input: CategoryInput, operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    const handler = input.defaultHandlerUserId
      ? await this.prisma.user.findUnique({ where: { dingtalkUserId: input.defaultHandlerUserId } })
      : null;
    if (input.defaultHandlerUserId && !handler) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "默认处理人不存在");
    }
    return this.prisma.ticketCategory.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description || null,
        defaultHandlerUserId: handler?.dingtalkUserId || null,
        defaultHandlerName: handler?.name || null,
        firstResponseMinutes: input.firstResponseMinutes ?? null,
        resolveMinutes: input.resolveMinutes ?? null,
        needAdminConfirm: input.needAdminConfirm ?? false,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0
      }
    });
  }

  async delete(id: string, operator: User) {
    requireRole(operator, ["IT_ADMIN", "SUPER_ADMIN"]);
    const category = await this.prisma.ticketCategory.findUnique({ where: { id } });
    if (!category) {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "分类不存在");
    }

    const ticketCount = await this.prisma.ticket.count({ where: { categoryId: id } });
    const knowledgeCount = await this.prisma.knowledgeBase.count({ where: { categoryId: id } });
    if (ticketCount > 0 || knowledgeCount > 0) {
      // 中文注释：被历史数据引用的分类不允许硬删，避免工单和知识库失去分类上下文。
      throw new AppError(
        400,
        "CATEGORY_IN_USE",
        "该分类已有工单或知识库引用，不能直接删除，可先停用该分类"
      );
    }

    return this.prisma.ticketCategory.delete({ where: { id } });
  }
}
