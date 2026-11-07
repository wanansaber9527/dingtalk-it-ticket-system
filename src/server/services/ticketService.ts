// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type {
  Prisma,
  PrismaClient,
  NotificationType,
  SatisfactionLevel,
  Ticket,
  TicketActionType,
  TicketPriority,
  TicketStatus,
  User
} from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import {
  hasAnyRole,
  requireActiveUser,
  requireCanViewTicket,
  requireCanCommentTicket,
  ticketPermissions,
  isTicketApplicant,
  requireRole,
  requireTicketOperator
} from "@/src/server/permissions";
import { applicantScope, handlerScope, ccScope } from "@/src/server/personnelAccess";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { NotificationService } from "./notificationService";
import { validateOwnedAttachments } from "@/src/server/uploads";
import { businessDate, retryNumberConflict, type Pagination, type PageResult } from "./serviceHelpers";

export type AttachmentInput = {
  name: string;
  url: string;
  size?: number;
  type?: string;
};

export type CreateTicketInput = {
  title: string;
  categoryId: string;
  priority: TicketPriority;
  description: string;
  attachments?: AttachmentInput[];
  expectedResolveTime?: string | null;
};

export type TicketListFilters = {
  status?: TicketStatus;
  statusGroup?: "todo" | "returned";
  categoryId?: string;
  applicantDepartment?: string;
  handlerUserId?: string;
  overdue?: boolean;
  keyword?: string;
  includeStats?: boolean;
  needsReassignment?: boolean;
};

type TicketListStats = { todo: number; returned: number; overdue: number };
type TicketPageResult = PageResult<Ticket> & { stats?: TicketListStats };

const terminalStatuses: TicketStatus[] = ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"];
const scheduleAdjustableStatuses: TicketStatus[] = ["PENDING", "ASSIGNED", "PROCESSING"];
const returnableStatuses: TicketStatus[] = ["PENDING", "ASSIGNED", "PROCESSING"];
const slaRunningStatuses: TicketStatus[] = ["PENDING", "ASSIGNED", "PROCESSING"];

