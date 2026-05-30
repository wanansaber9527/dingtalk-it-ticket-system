// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type {
  Prisma,
  PrismaClient,
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
  requireCanViewTicket,
  requireRole,
  requireTicketOperator
} from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkAiTableClient } from "@/src/server/dingtalk/DingTalkAiTableClient";
import { NotificationService } from "./notificationService";

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
  categoryId?: string;
  applicantDepartment?: string;
  handlerUserId?: string;
  overdue?: boolean;
  keyword?: string;
};

const terminalStatuses: TicketStatus[] = ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"];
const scheduleAdjustableStatuses: TicketStatus[] = ["PENDING", "ASSIGNED", "PROCESSING"];

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

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
    private readonly aiTableClient = new DingTalkAiTableClient(prisma),
    private readonly notificationService = new NotificationService(prisma)
  ) {}

  async createTicket(input: CreateTicketInput, applicant: UserWithRoles) {
    // 中文注释：创建工单时只校验必要字段，外部同步和通知失败不能阻断主流程。
    if (!applicant.dingtalkUserId) {
      throw new AppError(401, "DINGTALK_USER_REQUIRED", "未获取到钉钉用户信息，禁止提交工单。");
    }
    if (!input.title?.trim()) throw new AppError(400, "TITLE_REQUIRED", "请填写问题标题");
    if (!input.description?.trim()) throw new AppError(400, "DESCRIPTION_REQUIRED", "请填写问题描述");

    const category = await this.prisma.ticketCategory.findFirst({
      where: { id: input.categoryId, enabled: true }
    });
    if (!category) throw new AppError(400, "CATEGORY_NOT_FOUND", "请选择有效的问题分类");

    const createdAt = new Date();
    const ticketNo = await this.generateTicketNo(createdAt);
    const duplicate = await this.findPossibleDuplicate(applicant.dingtalkUserId, input.title, input.description);

    const ticket = await this.prisma.ticket.create({
      // 中文注释：工单快照保存申请人和处理人姓名，避免后续用户信息变更影响历史记录。
      data: {
        ticketNo,
        title: input.title.trim(),
        categoryId: category.id,
        categoryName: category.name,
        priority: input.priority || "NORMAL",
        status: "PENDING",
        applicantUserId: applicant.dingtalkUserId,
        applicantName: applicant.name,
        applicantDepartment: applicant.departmentName,
        applicantPosition: applicant.position,
        handlerUserId: category.defaultHandlerUserId,
        handlerName: category.defaultHandlerName,
        description: input.description.trim(),
        attachments: attachmentText(input.attachments),
        expectedResolveTime: parseDate(input.expectedResolveTime),
        slaFirstResponseDeadline: addMinutes(createdAt, category.firstResponseMinutes),
        slaResolveDeadline: addMinutes(createdAt, category.resolveMinutes)
      }
    });

    const log = await this.writeLog(ticket, applicant, "CREATE", null, "PENDING", "员工提交工单", input.attachments);
    await this.aiTableClient.syncTicket(ticket);
    await this.aiTableClient.syncTicketLog(log);

    await this.notificationService.sendTicketNotification(
      ticket,
      applicant,
      "TICKET_CREATED",
      this.ticketNotice(ticket, `你的工单已提交，工单编号：${ticket.ticketNo}。`)
    );

    const handler = category.defaultHandlerUserId
      ? await this.prisma.user.findUnique({ where: { dingtalkUserId: category.defaultHandlerUserId } })
      : null;
    if (handler) {
      await this.notificationService.sendTicketNotification(
        ticket,
        handler,
        "NEW_TICKET_PENDING",
        this.ticketNotice(ticket, `有新的工单待处理：${ticket.ticketNo}。`)
      );
    } else {
      await this.notifyAdmins(ticket, `有新的工单待处理：${ticket.ticketNo}。`);
    }

    return { ticket: await this.getTicketById(ticket.id), duplicateWarning: Boolean(duplicate) };
  }

  async listMyTickets(user: UserWithRoles) {
    return this.prisma.ticket.findMany({
      where: { applicantUserId: user.dingtalkUserId },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async listAdminTickets(filters: TicketListFilters, user: UserWithRoles) {
    if (!hasAnyRole(user, ["SUPER_ADMIN"])) {
      requireRole(user, ["IT_HANDLER"]);
    }
    await this.refreshOverdueFlags();

    const where: Prisma.TicketWhereInput = {
      ...(!hasAnyRole(user, ["SUPER_ADMIN"]) ? { handlerUserId: user.dingtalkUserId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.applicantDepartment ? { applicantDepartment: { contains: filters.applicantDepartment } } : {}),
      ...(filters.handlerUserId && hasAnyRole(user, ["SUPER_ADMIN"]) ? { handlerUserId: filters.handlerUserId } : {}),
      ...(filters.overdue ? { OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }] } : {}),
      ...(filters.keyword
        ? {
            OR: [
              { ticketNo: { contains: filters.keyword } },
              { title: { contains: filters.keyword } },
              { description: { contains: filters.keyword } }
            ]
          }
        : {})
    };

    return this.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200
    });
  }

  async getTicketForUser(id: string, user: UserWithRoles) {
    const ticket = await this.getTicketById(id);
    requireCanViewTicket(user, ticket);
    return ticket;
  }

  async addComment(id: string, remark: string, operator: UserWithRoles, attachments?: AttachmentInput[]) {
    const ticket = await this.getTicketById(id);
    requireCanViewTicket(operator, ticket);
    const log = await this.writeLog(ticket, operator, "COMMENT", ticket.status, ticket.status, remark, attachments);
    await this.aiTableClient.syncTicketLog(log);
    return this.getTicketById(id);
  }

  async assign(id: string, handlerUserId: string, operator: UserWithRoles, remark?: string) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const ticket = await this.getTicketById(id);
    const handler = await this.prisma.user.findUnique({ where: { dingtalkUserId: handlerUserId }, include: { roleAssignments: true } });
    if (!handler || !hasAnyRole(handler, ["IT_HANDLER"])) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "请选择有效的IT处理人");
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        handlerUserId: handler.dingtalkUserId,
        handlerName: handler.name,
        status: "ASSIGNED"
      }
    });
    const log = await this.writeLog(ticket, operator, "ASSIGN", ticket.status, "ASSIGNED", remark || `分派给${handler.name}`);
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notificationService.sendTicketNotification(
      updated,
      handler,
      "TICKET_ASSIGNED",
      this.ticketNotice(updated, `你有一条新的工单：${updated.ticketNo}。`)
    );
    await this.notifyApplicant(updated, `你的工单状态已更新为：已分派。`);
    return this.getTicketById(id);
  }

  async transfer(id: string, handlerUserId: string, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    const handler = await this.prisma.user.findUnique({ where: { dingtalkUserId: handlerUserId }, include: { roleAssignments: true } });
    if (!handler || !hasAnyRole(handler, ["IT_HANDLER"])) {
      throw new AppError(400, "HANDLER_NOT_FOUND", "请选择有效的IT处理人");
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        handlerUserId: handler.dingtalkUserId,
        handlerName: handler.name,
        status: "ASSIGNED"
      }
    });
    const log = await this.writeLog(ticket, operator, "TRANSFER", ticket.status, "ASSIGNED", remark || `转交给${handler.name}`);
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notificationService.sendTicketNotification(
      updated,
      handler,
      "TICKET_ASSIGNED",
      this.ticketNotice(updated, `你有一条新的工单：${updated.ticketNo}。`)
    );
    return this.getTicketById(id);
  }

  async updateStatus(id: string, status: TicketStatus, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    this.validateTransition(ticket.status, status);

    const now = new Date();
    // 中文注释：首次进入处理中时记录首响时间，用于后续 SLA 首响统计。
    const data: Prisma.TicketUpdateInput = {
      status,
      ...(status === "PROCESSING" && !ticket.firstResponseAt ? { firstResponseAt: now } : {}),
      ...(status === "COMPLETED" && !ticket.firstResponseAt ? { firstResponseAt: now } : {}),
      ...(status === "COMPLETED" && !ticket.resolvedAt ? { resolvedAt: now } : {}),
      ...(status === "CLOSED" ? { closedAt: now } : {})
    };

    const updated = await this.prisma.ticket.update({ where: { id }, data });
    const actionType: TicketActionType = status === "PROCESSING" ? "ACCEPT" : "STATUS_CHANGE";
    const log = await this.writeLog(ticket, operator, actionType, ticket.status, status, remark || "状态变更");
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notifyApplicant(updated, `你的工单状态已更新为：${this.statusText(status)}。`);
    return this.getTicketById(id);
  }

  async resolve(id: string, operator: UserWithRoles, resultSummary: string, toKnowledgeBase?: boolean) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    if (!resultSummary?.trim()) throw new AppError(400, "RESULT_REQUIRED", "请填写处理结果");
    if (terminalStatuses.includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "当前工单已完结，不能重复完成处理");
    }
    const now = new Date();
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        status: "COMPLETED",
        firstResponseAt: ticket.firstResponseAt || now,
        resolvedAt: now,
        resultSummary: resultSummary.trim()
      }
    });
    const log = await this.writeLog(ticket, operator, "RESOLVE", ticket.status, "COMPLETED", resultSummary);
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notificationService.sendTicketNotification(
      updated,
      { dingtalkUserId: updated.applicantUserId, name: updated.applicantName },
      "TICKET_RESOLVED",
      this.ticketNotice(updated, "你的工单已处理完成，可进行满意度评价。")
    );

    if (toKnowledgeBase) {
      // 中文注释：处理人勾选沉淀知识库时先生成草稿，由管理员后续审核启用。
      await this.prisma.knowledgeBase.create({
        data: {
          kbNo: await this.generateKbNo(),
          title: ticket.title,
          categoryId: ticket.categoryId,
          categoryName: ticket.categoryName,
          problemDescription: ticket.description,
          solutionSteps: resultSummary,
          sourceTicketId: ticket.id,
          sourceTicketNo: ticket.ticketNo,
          maintainerUserId: operator.dingtalkUserId,
          maintainerName: operator.name,
          enabled: false
        }
      });
    }
    return this.getTicketById(id);
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

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        slaResolveDeadline: nextDeadline,
        isResolveOverdue: false
      }
    });
    const log = await this.writeLog(ticket, operator, "STATUS_CHANGE", ticket.status, ticket.status, note);
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notificationService.sendTicketNotification(
      updated,
      { dingtalkUserId: updated.applicantUserId, name: updated.applicantName },
      "STATUS_UPDATED",
      this.ticketNotice(
        updated,
        [
          `你的工单预计处理时间已调整：${updated.ticketNo}。`,
          `原预计处理时间：${previousDeadline ? this.formatDate(previousDeadline) : "-"}`,
          `新预计处理时间：${this.formatDate(nextDeadline)}`,
          remark?.trim() ? `调整说明：${remark.trim()}` : null
        ].filter(Boolean).join("\n")
      )
    );

    return this.getTicketById(id);
  }

  async close(id: string, operator: UserWithRoles, remark?: string) {
    const ticket = await this.getTicketById(id);
    requireTicketOperator(operator, ticket);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date() }
    });
    const log = await this.writeLog(ticket, operator, "CLOSE", ticket.status, "CLOSED", remark || "关闭工单");
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncTicketLog(log);
    await this.notifyApplicant(updated, `你的工单状态已更新为：已关闭。`);
    return this.getTicketById(id);
  }

  async silentDelete(id: string, operator: UserWithRoles) {
    requireRole(operator, ["SUPER_ADMIN"]);
    const ticket = await this.getTicketById(id);
    const deleted = await this.prisma.ticket.delete({ where: { id: ticket.id } });
    return { id: deleted.id, ticketNo: deleted.ticketNo, deleted: true };
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
    if (ticket.applicantUserId !== applicant.dingtalkUserId) {
      throw new AppError(403, "FORBIDDEN", "只能评价自己提交的工单");
    }
    if (!["COMPLETED", "CLOSED"].includes(ticket.status)) {
      throw new AppError(400, "INVALID_STATUS", "工单完成后才能评价满意度");
    }
    if (["NORMAL", "UNSATISFIED"].includes(level) && !comment?.trim()) {
      throw new AppError(400, "COMMENT_REQUIRED", "一般或不满意时需要填写原因");
    }
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        satisfactionLevel: level,
        satisfactionComment: comment?.trim() || null
      }
    });
    const log = await this.writeLog(ticket, applicant, "SATISFACTION", ticket.status, ticket.status, comment || level);
    await this.aiTableClient.syncTicket(updated);
    await this.aiTableClient.syncSatisfaction(updated);
    await this.aiTableClient.syncTicketLog(log);

    if (level === "UNSATISFIED") {
      await this.notifyAdmins(updated, `工单 ${updated.ticketNo} 收到不满意评价，请跟进复盘。`);
    }
    return this.getTicketById(id);
  }

  async refreshOverdueFlags() {
    // 中文注释：SLA 超时标记采用惰性刷新，列表和看板查询前更新，不依赖独立定时任务。
    const now = new Date();
    await this.prisma.ticket.updateMany({
      where: {
        firstResponseAt: null,
        slaFirstResponseDeadline: { lt: now },
        status: { notIn: terminalStatuses },
        isFirstResponseOverdue: false
      },
      data: { isFirstResponseOverdue: true }
    });
    await this.prisma.ticket.updateMany({
      where: {
        resolvedAt: null,
        slaResolveDeadline: { lt: now },
        status: { notIn: terminalStatuses },
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

    const [firstResponseTickets, resolveTickets] = await Promise.all([
      this.prisma.ticket.findMany({
        where: {
          firstResponseAt: null,
          slaFirstResponseDeadline: { gt: now, lte: windowEnd },
          status: { notIn: terminalStatuses },
          notifications: { none: { notificationType: "TICKET_FIRST_RESPONSE_DUE_SOON" } }
        },
        orderBy: { slaFirstResponseDeadline: "asc" },
        take: 100
      }),
      this.prisma.ticket.findMany({
        where: {
          resolvedAt: null,
          slaResolveDeadline: { gt: now, lte: windowEnd },
          status: { notIn: terminalStatuses },
          notifications: { none: { notificationType: "TICKET_RESOLVE_DUE_SOON" } }
        },
        orderBy: { slaResolveDeadline: "asc" },
        take: 100
      })
    ]);

    const firstResponse = [];
    for (const ticket of firstResponseTickets) {
      firstResponse.push(await this.notifySlaDueSoon(ticket, "TICKET_FIRST_RESPONSE_DUE_SOON", "首响即将超时提醒", ticket.slaFirstResponseDeadline, now));
    }

    const resolve = [];
    for (const ticket of resolveTickets) {
      resolve.push(await this.notifySlaDueSoon(ticket, "TICKET_RESOLVE_DUE_SOON", "处理即将超时提醒", ticket.slaResolveDeadline, now));
    }

    return {
      windowMinutes: safeWindowMinutes,
      firstResponse: {
        count: firstResponse.length,
        tickets: firstResponse
      },
      resolve: {
        count: resolve.length,
        tickets: resolve
      }
    };
  }

  private async getTicketById(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { logs: { orderBy: { createdAt: "asc" } } }
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
    attachments?: AttachmentInput[]
  ) {
    return this.prisma.ticketLog.create({
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
    const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
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

  private async generateKbNo() {
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const count = await this.prisma.knowledgeBase.count({
      where: { createdAt: { gte: startOfToday() } }
    });
    return `KB${day}${String(count + 1).padStart(4, "0")}`;
  }

  private async findPossibleDuplicate(applicantUserId: string, title: string, description: string) {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    return this.prisma.ticket.findFirst({
      where: {
        applicantUserId,
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

    if (ticket.handlerUserId && ticket.handlerName) {
      await this.notificationService.sendTicketNotification(
        ticket,
        { dingtalkUserId: ticket.handlerUserId, name: ticket.handlerName },
        notificationType,
        this.ticketNotice(ticket, headline)
      );
      return { ticketNo: ticket.ticketNo, receiver: ticket.handlerName, deadline };
    }

    const admins = await this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE" },
      take: 20
    });
    for (const admin of admins) {
      await this.notificationService.sendTicketNotification(ticket, admin, notificationType, this.ticketNotice(ticket, headline));
    }
    return { ticketNo: ticket.ticketNo, receiver: admins.length ? "超级管理员" : "未找到接收人", deadline };
  }

  private async notifyApplicant(ticket: Ticket, content: string) {
    await this.notificationService.sendTicketNotification(
      ticket,
      { dingtalkUserId: ticket.applicantUserId, name: ticket.applicantName },
      "STATUS_UPDATED",
      content
    );
  }

  private async notifyAdmins(ticket: Ticket, content: string) {
    const admins = await this.prisma.user.findMany({
      where: { roleAssignments: { some: { role: "SUPER_ADMIN" } }, status: "ACTIVE" },
      take: 20
    });
    for (const admin of admins) {
      await this.notificationService.sendTicketNotification(ticket, admin, "NEW_TICKET_PENDING", content);
    }
  }
}
