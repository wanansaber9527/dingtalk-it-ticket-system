// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import { createHash } from "node:crypto";
import { businessDate, isUniqueConflict } from "./serviceHelpers";
import type { Notification, NotificationType, PrismaClient, Ticket, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { applicantScope, handlerScope, ccScope, matchesPerson } from "@/src/server/personnelAccess";
import { AppError } from "@/src/lib/http";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";
import type { DingTalkInteractiveCardPayload, DingTalkWorkNoticeMessage } from "@/src/server/dingtalk/DingTalkClient";

export type NotificationDelivery = Notification & { delivery: "sent" | "skipped" | "failed" };

export type NotifyTarget = Pick<User, "dingtalkUserId" | "name"> & { id?: string };
export type NotificationRecipientKind = "PRIMARY" | "CC";
export type TicketEventTarget = {
  target: NotifyTarget;
  notificationType: NotificationType;
  content: string;
};
type NotificationOptions = {
  deduplicationKey?: string;
  legacyDeduplicationText?: string;
  recipientKind?: NotificationRecipientKind;
  eventKey?: string;
};
type TicketMetric = {
  label: string;
  value: string;
};
type TicketNoticeStats = {
  title: string;
  metrics: TicketMetric[];
  chart: string;
  footnote: string;
};
type TicketNotificationInfo = Pick<
  Ticket,
  | "id"
  | "ticketNo"
  | "title"
  | "categoryName"
  | "status"
  | "applicantUserId"
  | "applicantName"
  | "applicantDepartment"
  | "handlerUserId"
  | "handlerName"
  | "description"
  | "createdAt"
> & { applicantId?: string | null; handlerId?: string | null };

const handlerNotificationTypes: NotificationType[] = [
  "NEW_TICKET_PENDING",
  "TICKET_ASSIGNED",
  "TICKET_FIRST_RESPONSE_DUE_SOON",
  "TICKET_RESOLVE_DUE_SOON",
  "TICKET_OVERDUE"
];

const statusText: Record<Ticket["status"], string> = {
  PENDING: "待受理",
  ASSIGNED: "已分派",
  PROCESSING: "处理中",
  RETURNED: "待发起人补充",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  REJECTED: "已驳回",
  CANCELLED: "已取消"
};

const activeStatuses: Ticket["status"][] = ["PENDING", "ASSIGNED", "PROCESSING", "RETURNED"];
const finishedStatuses: Ticket["status"][] = ["COMPLETED", "CLOSED"];

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  async sendTicketEvent(
    ticket: TicketNotificationInfo,
    targets: TicketEventTarget[],
    eventKey: string,
    ccContent: string,
    options?: { legacyDeduplicationText?: string; ccNotificationType?: NotificationType }
  ): Promise<Array<NotificationDelivery | null>> {
    // 一个业务动作可以通知多个主收件人，抄送只在事件层合并一次。
    const recipients = new Map<string, TicketEventTarget & { recipientKind: NotificationRecipientKind }>();
    let primaryLookupFailed = false;
    for (const entry of targets) {
      try {
        const resolved = await this.resolveRecipient(entry.target, ticket, "PRIMARY");
        const target = this.currentTarget(resolved.user);
        if (!recipients.has(target.id!)) recipients.set(target.id!, { ...entry, target, recipientKind: resolved.recipientKind });
      } catch (error) {
        // 离职/失去权限的目标跳过；单人查询异常不阻断其他主收件人与抄送。
        if (!(error instanceof AppError && error.status === 403)) primaryLookupFailed = true;
      }
    }
    let ccLookupFailed = false;
    try {
      const copied = await this.prisma.ticketCcRecipient.findMany({
        where: { ticketId: ticket.id, user: { status: "ACTIVE" } },
        select: { user: { select: { id: true, dingtalkUserId: true, name: true } } }
      });
      for (const { user } of copied) {
        if (!user) continue;
        if (!recipients.has(user.id)) {
          recipients.set(user.id, {
            target: user,
            notificationType: options?.ccNotificationType ?? targets[0]?.notificationType ?? "STATUS_UPDATED",
            content: `抄送知悉\n${ccContent}`,
            recipientKind: "CC"
          });
        }
      }
    } catch (error) {
      // 抄送名单读取失败不能阻断主收件人通知或已提交的工单动作。
      ccLookupFailed = true;
      console.error("Ticket CC recipient lookup failed", {
        ticketId: ticket.id,
        code: error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN"
      });
    }
    const deliveries: Array<NotificationDelivery | null> = [];
    for (const entry of recipients.values()) {
      deliveries.push(await this.sendTicketNotification(ticket, entry.target, entry.notificationType, entry.content, {
        eventKey,
        recipientKind: entry.recipientKind,
        legacyDeduplicationText: options?.legacyDeduplicationText
      }));
    }
    if (ccLookupFailed || primaryLookupFailed) deliveries.push(null);
    return deliveries;
  }

  async sendTicketNotification(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string,
    options?: NotificationOptions
  ): Promise<NotificationDelivery | null> {
    try {
      const resolved = await this.resolveRecipient(target, ticket, options?.recipientKind ?? "PRIMARY");
      target = this.currentTarget(resolved.user);
      const recipientKind = resolved.recipientKind;
      // 新记录按内部人员 ID 去重；旧事件记录按已回填的人员关联查找并复用。
      const existingEvent = options?.eventKey ? await this.prisma.notification.findFirst({ where: {
        ticketId: ticket?.id ?? null, eventKey: options.eventKey,
        OR: [{ receiverPersonId: target.id }, { receiverPersonId: null, receiverUserId: target.dingtalkUserId }]
      } }) : null;
      const id = existingEvent?.id || (options?.eventKey
        ? `event_${createHash("sha256").update(JSON.stringify([ticket?.id, options.eventKey, `person:${target.id}`])).digest("hex")}`
        : options?.deduplicationKey ? `sla_${createHash("sha256").update(options.deduplicationKey).digest("hex")}` : undefined);
      if (id && options?.legacyDeduplicationText && ticket) {
        const alreadySent = await this.prisma.notification.findFirst({ where: {
          ticketId: ticket.id, notificationType,
          OR: [{ receiverPersonId: target.id }, { receiverPersonId: null, receiverUserId: target.dingtalkUserId }],
          sendStatus: "SUCCESS", content: { contains: options.legacyDeduplicationText }
        } });
        if (alreadySent) return { ...alreadySent, delivery: "skipped" };
      }
      let notification;
      try {
        notification = await this.prisma.notification.create({ data: {
          ...(id ? { id } : {}), ticketId: ticket?.id, ticketNo: ticket?.ticketNo,
          receiverUserId: target.dingtalkUserId, receiverPersonId: target.id, receiverName: target.name,
          notificationType, content, sendStatus: "PENDING", recipientKind, eventKey: options?.eventKey ?? null
        } });
      } catch (error) {
        if (!id || !isUniqueConflict(error)) throw error;
        const existing = await this.prisma.notification.findUniqueOrThrow({ where: { id } });
        const now = new Date();
        const staleBefore = new Date(now.getTime() - 5 * 60_000);
        const retryBefore = new Date(now.getTime() - 60_000);
        const claimed = await this.prisma.notification.updateMany({
          where: { id, OR: [
            { sendStatus: "FAILED", createdAt: { lt: retryBefore } },
            { sendStatus: "PENDING", createdAt: { lt: staleBefore } }
          ] },
          data: { sendStatus: "PENDING", errorMessage: null, content, recipientKind, notificationType, createdAt: now, receiverPersonId: target.id, receiverUserId: target.dingtalkUserId, receiverName: target.name }
        });
        if (claimed.count !== 1) return { ...existing, delivery: "skipped" };
        notification = { ...existing, sendStatus: "PENDING" as const, createdAt: now };
      }
      let failure: string | null = null;
      try {
        await this.sendDingTalkTicketNotification(ticket, target, notificationType, content, recipientKind, notification);
      } catch (error) {
        failure = error instanceof Error ? error.message : "钉钉通知发送失败";
      }
      return await this.finishDelivery(notification, failure);

    } catch (error) {
      // 主业务已经提交，记录通知存储故障，不能返回“完单失败”诱发用户重复提交。
      console.error("Ticket notification was not sent", {
        ticketId: ticket?.id, notificationType,
        code: error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN"
      });
      return null;
    }
  }

  async resend(notificationId: string) {
    const notification = await this.prisma.notification.findUniqueOrThrow({
      where: { id: notificationId }, include: { ticket: true }
    });
    const originalKind = notification.recipientKind === "CC" ? "CC" : "PRIMARY";
    const ticket = notification.ticketId ? await this.prisma.ticket.findUnique({ where: { id: notification.ticketId } }) : null;
    if (notification.ticketId && !ticket) throw new AppError(403, originalKind === "CC" ? "CC_RECIPIENT_UNAVAILABLE" : "RECIPIENT_UNAVAILABLE", "原工单已不存在，不能重发");
    const resolved = await this.resolveRecipient({ id: notification.receiverPersonId || undefined, dingtalkUserId: notification.receiverUserId, name: notification.receiverName }, ticket, originalKind);
    const target = this.currentTarget(resolved.user);
    const recipientKind = resolved.recipientKind;
    const now = new Date(Math.max(Date.now(), notification.createdAt.getTime() + 1));
    const claimed = await this.prisma.notification.updateMany({
      where: { id: notificationId, createdAt: notification.createdAt, OR: [
        { sendStatus: { in: ["SUCCESS", "FAILED"] } },
        { sendStatus: "PENDING", createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } }
      ] },
      data: { sendStatus: "PENDING", createdAt: now, errorMessage: null, receiverPersonId: target.id, receiverUserId: target.dingtalkUserId, receiverName: target.name, recipientKind }
    });
    if (claimed.count !== 1) throw new AppError(409, "NOTIFICATION_SENDING", "该通知正在发送，请稍后刷新查看结果");
    let failure: string | null = null;
    try {
      await this.sendDingTalkTicketNotification(
        ticket, target,
        notification.notificationType, notification.content, recipientKind, { ...notification, createdAt: now }
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : "钉钉通知发送失败";
    }
    return this.finishDelivery({ ...notification, createdAt: now }, failure);
  }

  private currentTarget(user: UserWithRoles): NotifyTarget {
    return { id: user.id, dingtalkUserId: user.dingtalkUserId, name: user.name };
  }

  private async resolveRecipient(target: NotifyTarget, ticket: TicketNotificationInfo | null, recipientKind: NotificationRecipientKind) {
    // 无内部 ID 的旧记录也必须核对当前账号，不向未知、离职或已合并的外部身份直接投递。
    const user = await this.prisma.user.findUnique({ where: target.id ? { id: target.id } : { dingtalkUserId: target.dingtalkUserId }, include: { roleAssignments: true } });
    if (!user || user.status !== "ACTIVE" || user.employmentStatus === "DEPARTED" || user.mergedIntoId) {
      throw new AppError(403, recipientKind === "CC" ? "CC_RECIPIENT_UNAVAILABLE" : "RECIPIENT_UNAVAILABLE", "接收人已离职、停用或不存在，不能发送");
    }
    if (!ticket) return { user, recipientKind };
    const currentTicket = await this.prisma.ticket.findUnique({ where: { id: ticket.id } });
    if (!currentTicket) throw new AppError(403, recipientKind === "CC" ? "CC_RECIPIENT_UNAVAILABLE" : "RECIPIENT_UNAVAILABLE", "原工单已不存在，不能发送");
    const primaryAccess = user.roleAssignments.some(({ role }) => role === "SUPER_ADMIN") ||
      (matchesPerson(user, currentTicket.handlerId, currentTicket.handlerUserId) && user.roleAssignments.some(({ role }) => role === "IT_HANDLER")) ||
      matchesPerson(user, currentTicket.applicantId, currentTicket.applicantUserId);
    if (primaryAccess) return { user, recipientKind };
    const copied = await this.prisma.ticketCcRecipient.findFirst({ where: { ticketId: ticket.id, ...ccScope(user) }, select: { id: true } });
    if (!copied) throw new AppError(403, recipientKind === "CC" ? "CC_PERMISSION_REVOKED" : "RECIPIENT_PERMISSION_REVOKED", "接收人已无权查看该工单，不能发送");
    // 原处理人失去角色后若仍是抄送人，只展示只读卡片，不附带处理/平台统计。
    return { user, recipientKind: "CC" as const };
  }

  private async finishDelivery(notification: Pick<Notification, "id" | "createdAt">, failure: string | null): Promise<NotificationDelivery> {
    // 只有持有本次租约的发送者能写回结果，过期发送者不能覆盖后续重试的状态。
    const updated = await this.prisma.notification.updateMany({
      where: { id: notification.id, sendStatus: "PENDING", createdAt: notification.createdAt },
      data: { sendStatus: failure ? "FAILED" : "SUCCESS", errorMessage: failure }
    });
    const current = await this.prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    return { ...current, delivery: updated.count === 1 ? (failure ? "failed" : "sent") : "skipped" };
  }

  private async sendDingTalkTicketNotification(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string,
    recipientKind: NotificationRecipientKind = "PRIMARY",
    notification?: Pick<Notification, "id" | "createdAt">
  ) {
    const resolved = await this.resolveRecipient(target, ticket, recipientKind);
    target = this.currentTarget(resolved.user);
    recipientKind = resolved.recipientKind;
    if (notification) {
      const claimed = await this.prisma.notification.updateMany({
        where: { id: notification.id, sendStatus: "PENDING", createdAt: notification.createdAt },
        data: { receiverPersonId: target.id, receiverUserId: target.dingtalkUserId, receiverName: target.name, recipientKind }
      });
      if (claimed.count !== 1) throw new AppError(409, "NOTIFICATION_SENDING", "发送任务已由其他进程接管");
    }
    // 中文注释：正式通知回退为稳定的钉钉工作通知 OA 卡片，不再优先尝试互动卡片。
    const message = await this.buildTicketWorkNotice(ticket, target, notificationType, content, recipientKind);
    await this.dingtalkClient.sendWorkNotification(target.dingtalkUserId, message);
  }

  private async buildTicketWorkNotice(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string,
    recipientKind: NotificationRecipientKind = "PRIMARY"
  ): Promise<string | DingTalkWorkNoticeMessage> {
    const action = ticket ? this.ticketAction(ticket, target, notificationType, recipientKind) : null;
    if (!ticket || !action) return content;
    const stats = recipientKind === "CC" ? null : await this.ticketStats(ticket, target);
    return {
      msgtype: "oa",
      oa: {
        message_url: action.url,
        pc_message_url: action.url,
        head: {
          bgcolor: this.oaHeadColor(ticket, notificationType),
          text: "趣然IT工单系统"
        },
        status_bar: {
          status_value: this.oaStatusText(ticket, notificationType),
          status_bg: this.oaStatusColor(ticket, notificationType)
        },
        body: {
          title: recipientKind === "CC" ? `抄送知悉 · ${ticket.title}` : this.ticketHeadline(ticket, notificationType),
          form: this.oaForm(ticket),
          ...(stats ? { rich: this.oaRich(stats) } : {}),
          content: this.oaContent(ticket, content, stats, action.title),
          author: "来自 钉钉 IT 工单"
        }
      }
    };
  }

  private buildInteractiveCard(
    ticket: TicketNotificationInfo,
    notificationType: NotificationType,
    content: string,
    stats: TicketNoticeStats,
    action: { title: string; url: string }
  ): DingTalkInteractiveCardPayload {
    const status = this.statusBadge(ticket, notificationType);
    const title = this.ticketHeadline(ticket, notificationType);
    return {
      cardBizId: `it_${ticket.id}_${Date.now()}`,
      callbackUrl: process.env.DINGTALK_INTERACTIVE_CARD_CALLBACK_URL,
      cardData: {
        config: {
          autoLayout: true,
          enableForward: true
        },
        header: {
          title: {
            type: "text",
            text: `趣然工单 · ${this.noticeScene(notificationType)}`
          },
          logo: process.env.DINGTALK_INTERACTIVE_CARD_LOGO || undefined
        },
        contents: [
          {
            type: "markdown",
            id: "ticket_title",
            text: `## ${title}\n\n${status}`
          },
          {
            type: "markdown",
            id: "ticket_notice",
            text: this.interactiveNotice(content)
          },
          {
            type: "divider",
            id: "divider_base"
          },
          {
            type: "markdown",
            id: "ticket_base",
            text: this.interactiveBaseMarkdown(ticket)
          },
          {
            type: "divider",
            id: "divider_stats"
          },
          {
            type: "markdown",
            id: "ticket_stats",
            text: this.interactiveStatsMarkdown(stats)
          },
          {
            type: "action",
            id: "ticket_action",
            actions: [
              {
                type: "button",
                id: "ticket_action_button",
                label: {
                  type: "text",
                  id: "ticket_action_label",
                  text: action.title
                },
                actionType: "openLink",
                status: "primary",
                url: {
                  all: action.url
                }
              }
            ]
          }
        ].filter((item) => !(item.type === "markdown" && "text" in item && !item.text))
      }
    };
  }

  private ticketAction(ticket: TicketNotificationInfo, target: NotifyTarget, notificationType: NotificationType, recipientKind: NotificationRecipientKind = "PRIMARY") {
    const baseUrl = this.appBaseUrl();
    if (!baseUrl) return null;
    if (recipientKind === "CC") return { title: "查看工单", url: `${baseUrl}/tickets/${ticket.id}` };
    const isHandler = target.id && ticket.handlerId ? target.id === ticket.handlerId : target.dingtalkUserId === ticket.handlerUserId;
    const isApplicant = target.id && ticket.applicantId ? target.id === ticket.applicantId : target.dingtalkUserId === ticket.applicantUserId;
    if (isHandler && handlerNotificationTypes.includes(notificationType)) {
      return { title: "处理工单", url: `${baseUrl}/handler/tickets/${ticket.id}` };
    }
    if (isApplicant) {
      return { title: "查看工单", url: `${baseUrl}/tickets/${ticket.id}` };
    }
    if (isHandler) {
      return { title: "处理工单", url: `${baseUrl}/handler/tickets/${ticket.id}` };
    }
    return { title: "查看工单", url: `${baseUrl}/admin/tickets/${ticket.id}` };
  }

  private ticketMarkdown(
    ticket: TicketNotificationInfo,
    notificationType: NotificationType,
    content: string,
    stats: TicketNoticeStats,
    actionTitle: string
  ) {
    const noticeLines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !["工单标题：", "工单类型：", "提交人：", "执行人员：", "当前状态：", "提交时间：", "描述摘要："].some((key) => line.startsWith(key)));

    const rows = [
      ["标题", ticket.title],
      ["工单编号", ticket.ticketNo],
      ["问题分类", ticket.categoryName || "-"],
      ["申请人", ticket.applicantName],
      ["申请部门", ticket.applicantDepartment || "-"],
      ["执行人员", ticket.handlerName || "待分派"],
      ["当前状态", statusText[ticket.status]],
      ["提交时间", this.formatDate(ticket.createdAt)],
      ["描述摘要", this.descriptionSummary(ticket.description)]
    ];

    return [
      "### 趣然工单系统",
      `> ${this.noticeScene(notificationType)}　　${this.statusBadge(ticket, notificationType)}`,
      "",
      ...noticeLines.map((line) => `**${this.escapeMarkdown(line)}**  `),
      "",
      `#### ${this.escapeMarkdown(this.ticketHeadline(ticket, notificationType))}`,
      "",
      ...rows.map(([key, value]) => `**${key}：** ${this.escapeMarkdown(value)}  `),
      "",
      "`来自 钉钉 IT 工单`",
      "",
      "---",
      "",
      `**${this.escapeMarkdown(stats.title)}**　　查看我的数据 >`,
      "",
      this.metricLine(stats.metrics),
      "",
      `**本月走势：** ${stats.chart}`,
      "",
      `数据统计：${this.formatDate(new Date())}`,
      "",
      `**点击下方按钮${this.escapeMarkdown(actionTitle)}**`,
      "",
      "---",
      "",
      stats.footnote
    ].join("\n");
  }

  private interactiveNotice(content: string) {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !["工单标题：", "工单类型：", "提交人：", "执行人员：", "当前状态：", "提交时间：", "描述摘要："].some((key) => line.startsWith(key)))
      .map((line) => `**${line}**`)
      .join("\n\n");
  }

  private interactiveBaseMarkdown(ticket: TicketNotificationInfo) {
    return [
      `**工单编号：** ${ticket.ticketNo}`,
      `**问题分类：** ${ticket.categoryName || "-"}`,
      `**申请人：** ${ticket.applicantName}`,
      `**所属部门：** ${ticket.applicantDepartment || "-"}`,
      `**执行人员：** ${ticket.handlerName || "待分派"}`,
      `**当前状态：** ${statusText[ticket.status]}`,
      `**提交时间：** ${this.formatDate(ticket.createdAt)}`,
      `**问题摘要：** ${this.descriptionSummary(ticket.description)}`,
      "`来自 钉钉 IT 工单`"
    ].join("\n\n");
  }

  private interactiveStatsMarkdown(stats: TicketNoticeStats) {
    return [
      `### ${stats.title}`,
      "",
      stats.metrics.map((metric) => `**${metric.label}**：${metric.value}`).join("　　"),
      "",
      `**本月走势：** ${stats.chart}`,
      "",
      `数据统计：${this.formatDate(new Date())}`,
      "",
      stats.footnote
    ].join("\n");
  }

  private oaForm(ticket: TicketNotificationInfo) {
    return [
      { key: "工单编号:", value: ticket.ticketNo },
      { key: "问题分类:", value: ticket.categoryName || "-" },
      { key: "申请人:", value: ticket.applicantName },
      { key: "所属部门:", value: ticket.applicantDepartment || "-" },
      { key: "执行人员:", value: ticket.handlerName || "待分派" },
      { key: "提交时间:", value: this.formatDate(ticket.createdAt) }
    ];
  }

  private oaRich(stats: TicketNoticeStats) {
    const primary = stats.metrics[0] || { label: "本月", value: "-" };
    return {
      num: primary.value,
      unit: primary.label
    };
  }

  private oaContent(ticket: TicketNotificationInfo, content: string, stats: TicketNoticeStats | null, actionTitle: string) {
    const notice = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !["工单标题：", "工单类型：", "提交人：", "执行人员：", "当前状态：", "提交时间：", "描述摘要："].some((prefix) => line.startsWith(prefix)))
      .join("\n");
    const statText = stats?.metrics.map((metric) => `${metric.label}${metric.value}`).join("，");
    return [
      notice || `${ticket.ticketNo} 状态更新`,
      `当前状态：${statusText[ticket.status]}`,
      `问题摘要：${this.descriptionSummary(ticket.description)}`,
      ...(stats ? [`${stats.title}：${statText}`, stats.footnote] : []),
      `点击卡片${actionTitle}`
    ].join("\n");
  }

  private oaStatusText(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "已超时";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "即将超时";
    return statusText[ticket.status];
  }

  private oaHeadColor(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "FFFF4D4F";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "FFFF9800";
    if (ticket.status === "COMPLETED" || ticket.status === "CLOSED") return "FF16C784";
    return "FF007CBE";
  }

  private oaStatusColor(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "0xFFFF4D4F";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "0xFFFF9800";
    const colors: Record<Ticket["status"], string> = {
      PENDING: "0xFFFF9800",
      ASSIGNED: "0xFF007CBE",
      PROCESSING: "0xFF16C784",
      RETURNED: "0xFFFF9800",
      COMPLETED: "0xFF16C784",
      CLOSED: "0xFF16C784",
      REJECTED: "0xFFFF4D4F",
      CANCELLED: "0xFF8E9AAA"
    };
    return colors[ticket.status];
  }

  private async ticketStats(ticket: TicketNotificationInfo, target: NotifyTarget): Promise<TicketNoticeStats> {
    const monthStart = this.startOfMonth();
    const dayStart = this.startOfDay();
    const isHandler = target.id && ticket.handlerId ? target.id === ticket.handlerId : target.dingtalkUserId === ticket.handlerUserId;
    const isApplicant = target.id && ticket.applicantId ? target.id === ticket.applicantId : target.dingtalkUserId === ticket.applicantUserId;

    if (isHandler) {
      const [completedThisMonth, activeCount, overdueCount, onTimeCompleted, todayCompleted] = await this.prisma.$transaction([
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [handlerScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { handlerUserId: target.dingtalkUserId }), status: { in: finishedStatuses }, resolvedAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [handlerScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { handlerUserId: target.dingtalkUserId }), status: { in: activeStatuses } }
        }),
        this.prisma.ticket.count({
          where: {
            ...(target.id ? { AND: [handlerScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { handlerUserId: target.dingtalkUserId }),
            status: { in: activeStatuses },
            OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }]
          }
        }),
        this.prisma.ticket.count({
          where: {
            ...(target.id ? { AND: [handlerScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { handlerUserId: target.dingtalkUserId }),
            status: { in: finishedStatuses },
            resolvedAt: { gte: monthStart },
            isResolveOverdue: false
          }
        }),
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [handlerScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { handlerUserId: target.dingtalkUserId }), status: { in: finishedStatuses }, resolvedAt: { gte: dayStart } }
        })
      ]);

      const onTimeRate = completedThisMonth > 0 ? `${Math.round((onTimeCompleted / completedThisMonth) * 100)}%` : "-";
      return {
        title: `${target.name}的处理数据`,
        metrics: [
          { label: "本月处理", value: String(completedThisMonth) },
          { label: "待处理", value: String(activeCount) },
          { label: "准时率", value: onTimeRate }
        ],
        chart: this.metricBars(completedThisMonth, activeCount, overdueCount),
        footnote: `⚡ 今日已完成 ${todayCompleted} 个工单`
      };
    }

    if (isApplicant) {
      const [submittedThisMonth, activeCount, completedThisMonth, todaySubmitted] = await this.prisma.$transaction([
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [applicantScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { applicantUserId: target.dingtalkUserId }), createdAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [applicantScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { applicantUserId: target.dingtalkUserId }), status: { in: activeStatuses } }
        }),
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [applicantScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { applicantUserId: target.dingtalkUserId }), status: { in: finishedStatuses }, resolvedAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { ...(target.id ? { AND: [applicantScope({ id: target.id, dingtalkUserId: target.dingtalkUserId })] } : { applicantUserId: target.dingtalkUserId }), createdAt: { gte: dayStart } }
        })
      ]);

      return {
        title: `${target.name}的工单数据`,
        metrics: [
          { label: "本月提交", value: String(submittedThisMonth) },
          { label: "进行中", value: String(activeCount) },
          { label: "已完成", value: String(completedThisMonth) }
        ],
        chart: this.metricBars(submittedThisMonth, activeCount, completedThisMonth),
        footnote: `⚡ 今日已提交 ${todaySubmitted} 个工单`
      };
    }

    const [todayNew, activeCount, overdueCount] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.ticket.count({ where: { status: { in: activeStatuses } } }),
      this.prisma.ticket.count({
        where: { status: { in: activeStatuses }, OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }] }
      })
    ]);

    return {
      title: "平台工单数据",
      metrics: [
        { label: "今日新增", value: String(todayNew) },
        { label: "待处理", value: String(activeCount) },
        { label: "已超时", value: String(overdueCount) }
      ],
      chart: this.metricBars(todayNew, activeCount, overdueCount),
      footnote: `⚡ 当前共有 ${activeCount} 个待处理工单`
    };
  }

  private noticeScene(notificationType: NotificationType) {
    const sceneText: Record<NotificationType, string> = {
      TICKET_CREATED: "IT 工单 / 提交成功",
      NEW_TICKET_PENDING: "IT 工单 / 处理提醒",
      TICKET_ASSIGNED: "IT 工单 / 分派通知",
      STATUS_UPDATED: "IT 工单 / 状态更新",
      TICKET_RESOLVED: "IT 工单 / 完结通知",
      TICKET_FIRST_RESPONSE_DUE_SOON: "IT 工单 / 首响即将超时",
      TICKET_RESOLVE_DUE_SOON: "IT 工单 / 处理即将超时",
      TICKET_OVERDUE: "IT 工单 / 超时提醒",
      UNSATISFIED_REVIEW: "IT 工单 / 评价提醒"
    };
    return sceneText[notificationType];
  }

  private statusBadge(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "🔴 已超时";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "🟡 即将超时";
    const badges: Record<Ticket["status"], string> = {
      PENDING: "🟠 待受理",
      ASSIGNED: "🔵 已分派",
      PROCESSING: "🟢 处理中",
      RETURNED: "🟠 待发起人补充",
      COMPLETED: "✅ 已完成",
      CLOSED: "✅ 已关闭",
      REJECTED: "⛔ 已驳回",
      CANCELLED: "⚪ 已取消"
    };
    return badges[ticket.status];
  }

  private ticketHeadline(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_CREATED") return `${ticket.applicantName}提交的${ticket.categoryName}工单`;
    if (notificationType === "TICKET_RESOLVED") return `${ticket.applicantName}的${ticket.categoryName}工单已完成`;
    if (notificationType === "TICKET_OVERDUE") return `${ticket.ticketNo} 已超时，请及时处理`;
    return `${ticket.applicantName}提交的${ticket.categoryName}工单`;
  }

  private metricLine(metrics: TicketMetric[]) {
    return metrics.map((metric) => `\`${metric.label} ${this.escapeMarkdown(metric.value)}\``).join("　");
  }

  private metricBars(...values: number[]) {
    const bars = ["▂", "▄", "▆", "█"];
    const max = Math.max(...values, 1);
    return values.map((value) => bars[Math.min(bars.length - 1, Math.round((value / max) * (bars.length - 1)))]).join(" ");
  }

  private appBaseUrl() {
    const url = process.env.APP_BASE_URL || process.env.DINGTALK_APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    return url?.trim().replace(/\/+$/, "") || "";
  }

  private formatDate(date: Date) {
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false
    });
  }

  private startOfMonth() {
    const { stamp } = businessDate();
    return new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-01T00:00:00+08:00`);
  }

  private startOfDay() {
    return businessDate().start;
  }

  private descriptionSummary(description: string) {
    const text = description.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}...` : text || "-";
  }

  private escapeMarkdown(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }
}
