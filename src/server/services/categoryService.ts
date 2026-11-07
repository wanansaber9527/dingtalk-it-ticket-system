// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { z } from "zod";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(20000).nullable().optional(),
  defaultHandlerUserId: z.string().max(191).nullable().optional(),
  ccUserIds: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  firstResponseMinutes: z.number().int().min(0).max(2147483647).nullable().optional(),
  resolveMinutes: z.number().int().min(0).max(2147483647).nullable().optional(),
  needAdminConfirm: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(-2147483648).max(2147483647).optional()
});

function validateCategory(input: CategoryInput) {
  const result = categorySchema.safeParse(input);
  if (!result.success) throw new AppError(400, "INVALID_CATEGORY", "请填写有效的分类名称、人员及非负整数时限，抄送人最多 50 位");
  return result.data;
}

export type CategoryInput = {
  name: string;
  description?: string | null;
  defaultHandlerUserId?: string | null;
  ccUserIds?: string[];
  firstResponseMinutes?: number | null;
  resolveMinutes?: number | null;
  needAdminConfirm?: boolean;
  enabled?: boolean;
  sortOrder?: number;
};

const categoryInclude = {
  ccRecipients: {
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    select: { userId: true, user: { select: { name: true, departmentName: true, status: true } } }
  }
} satisfies Prisma.TicketCategoryInclude;

function categoryDto(category: Prisma.TicketCategoryGetPayload<{ include: typeof categoryInclude }>) {
  const { ccRecipients, ...fields } = category;
  return {
    ...fields,
    ccUserIds: ccRecipients.map((recipient) => recipient.userId),
    ccRecipients: ccRecipients.map(({ userId, user }) => ({ userId, name: user?.name || userId, departmentName: user?.departmentName || null, status: user?.status || "DISABLED" }))
  };
}

async function validateCcRecipients(tx: Prisma.TransactionClient, values: string[], categoryId?: string) {
  const userIds = [...new Set(values)];
  if (!userIds.length) return [];
  const [users, existing] = await Promise.all([
    tx.user.findMany({ where: { dingtalkUserId: { in: userIds } }, select: { id: true, dingtalkUserId: true, status: true } }),
    categoryId ? tx.categoryCcRecipient.findMany({ where: { categoryId }, select: { userId: true } }) : Promise.resolve([])
  ]);
  const existingIds = new Set(existing.map((recipient) => recipient.userId));
  const validIds = new Set(users.filter((user) => user.status === "ACTIVE" || existingIds.has(user.dingtalkUserId)).map((user) => user.dingtalkUserId));
  if (userIds.some((userId) => !validIds.has(userId))) {
    throw new AppError(400, "CC_USER_NOT_FOUND", "新增抄送人必须是系统内已启用的人员");
  }
  return userIds.map((userId) => ({ userId, personId: users.find((user) => user.dingtalkUserId === userId)!.id }));
}

export class CategoryService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async list(enabledOnly = false) {
    const categories = await this.prisma.ticketCategory.findMany({
      where: enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: categoryInclude
    });
    return categories.map(categoryDto);
  }

  listPublic() {
    return this.prisma.ticketCategory.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, description: true }
    });
  }

  async create(input: CategoryInput, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    input = validateCategory(input);
    const handler = input.defaultHandlerUserId
      ? await this.prisma.user.findFirst({ where: { dingtalkUserId: input.defaultHandlerUserId, status: "ACTIVE", roleAssignments: { some: { role: "IT_HANDLER" } } } })
      : null;
    if (input.defaultHandlerUserId && !handler) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "默认处理人必须是已启用的执行人员");
    }
    return this.prisma.$transaction(async (tx) => {
      const ccUserIds = await validateCcRecipients(tx, input.ccUserIds ?? []);
      const category = await tx.ticketCategory.create({
        data: {
          name: input.name,
          description: input.description || null,
          defaultHandlerUserId: handler?.dingtalkUserId || null,
          defaultHandlerName: handler?.name || null,
          firstResponseMinutes: input.firstResponseMinutes ?? null,
          resolveMinutes: input.resolveMinutes ?? null,
          needAdminConfirm: input.needAdminConfirm ?? false,
          enabled: input.enabled ?? true,
          sortOrder: input.sortOrder ?? 0,
          ccRecipients: { create: ccUserIds }
        },
        include: categoryInclude
      });
      return categoryDto(category);
    });
  }

  async update(id: string, input: CategoryInput, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    input = validateCategory(input);
    const handler = input.defaultHandlerUserId
      ? await this.prisma.user.findFirst({ where: { dingtalkUserId: input.defaultHandlerUserId, status: "ACTIVE", roleAssignments: { some: { role: "IT_HANDLER" } } } })
      : null;
    if (input.defaultHandlerUserId && !handler) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "默认处理人必须是已启用的执行人员");
    }
    return this.prisma.$transaction(async (tx) => {
      const ccUserIds = input.ccUserIds === undefined ? undefined : await validateCcRecipients(tx, input.ccUserIds, id);
      const category = await tx.ticketCategory.update({
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
          sortOrder: input.sortOrder ?? 0,
          ...(ccUserIds === undefined ? {} : { ccRecipients: { deleteMany: {}, create: ccUserIds } })
        },
        include: categoryInclude
      });
      return categoryDto(category);
    });
  }

  async delete(id: string, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const category = await this.prisma.ticketCategory.findUnique({ where: { id } });
    if (!category) {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "分类不存在");
    }

    const ticketCount = await this.prisma.ticket.count({ where: { categoryId: id } });
    const knowledgeCount = await this.prisma.knowledgeBase.count({ where: { categoryId: id } });
    const conversationCount = await this.prisma.aiConversation.count({ where: { categoryId: id } });
    if (ticketCount > 0 || knowledgeCount > 0 || conversationCount > 0) {
      // 归档知识与 AI 历史仍保留分类上下文，有引用时只能停用。
      throw new AppError(
        400,
        "CATEGORY_IN_USE",
        "该分类已有工单、AI 对话或归档知识引用，不能直接删除，可先停用该分类"
      );
    }

    return this.prisma.ticketCategory.delete({ where: { id } });
  }
}
