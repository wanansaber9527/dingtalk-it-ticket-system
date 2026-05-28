// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { KnowledgeBase, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkAiTableClient } from "@/src/server/dingtalk/DingTalkAiTableClient";

export type KnowledgeBaseInput = {
  title: string;
  categoryId?: string | null;
  problemDescription: string;
  solutionSteps: string;
  applicableDepartments?: string | null;
  sourceTicketId?: string | null;
  enabled?: boolean;
};

function kbNo() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `KB${stamp}${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly aiTableClient = new DingTalkAiTableClient(prisma)
  ) {}

  async search(keyword?: string, categoryId?: string) {
    const where = {
      enabled: true,
      ...(categoryId ? { categoryId } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { problemDescription: { contains: keyword } },
              { solutionSteps: { contains: keyword } }
            ]
          }
        : {})
    };
    return this.prisma.knowledgeBase.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 20
    });
  }

  async list(keyword?: string, categoryId?: string) {
    return this.prisma.knowledgeBase.findMany({
      where: {
        ...(categoryId ? { categoryId } : {}),
        ...(keyword
          ? {
              OR: [
                { title: { contains: keyword } },
                { problemDescription: { contains: keyword } },
                { solutionSteps: { contains: keyword } }
              ]
            }
          : {})
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    });
  }

  async create(input: KnowledgeBaseInput, operator: UserWithRoles) {
    requireRole(operator, ["IT_HANDLER", "SUPER_ADMIN"]);
    const category = input.categoryId
      ? await this.prisma.ticketCategory.findUnique({ where: { id: input.categoryId } })
      : null;
    const sourceTicket = input.sourceTicketId
      ? await this.prisma.ticket.findUnique({ where: { id: input.sourceTicketId } })
      : null;

    const kb = await this.prisma.knowledgeBase.create({
      data: {
        kbNo: kbNo(),
        title: input.title,
        categoryId: category?.id || null,
        categoryName: category?.name || null,
        problemDescription: input.problemDescription,
        solutionSteps: input.solutionSteps,
        applicableDepartments: input.applicableDepartments || null,
        sourceTicketId: sourceTicket?.id || null,
        sourceTicketNo: sourceTicket?.ticketNo || null,
        maintainerUserId: operator.dingtalkUserId,
        maintainerName: operator.name,
        enabled: input.enabled ?? false
      }
    });
    if (kb.enabled) await this.aiTableClient.syncKnowledgeBase(kb);
    return kb;
  }

  async update(id: string, input: KnowledgeBaseInput, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const existing = await this.prisma.knowledgeBase.findUniqueOrThrow({ where: { id } });
    const category = input.categoryId
      ? await this.prisma.ticketCategory.findUnique({ where: { id: input.categoryId } })
      : null;
    const sourceTicket = input.sourceTicketId
      ? await this.prisma.ticket.findUnique({ where: { id: input.sourceTicketId } })
      : null;

    const kb: KnowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        title: input.title,
        categoryId: category?.id || null,
        categoryName: category?.name || null,
        problemDescription: input.problemDescription,
        solutionSteps: input.solutionSteps,
        applicableDepartments: input.applicableDepartments || null,
        sourceTicketId: sourceTicket?.id || existing.sourceTicketId,
        sourceTicketNo: sourceTicket?.ticketNo || existing.sourceTicketNo,
        maintainerUserId: operator.dingtalkUserId,
        maintainerName: operator.name,
        enabled: input.enabled ?? existing.enabled
      }
    });
    if (kb.enabled) await this.aiTableClient.syncKnowledgeBase(kb);
    return kb;
  }
}