function addMinutes(date: Date, minutes?: number | null) {
  if (!minutes) return null;
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function attachmentText(attachments?: AttachmentInput[]) {
  return attachments?.length ? JSON.stringify(attachments) : null;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class TicketService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly notificationService = new NotificationService(prisma)
  ) {}

  async createTicket(input: CreateTicketInput, applicant: UserWithRoles, ai?: { conversationId: string; draftId: string; draftVersion: number; snapshot: string; conversationVersion?: Date }) {
    requireActiveUser(applicant);
    if (ai) {
      const prior = await this.prisma.ticket.findUnique({ where: { aiConversationId: ai.conversationId }, include: { logs: true } });
      if (prior) {
        if (!isTicketApplicant(applicant, prior)) throw new AppError(403, "FORBIDDEN", "无权提交该会话");
        return { ticket: prior, duplicateWarning: false };
      }
    }
    // 中文注释：创建工单时只校验必要字段，外部同步和通知失败不能阻断主流程。
    if (!applicant.dingtalkUserId) {
      throw new AppError(401, "DINGTALK_USER_REQUIRED", "未获取到钉钉用户信息，禁止提交工单。");
    }
    if (!input.title?.trim()) throw new AppError(400, "TITLE_REQUIRED", "请填写问题标题");
    if (!input.description?.trim()) throw new AppError(400, "DESCRIPTION_REQUIRED", "请填写问题描述");
    input = { ...input, attachments: await validateOwnedAttachments(input.attachments, applicant) };

    const category = await this.prisma.ticketCategory.findFirst({
      where: { id: input.categoryId, enabled: true }
    });
    if (!category) throw new AppError(400, "CATEGORY_NOT_FOUND", "请选择有效的问题分类");

    requireActiveUser(applicant);
    const createdAt = new Date();
    const defaultHandler = category.defaultHandlerUserId
      ? await this.prisma.user.findUnique({ where: { dingtalkUserId: category.defaultHandlerUserId }, include: { roleAssignments: true } })
      : null;
    let handler = defaultHandler?.status === "ACTIVE" && hasAnyRole(defaultHandler, ["IT_HANDLER"]) ? defaultHandler : null;
    const duplicate = await this.findPossibleDuplicate(applicant, input.title, input.description);
    let reused = false;
    const ticket = await retryNumberConflict(async () => {
      const ticketNo = await this.generateTicketNo(createdAt);
      return this.prisma.$transaction(async (tx) => {
        await this.requireCurrentActor(tx, applicant);
        // 默认处理人可能在外部查询后离职；在写入工单的事务内锁定其当前资格。
        if (handler && !await this.claimCurrentHandler(tx, handler)) handler = null;
        if (ai) {
          const conversation = await tx.aiConversation.findFirst({ where: { id: ai.conversationId, userId: applicant.dingtalkUserId } });
          if (!conversation) throw new AppError(404, "AI_CONVERSATION_NOT_FOUND", "会话不存在");
          const conversationClaim = await tx.aiConversation.updateMany({ where: { id: ai.conversationId, userId: applicant.dingtalkUserId, updatedAt: ai.conversationVersion || conversation.updatedAt, OR: [{ busyUntil: null }, { busyUntil: { lt: new Date() } }] }, data: { updatedAt: new Date() } });
          if (!conversationClaim.count) throw new AppError(409, "AI_BUSY", "会话已更新，请等待回答完成并重新确认工单卡片");
          const claim = await tx.aiTicketDraft.updateMany({ where: { id: ai.draftId, conversationId: ai.conversationId, version: ai.draftVersion, ticketId: null }, data: { version: { increment: 1 } } });
          if (!claim.count) throw new AppError(409, "AI_DRAFT_CHANGED", "工单卡片已更新，请刷新后提交");
        }
        const ccRecipients = await tx.categoryCcRecipient.findMany({
          where: { categoryId: category.id, user: { status: "ACTIVE" } },
          include: { user: { select: { id: true, dingtalkUserId: true, name: true } } }
        });
        const created = await tx.ticket.create({
          data: {
            ticketNo,
            title: input.title.trim(),
            categoryId: category.id,
            categoryName: category.name,
            ccRecipients: { create: ccRecipients.filter((person) => person.user).map((person) => ({ userId: person.user!.dingtalkUserId, personId: person.user!.id, userName: person.user!.name })) },
            priority: input.priority || "NORMAL",
            status: "PENDING",
            applicantUserId: applicant.dingtalkUserId,
            applicantId: applicant.id,
            applicantName: applicant.name,
            applicantDepartment: applicant.departmentName,
            applicantPosition: applicant.position,
            handlerUserId: handler?.dingtalkUserId || null,
            handlerId: handler?.id || null,
            handlerName: handler?.name || null,
            description: input.description.trim(),
            ...(ai ? { aiConversationId: ai.conversationId, aiContextSnapshot: ai.snapshot } : {}),
            attachments: attachmentText(input.attachments),
            expectedResolveTime: parseDate(input.expectedResolveTime),
            slaFirstResponseDeadline: addMinutes(createdAt, category.firstResponseMinutes),
            slaResolveDeadline: addMinutes(createdAt, category.resolveMinutes),
            createdAt
          }
        });
        await this.writeLog(created, applicant, "CREATE", null, "PENDING", "员工提交工单", input.attachments, tx);
        if (ai) {
          await tx.aiTicketDraft.update({ where: { id: ai.draftId }, data: { ticketId: created.id } });
          await tx.aiConversation.update({ where: { id: ai.conversationId }, data: { status: "CONVERTED" } });
        }
        return tx.ticket.findUniqueOrThrow({ where: { id: created.id }, include: { logs: { orderBy: { createdAt: "asc" } } } });
      });
    }, "ticketNo").catch(async (error: unknown) => {
      if (ai) {
        const existing = await this.prisma.ticket.findUnique({ where: { aiConversationId: ai.conversationId }, include: { logs: true } });
        if (existing && isTicketApplicant(applicant, existing)) { reused = true; return existing; }
      }
      throw error;
    });
    if (reused) return { ticket, duplicateWarning: false };

    const targets: Parameters<NotificationService["sendTicketEvent"]>[1] = [{
      target: applicant, notificationType: "TICKET_CREATED",
      content: this.ticketNotice(ticket, `你的工单已提交，工单编号：${ticket.ticketNo}。`)
    }];
    const pendingContent = this.ticketNotice(ticket, `有新的工单待处理：${ticket.ticketNo}。`);
    targets.push(...(handler ? [{ target: handler, notificationType: "NEW_TICKET_PENDING" as const, content: pendingContent }]
      : await this.adminTargets(pendingContent, "NEW_TICKET_PENDING")));
    await this.notifyEvent(ticket, targets, "新工单已提交。", "TICKET_CREATED");

    return { ticket, duplicateWarning: Boolean(duplicate) };
  }

  async listMyTickets(user: UserWithRoles, pagination?: Pagination, scope: "mine" | "cc" = "mine") {
    requireActiveUser(user);
    return this.listTickets(scope === "cc" ? { ccRecipients: { some: ccScope(user) } } : applicantScope(user), pagination, 100);
  }

  async listAdminTickets(filters: TicketListFilters, user: UserWithRoles, pagination?: Pagination) {
    requireRole(user, ["SUPER_ADMIN", "IT_HANDLER"]);
    if (filters.statusGroup && !["todo", "returned"].includes(filters.statusGroup)) {
      throw new AppError(400, "INVALID_STATUS_GROUP", "无效的工单状态组");
    }
    await this.refreshOverdueFlags();
    const selectedHandler = filters.handlerUserId && hasAnyRole(user, ["SUPER_ADMIN"])
      ? await this.prisma.user.findUnique({ where: { dingtalkUserId: filters.handlerUserId } }) : null;
    // Counts share the permission/search scope, independently of the selected status/overdue chips.
    const scope: Prisma.TicketWhereInput = {
      ...(!hasAnyRole(user, ["SUPER_ADMIN"]) ? { AND: [handlerScope(user)] } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.applicantDepartment ? { applicantDepartment: { contains: filters.applicantDepartment } } : {}),
      ...(filters.handlerUserId && hasAnyRole(user, ["SUPER_ADMIN"]) ? selectedHandler ? { AND: [handlerScope(selectedHandler)] } : { handlerUserId: filters.handlerUserId } : {}),
      ...(filters.keyword ? { OR: [
        { ticketNo: { contains: filters.keyword } },
        { title: { contains: filters.keyword } },
        { description: { contains: filters.keyword } }
      ] } : {})
    };
    const conditions: Prisma.TicketWhereInput[] = [scope];
    if (filters.needsReassignment) {
      requireRole(user, ["SUPER_ADMIN"]);
      conditions.push({ status: { in: ["PENDING", "ASSIGNED", "PROCESSING", "RETURNED"] }, handlerUserId: { not: null }, OR: [
        { handler: { is: null } },
        { handler: { is: { employmentStatus: "DEPARTED" } } },
        { handler: { is: { status: "DISABLED" } } },
        { handler: { is: { mergedIntoId: { not: null } } } },
        { handler: { is: { roleAssignments: { none: { role: { in: ["IT_HANDLER", "SUPER_ADMIN"] } } } } } }
      ] });
    }
    if (filters.status) conditions.push({ status: filters.status });
    if (filters.statusGroup) conditions.push({ status: { in: filters.statusGroup === "todo" ? scheduleAdjustableStatuses : ["RETURNED"] } });
    if (filters.overdue) conditions.push({ OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }] });
    return this.listTickets({ AND: conditions }, pagination, 200, filters.includeStats ? scope : undefined);
  }

  private async listTickets(where: Prisma.TicketWhereInput, pagination: Pagination | undefined, legacyLimit: number, statsScope?: Prisma.TicketWhereInput): Promise<Ticket[] | TicketPageResult> {
    const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
    if (!pagination) return this.prisma.ticket.findMany({ where, orderBy, take: legacyLimit });
    const { page, pageSize } = pagination;
    if (statsScope) {
      const [items, total, todo, returned, overdue] = await this.prisma.$transaction([
        this.prisma.ticket.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
        this.prisma.ticket.count({ where }),
        this.prisma.ticket.count({ where: { AND: [statsScope, { status: { in: scheduleAdjustableStatuses } }] } }),
        this.prisma.ticket.count({ where: { AND: [statsScope, { status: "RETURNED" }] } }),
        this.prisma.ticket.count({ where: { AND: [statsScope, { OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }] }] } })
      ], { isolationLevel: "RepeatableRead" });
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize), stats: { todo, returned, overdue } };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ticket.count({ where })
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getTicketForUser(id: string, user: UserWithRoles) {
    const ticket = await this.getTicketById(id);
    requireCanViewTicket(user, ticket);
    const applicant = await this.prisma.user.findUnique({
      where: ticket.applicantId ? { id: ticket.applicantId } : { dingtalkUserId: ticket.applicantUserId },
      select: { avatar: true }
    });
    return { ...ticket, permissions: ticketPermissions(user, ticket), applicant: { avatar: applicant?.avatar ?? null } };
  }

  async addComment(id: string, remark: string, operator: UserWithRoles, attachments?: AttachmentInput[]) {
    const ticket = await this.getTicketById(id);
    requireCanCommentTicket(operator, ticket);
    attachments = await validateOwnedAttachments(attachments, operator);
    const updated = await this.commitChange(ticket, operator, {}, "COMMENT", remark, attachments);
    return updated;
  }

  async assign(id: string, handlerUserId: string, operator: UserWithRoles, remark?: string) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const ticket = await this.getTicketById(id);
    this.requireOpenTicket(ticket);
    const handler = await this.validHandler(handlerUserId);

    const updated = await this.commitChange(ticket, operator, {
      handlerUserId: handler.dingtalkUserId, handlerId: handler.id, handlerName: handler.name, status: "ASSIGNED"
    }, "ASSIGN", remark || `分派给${handler.name}`);
    await this.notifyEvent(updated, [
      { target: handler, notificationType: "TICKET_ASSIGNED", content: this.ticketNotice(updated, `你有一条新的工单：${updated.ticketNo}。`) },
      { target: { id: updated.applicantId || undefined, dingtalkUserId: updated.applicantUserId, name: updated.applicantName }, notificationType: "STATUS_UPDATED", content: "你的工单状态已更新为：已分派。" }
    ], `工单已分派给${handler.name}。`, "TICKET_ASSIGNED");
    return updated;
  }

  async transfer(id: string, handlerUserId: string, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    this.requireOpenTicket(ticket);
    const handler = await this.validHandler(handlerUserId);
    const updated = await this.commitChange(ticket, operator, {
      handlerUserId: handler.dingtalkUserId, handlerId: handler.id, handlerName: handler.name, status: "ASSIGNED"
    }, "TRANSFER", remark || `转交给${handler.name}`);
    await this.notifyEvent(updated, [{ target: handler, notificationType: "TICKET_ASSIGNED", content: this.ticketNotice(updated, `你有一条新的工单：${updated.ticketNo}。`) }], `工单已转交给${handler.name}。`, "TICKET_ASSIGNED");
    return updated;
  }

  async updateStatus(id: string, status: TicketStatus, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    this.validateTransition(ticket.status, status);
    if (status === "COMPLETED") return this.resolve(id, operator, remark || ticket.resultSummary || "");
    if (status === ticket.status) return ticket;

    const now = new Date();
    // 中文注释：首次进入处理中时记录首响时间，用于后续 SLA 首响统计。
    const data: Prisma.TicketUncheckedUpdateManyInput = {
      status,
      ...(status === "PROCESSING" && !ticket.firstResponseAt ? { firstResponseAt: now } : {}),
      ...(status === "CLOSED" ? { closedAt: now } : {})
    };

    const actionType: TicketActionType = status === "PROCESSING" ? "ACCEPT" : "STATUS_CHANGE";
    const updated = await this.commitChange(ticket, operator, { ...data, ...this.slaFlags(ticket, now) }, actionType, remark || "状态变更");
    await this.notifyApplicant(updated, `你的工单状态已更新为：${this.statusText(status)}。`, `工单状态已更新为：${this.statusText(status)}。`);
    return updated;
  }

  async resolve(id: string, operator: UserWithRoles, resultSummary: string, _legacyKnowledgeFlag?: boolean) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    if (!resultSummary?.trim()) throw new AppError(400, "RESULT_REQUIRED", "请填写处理结果");
    if (terminalStatuses.includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "当前工单已完结，不能重复完成处理");
    }
    const now = new Date();
    const updated = await this.commitChange(ticket, operator, {
      status: "COMPLETED",
      firstResponseAt: ticket.firstResponseAt || now,
      resolvedAt: now,
      resultSummary: resultSummary.trim(),
      ...this.slaFlags(ticket, now)
    }, "RESOLVE", resultSummary);
    await this.notifyApplicant(updated, this.ticketNotice(updated, "你的工单已处理完成，可进行满意度评价。"), "工单已处理完成。", "TICKET_RESOLVED");
    return updated;
  }

  async adjustResolveDeadline(id: string, operator: UserWithRoles, deadlineValue: string, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    if (!scheduleAdjustableStatuses.includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "当前工单状态不支持调整预计处理时间");
    }
    if (!ticket.handlerUserId) {
      throw new AppError(400, "HANDLER_REQUIRED", "工单尚未分派处理人，不能调整预计处理时间");
    }

    const nextDeadline = parseDate(deadlineValue);
    if (!nextDeadline) {
      throw new AppError(400, "DEADLINE_REQUIRED", "请选择有效的预计处理时间");
    }
    const now = new Date();
    if (nextDeadline.getTime() <= now.getTime()) {
      throw new AppError(400, "DEADLINE_MUST_BE_FUTURE", "预计处理时间必须晚于当前时间");
    }

    const previousDeadline = ticket.slaResolveDeadline;
    const note = [
      `调整预计处理时间：${previousDeadline ? this.formatDate(previousDeadline) : "-"} -> ${this.formatDate(nextDeadline)}`,
      remark?.trim() ? `调整原因：${remark.trim()}` : null
    ].filter(Boolean).join("\n");

    const updated = await this.commitChange(ticket, operator, {
      slaResolveDeadline: nextDeadline, isResolveOverdue: false
    }, "STATUS_CHANGE", note);
    await this.notifyApplicant(
      updated,
      this.ticketNotice(
        updated,
        [
          `你的工单预计处理时间已调整：${updated.ticketNo}。`,
          `原预计处理时间：${previousDeadline ? this.formatDate(previousDeadline) : "-"}`,
          `新预计处理时间：${this.formatDate(nextDeadline)}`,
          remark?.trim() ? `调整说明：${remark.trim()}` : null
        ].filter(Boolean).join("\n")
      ),
      [`工单预计处理时间已调整。`, `原预计处理时间：${previousDeadline ? this.formatDate(previousDeadline) : "-"}`,
        `新预计处理时间：${this.formatDate(nextDeadline)}`, remark?.trim() ? `调整说明：${remark.trim()}` : null].filter(Boolean).join("\n")
    );

    return updated;
  }

  async returnToApplicant(id: string, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    if (!returnableStatuses.includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "当前工单状态不支持退回发起人");
    }
    const reason = remark?.trim();
    if (!reason) {
      throw new AppError(400, "RETURN_REASON_REQUIRED", "请填写退回原因");
    }

    const now = new Date();
    const updated = await this.commitChange(ticket, operator, {
      status: "RETURNED", firstResponseAt: ticket.firstResponseAt || now,
      isFirstResponseOverdue: false, isResolveOverdue: false
    }, "RETURN_TO_APPLICANT", reason);
    await this.notifyApplicant(
      updated,
      this.ticketNotice(updated, [`你的工单已退回，请补充说明：${updated.ticketNo}。`, `退回原因：${reason}`].join("\n")),
      `工单已退回，等待发起人补充。\n退回原因：${reason}`
    );
    return updated;
  }

  async supplementReturnedTicket(id: string, applicant: UserWithRoles, remark?: string, attachments?: AttachmentInput[]) {
    const ticket = await this.getTicketById(id);
    if (!isTicketApplicant(applicant, ticket)) {
      throw new AppError(403, "FORBIDDEN", "只能补充自己提交的工单");
    }
    if (ticket.status !== "RETURNED") {
      throw new AppError(400, "INVALID_STATUS", "当前工单不处于待发起人补充状态");
    }
    const content = remark?.trim();
    if (!content) {
      throw new AppError(400, "SUPPLEMENT_REQUIRED", "请填写补充说明");
    }

    attachments = await validateOwnedAttachments(attachments, applicant);
    const nextStatus: TicketStatus = ticket.handlerUserId ? "PROCESSING" : "PENDING";
    requireActiveUser(applicant);
    const updated = await this.commitChange(ticket, applicant, {
      status: nextStatus, isFirstResponseOverdue: false, isResolveOverdue: false
    }, "APPLICANT_SUPPLEMENT", content, attachments);

    if (updated.handlerUserId && updated.handlerName) {
      await this.notifyEvent(updated, [{
        target: { id: updated.handlerId || undefined, dingtalkUserId: updated.handlerUserId, name: updated.handlerName },
        notificationType: "STATUS_UPDATED",
        content: this.ticketNotice(updated, [`申请人已补充工单信息，请继续处理：${updated.ticketNo}。`, `补充说明：${content}`].join("\n"))
      }], `发起人已补充工单信息。\n补充说明：${content}`);
    }

    return updated;
  }

  async close(id: string, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    if (ticket.status === "CLOSED") return ticket;
    const now = new Date();
    const updated = await this.commitChange(ticket, operator, {
      status: "CLOSED", closedAt: now, ...this.slaFlags(ticket, now)
    }, "CLOSE", remark || "关闭工单");
    await this.notifyApplicant(updated, `你的工单状态已更新为：已关闭。`, "工单已关闭。");
    return updated;
  }

  async silentDelete(id: string, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const ticket = await this.getTicketById(id);
    return this.prisma.$transaction(async (tx) => {
      await this.requireCurrentActor(tx, operator);
      const current = await tx.user.findUnique({ where: { id: operator.id }, include: { roleAssignments: true } });
      if (!current) throw new AppError(401, "SESSION_REVOKED", "人员状态已变更，请重新登录");
      requireRole(current, ["SUPER_ADMIN"]);
      const deleted = await tx.ticket.deleteMany({ where: { id: ticket.id, updatedAt: ticket.updatedAt } });
      if (deleted.count !== 1) throw new AppError(409, "TICKET_CHANGED", "工单已被其他操作更新，请刷新后重试");
      return { id: ticket.id, ticketNo: ticket.ticketNo, deleted: true };
    }, { isolationLevel: "Serializable" });
  }

  async confirm(id: string, applicant: UserWithRoles, remark?: string) {
    await this.getTicketById(id);
    void applicant;
    void remark;
    throw new AppError(410, "CONFIRM_DISABLED", "已取消申请人确认环节，处理人完单后工单即为已完成");
  }

  async reopen(id: string, applicant: UserWithRoles, remark: string) {
    await this.getTicketById(id);
    void applicant;
    void remark;
    throw new AppError(410, "REOPEN_DISABLED", "已取消待申请人确认环节，工单完成后仅支持满意度评价");
  }

  async satisfaction(id: string, applicant: UserWithRoles, level: SatisfactionLevel, comment?: string) {
    const ticket = await this.getTicketById(id);
    if (!isTicketApplicant(applicant, ticket)) {
      throw new AppError(403, "FORBIDDEN", "只能评价自己提交的工单");
    }
    if (!["COMPLETED", "CLOSED"].includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "工单完成后才能评价满意度");
    }
    if (["NORMAL", "UNSATISFIED"].includes(level) && !comment?.trim()) {
      throw new AppError(400, "COMMENT_REQUIRED", "一般或不满意时需要填写原因");
    }
    requireActiveUser(applicant);
    const updated = await this.commitChange(ticket, applicant, {
      satisfactionLevel: level, satisfactionComment: comment?.trim() || null
    }, "SATISFACTION", comment || level);

    if (level === "UNSATISFIED") {
      await this.notifyEvent(updated,
        await this.adminTargets(`工单 ${updated.ticketNo} 收到不满意评价，请跟进复盘。`, "UNSATISFIED_REVIEW"),
        "工单收到不满意评价。", "UNSATISFIED_REVIEW");
    }
    return updated;
  }

  async refreshOverdueFlags() {
    // 中文注释：SLA 超时标记采用惰性刷新，列表和看板查询前更新，不依赖独立定时任务。
    const now = new Date();
    await this.prisma.ticket.updateMany({
      where: {
        firstResponseAt: null,
        slaFirstResponseDeadline: { lt: now },
        status: { in: slaRunningStatuses },
        isFirstResponseOverdue: false
      },
      data: { isFirstResponseOverdue: true }
    });
    await this.prisma.ticket.updateMany({
      where: {
        resolvedAt: null,
        slaResolveDeadline: { lt: now },
        status: { in: slaRunningStatuses },
        isResolveOverdue: false
      },
      data: { isResolveOverdue: true }
    });
  }

  async sendUpcomingSlaNotifications(now = new Date()) {
    // 中文注释：该方法供定时任务调用，提前通知处理人即将发生的首响/完成 SLA 超时。
    const config = await this.prisma.systemConfig.findUnique({ where: { configKey: "SLA_DUE_SOON_MINUTES" } });
    const windowMinutes = Number(config?.configValue || process.env.SLA_DUE_SOON_MINUTES || 120);
    const safeWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 120;
    const windowEnd = new Date(now.getTime() + safeWindowMinutes * 60_000);

    const firstResponse: Array<{ ticketNo: string; receiver: string; deadline: Date | null; sent: number; skipped: number; failed: number }> = [];
    const resolve: typeof firstResponse = [];
    for (const kind of ["first", "resolve"] as const) {
      let cursor: string | undefined;
      while (true) {
        const tickets: Ticket[] = await this.prisma.ticket.findMany({
          where: {
            ...(kind === "first" ? { firstResponseAt: null, slaFirstResponseDeadline: { gt: now, lte: windowEnd } } : { resolvedAt: null, slaResolveDeadline: { gt: now, lte: windowEnd } }),
            status: { in: slaRunningStatuses }
          },
          orderBy: { id: "asc" }, take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });
        for (const ticket of tickets) {
          const result = await this.notifySlaDueSoon(
            ticket,
            kind === "first" ? "TICKET_FIRST_RESPONSE_DUE_SOON" : "TICKET_RESOLVE_DUE_SOON",
            kind === "first" ? "首响即将超时提醒" : "处理即将超时提醒",
            kind === "first" ? ticket.slaFirstResponseDeadline : ticket.slaResolveDeadline,
            now
          );
          (kind === "first" ? firstResponse : resolve).push(result);
        }
        if (tickets.length < 100) break;
        cursor = tickets[tickets.length - 1].id;
      }
    }

    const summary = (results: typeof firstResponse) => ({
      count: results.reduce((sum, item) => sum + item.sent, 0),
      scanned: results.length,
      skipped: results.reduce((sum, item) => sum + item.skipped, 0),
      failed: results.reduce((sum, item) => sum + item.failed, 0),
      tickets: results.filter((item) => item.sent > 0)
    });
    return { windowMinutes: safeWindowMinutes, firstResponse: summary(firstResponse), resolve: summary(resolve) };
  }

  private requireOpenTicket(ticket: Ticket) {
    if (terminalStatuses.includes(ticket.status)) throw new AppError(400, "INVALID_STATUS", "已完结工单不能分派或转交");
  }

  private async validHandler(id: string) {
    const handler = await this.prisma.user.findUnique({ where: { dingtalkUserId: id }, include: { roleAssignments: true } });
    if (!handler || handler.status !== "ACTIVE" || !hasAnyRole(handler, ["IT_HANDLER"])) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "请选择在职且有效的 IT 处理人");
    }
    return handler;
  }

  private slaFlags(ticket: Ticket, at: Date) {
    // 只在实际业务操作时固化 SLA，保留已确认的历史标记；退回期间沿用暂停规则。
    if (ticket.status === "RETURNED" || terminalStatuses.includes(ticket.status)) return {};
    return {
      isFirstResponseOverdue: ticket.isFirstResponseOverdue || Boolean(ticket.slaFirstResponseDeadline && (ticket.firstResponseAt || at) > ticket.slaFirstResponseDeadline),
      isResolveOverdue: ticket.isResolveOverdue || Boolean(ticket.slaResolveDeadline && (ticket.resolvedAt || at) > ticket.slaResolveDeadline)
    };
  }

  private async claimCurrentHandler(tx: Prisma.TransactionClient, selected: Pick<User, "id" | "dingtalkUserId">) {
    // 锁定与离职事务竞争的同一人员行，不能把事务外的处理人快照当作当前资格。
    const claimed = await tx.user.updateMany({
      where: { id: selected.id, dingtalkUserId: selected.dingtalkUserId, status: "ACTIVE", employmentStatus: "ACTIVE", mergedIntoId: null,
        roleAssignments: { some: { role: "IT_HANDLER" } } },
      data: { sessionVersion: { increment: 0 } }
    });
    return claimed.count === 1;
  }

  private async requireCurrentActor(tx: Prisma.TransactionClient, actor: User) {
    // 与离职事务竞争同一用户行：认证后已归档的在途请求也不能继续写业务数据。
    const claimed = await tx.user.updateMany({ where: { id: actor.id, status: "ACTIVE", employmentStatus: "ACTIVE", mergedIntoId: null, sessionVersion: actor.sessionVersion || 0 }, data: { sessionVersion: { increment: 0 } } });
    if (claimed.count !== 1) throw new AppError(401, "SESSION_REVOKED", "人员状态已变更，请重新登录");
  }

  private async commitChange(
    ticket: Ticket, operator: User, data: Prisma.TicketUncheckedUpdateManyInput,
    action: TicketActionType, remark?: string, attachments?: AttachmentInput[],
    extra?: (tx: Prisma.TransactionClient) => Promise<unknown>
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireCurrentActor(tx, operator);
      if (typeof data.handlerId === "string") {
        if (typeof data.handlerUserId !== "string" || !await this.claimCurrentHandler(tx, { id: data.handlerId, dingtalkUserId: data.handlerUserId })) {
          throw new AppError(400, "HANDLER_NOT_FOUND", "所选处理人的状态已变化，请重新选择在职且有效的 IT 处理人");
        }
      }
      // 单调递增版本，避免同一毫秒的重复请求都通过 updatedAt 比较。
      const updatedAt = new Date(Math.max(Date.now(), ticket.updatedAt.getTime() + 1));
      const changed = await tx.ticket.updateMany({
        where: { id: ticket.id, updatedAt: ticket.updatedAt, status: ticket.status, handlerUserId: ticket.handlerUserId },
        data: { ...data, updatedAt }
      });
      if (changed.count !== 1) throw new AppError(409, "TICKET_CHANGED", "工单已被其他操作更新，请刷新后重试");
      const updated = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      await this.writeLog(ticket, operator, action, ticket.status, updated.status, remark, attachments, tx);
      if (extra) await extra(tx);
      return tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { logs: { orderBy: { createdAt: "asc" } } } });
    });
  }

  private async getTicketById(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { logs: { orderBy: { createdAt: "asc" } }, ccRecipients: true }
    });
    if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "工单不存在");
    return ticket;
  }

  private async writeLog(
    ticket: Ticket,
    operator: User,
    actionType: TicketActionType,
    fromStatus: TicketStatus | null,
    toStatus: TicketStatus | null,
    remark?: string | null,
    attachments?: AttachmentInput[],
    db: Prisma.TransactionClient | PrismaClient = this.prisma
  ) {
    return db.ticketLog.create({
      data: {
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        operatorUserId: operator.dingtalkUserId,
        operatorName: operator.name,
        actionType,
        fromStatus,
        toStatus,
        remark,
        attachments: attachmentText(attachments)
      }
    });
  }

  private async generateTicketNo(date: Date) {
    // 中文注释：工单编号按自然日递增，格式为 ITYYYYMMDD0001。
    const { stamp: day, start, end } = businessDate(date);
    const count = await this.prisma.ticket.count({
      where: { createdAt: { gte: start, lt: end } }
    });
    for (let index = count + 1; index < count + 1000; index += 1) {
      const ticketNo = `IT${day}${String(index).padStart(4, "0")}`;
      const existing = await this.prisma.ticket.findUnique({ where: { ticketNo } });
      if (!existing) return ticketNo;
    }
    throw new AppError(500, "TICKET_NO_GENERATE_FAILED", "工单编号生成失败");
  }

  private async findPossibleDuplicate(applicant: UserWithRoles, title: string, description: string) {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    return this.prisma.ticket.findFirst({
      where: {
        AND: [applicantScope(applicant)],
        createdAt: { gte: since },
        OR: [
          { title: title.trim() },
          {
            AND: [
              { title: { contains: title.trim().slice(0, 12) } },
              { description: { contains: description.trim().slice(0, 20) } }
            ]
          }
        ]
      }
    });
  }

  private validateTransition(from: TicketStatus, to: TicketStatus) {
    // 中文注释：集中维护状态机，防止页面绕过按钮直接调用非法流转接口。
    const allowed: Record<TicketStatus, TicketStatus[]> = {
      PENDING: ["ASSIGNED", "PROCESSING", "REJECTED", "CANCELLED", "CLOSED"],
      ASSIGNED: ["PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "CLOSED"],
      PROCESSING: ["COMPLETED", "ASSIGNED", "REJECTED", "CANCELLED", "CLOSED"],
      RETURNED: ["PROCESSING", "ASSIGNED", "CANCELLED", "CLOSED"],
      COMPLETED: ["CLOSED"],
      CLOSED: [],
      REJECTED: [],
      CANCELLED: []
    };
    if (from === to) return;
    if (!allowed[from].includes(to)) {
      throw new AppError(400, "INVALID_STATUS_TRANSITION", `不允许从${this.statusText(from)}流转到${this.statusText(to)}`);
    }
  }

  private statusText(status: TicketStatus) {
    const text: Record<TicketStatus, string> = {
      PENDING: "待受理",
      ASSIGNED: "已分派",
      PROCESSING: "处理中",
      RETURNED: "待发起人补充",
      COMPLETED: "已完成",
      CLOSED: "已关闭",
      REJECTED: "已驳回",
      CANCELLED: "已取消"
    };
    return text[status];
  }

  private formatDate(date: Date) {
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false
    });
  }

  private descriptionSummary(description: string) {
    const text = description.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}...` : text || "-";
  }

  private remainingText(deadline: Date | null, now: Date) {
    if (!deadline) return "-";
    const minutes = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 60_000));
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
    }
    return `${minutes}分钟`;
  }

  private ticketNotice(ticket: Ticket, headline: string) {
    // 中文注释：钉钉工作通知保持短文本，但集中补齐工单关键上下文，方便移动端快速判断。
    return [
      headline,
      `工单标题：${ticket.title}`,
      `工单类型：${ticket.categoryName || "-"}`,
      `提交人：${ticket.applicantName}`,
      `执行人员：${ticket.handlerName || "待分派"}`,
      `当前状态：${this.statusText(ticket.status)}`,
      `提交时间：${this.formatDate(ticket.createdAt)}`,
      `描述摘要：${this.descriptionSummary(ticket.description)}`
    ].join("\n");
  }

  private async notifySlaDueSoon(
    ticket: Ticket,
    notificationType: "TICKET_FIRST_RESPONSE_DUE_SOON" | "TICKET_RESOLVE_DUE_SOON",
    title: string,
    deadline: Date | null,
    now: Date
  ) {
    const headline = [
      `${title}：${ticket.ticketNo}`,
      `截止时间：${deadline ? this.formatDate(deadline) : "-"}`,
      `剩余时间：${this.remainingText(deadline, now)}`
    ].join("\n");

    const handler = ticket.handlerUserId
      ? await this.prisma.user.findUnique({ where: ticket.handlerId ? { id: ticket.handlerId } : { dingtalkUserId: ticket.handlerUserId }, include: { roleAssignments: true } })
      : null;
    const receivers = handler?.status === "ACTIVE" && hasAnyRole(handler, ["IT_HANDLER"])
      ? [handler]
      : await this.prisma.user.findMany({ where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE" }, take: 20 });
    let sent = 0;
    let skipped = 0;
    const results = await this.notificationService.sendTicketEvent(ticket,
      receivers.map(target => ({ target, notificationType, content: this.ticketNotice(ticket, headline) })),
      [ticket.id, notificationType, deadline?.toISOString()].join(":"), this.ticketNotice(ticket, headline),
      { legacyDeduplicationText: `截止时间：${deadline ? this.formatDate(deadline) : "-"}\n`, ccNotificationType: notificationType });
    let failed = results.length ? 0 : 1;
    for (const result of results) {
      if (result?.delivery === "sent") sent += 1;
      else if (result?.delivery === "skipped") skipped += 1;
      else failed += 1;
    }
    return { ticketNo: ticket.ticketNo, receiver: results.flatMap(result => result ? [result.receiverName] : []).join("、") || "未找到接收人", deadline, sent, skipped, failed };
  }

  private async notifyEvent(ticket: Ticket, targets: Parameters<NotificationService["sendTicketEvent"]>[1], ccContent: string, ccNotificationType: NotificationType = "STATUS_UPDATED") {
    // 每次已提交的业务版本只扩散一次抄送，通知故障不回滚工单。
    try {
      return await this.notificationService.sendTicketEvent(ticket, targets, `ticket:${ticket.id}:${ticket.updatedAt.toISOString()}`,
        this.ticketNotice(ticket, ccContent), { ccNotificationType });
    } catch (error) {
      console.error("Ticket event notification failed", { ticketId: ticket.id, code: error instanceof AppError ? error.code : "UNKNOWN" });
      return [];
    }
  }

  private async notifyApplicant(ticket: Ticket, content: string, ccContent: string, notificationType: NotificationType = "STATUS_UPDATED") {
    await this.notifyEvent(ticket, [{ target: { id: ticket.applicantId || undefined, dingtalkUserId: ticket.applicantUserId, name: ticket.applicantName }, notificationType, content }], ccContent, notificationType);
  }

  private async adminTargets(content: string, notificationType: NotificationType): Promise<Parameters<NotificationService["sendTicketEvent"]>[1]> {
    try {
      const admins = await this.prisma.user.findMany({
        where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE" },
        take: 20
      });
      return admins.map(target => ({ target, notificationType, content }));
    } catch (error) {
      console.error("Ticket admin notification failed", {
        code: error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN"
      });
      return [];
    }
  }
}
