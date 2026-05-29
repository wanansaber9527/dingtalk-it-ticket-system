// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { NotificationType, PrismaClient, Ticket, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";
import type { DingTalkInteractiveCardPayload, DingTalkWorkNoticeMessage } from "@/src/server/dingtalk/DingTalkClient";

type NotifyTarget = Pick<User, "dingtalkUserId" | "name">;
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
>;

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
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  REJECTED: "已驳回",
  CANCELLED: "已取消"
};

const activeStatuses: Ticket["status"][] = ["PENDING", "ASSIGNED", "PROCESSING"];
const finishedStatuses: Ticket["status"][] = ["COMPLETED", "CLOSED"];

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  async sendTicketNotification(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        ticketId: ticket?.id,
        ticketNo: ticket?.ticketNo,
        receiverUserId: target.dingtalkUserId,
        receiverName: target.name,
        notificationType,
        content,
        sendStatus: "PENDING"
      }
    });

    try {
      await this.sendDingTalkTicketNotification(ticket, target, notificationType, content);
      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { sendStatus: "SUCCESS", errorMessage: null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "钉钉通知发送失败";
      return this.prisma.notification.update({
        where: { id: notification.id },
        data: { sendStatus: "FAILED", errorMessage: message }
      });
    }
  }

  async resend(notificationId: string) {
    const notification = await this.prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
      include: { ticket: true }
    });
    try {
      await this.sendDingTalkTicketNotification(
        notification.ticket,
        { dingtalkUserId: notification.receiverUserId, name: notification.receiverName },
        notification.notificationType,
        notification.content
      );
      return this.prisma.notification.update({
        where: { id: notificationId },
        data: { sendStatus: "SUCCESS", errorMessage: null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "钉钉通知发送失败";
      return this.prisma.notification.update({
        where: { id: notificationId },
        data: { sendStatus: "FAILED", errorMessage: message }
      });
    }
  }

  private async sendDingTalkTicketNotification(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string
  ) {
    const action = ticket ? this.ticketAction(ticket, target, notificationType) : null;
    if (ticket && action && this.dingtalkClient.interactiveCardEnabled()) {
      try {
        const stats = await this.ticketStats(ticket, target);
        await this.dingtalkClient.sendInteractiveCard(
          target.dingtalkUserId,
          this.buildInteractiveCard(ticket, notificationType, content, stats, action)
        );
        return;
      } catch (error) {
        console.error("钉钉互动卡片发送失败，已降级为工作通知", error);
      }
    }

    const message = await this.buildTicketWorkNotice(ticket, target, notificationType, content);
    await this.dingtalkClient.sendWorkNotification(target.dingtalkUserId, message);
  }

  private async buildTicketWorkNotice(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string
  ): Promise<string | DingTalkWorkNoticeMessage> {
    const action = ticket ? this.ticketAction(ticket, target, notificationType) : null;
    if (!ticket || !action) return content;
    const stats = await this.ticketStats(ticket, target);
    return {
      msgtype: "oa",
      oa: {
        message_url: action.url,
        pc_message_url: action.url,
        head: {
          bgcolor: this.oaHeadColor(ticket, notificationType),
          text: "趣然工单"
        },
        status_bar: {
          status_value: this.oaStatusText(ticket, notificationType),
          status_bg: this.oaStatusColor(ticket, notificationType)
        },
        body: {
          title: this.ticketHeadline(ticket, notificationType),
          form: this.oaForm(ticket),
          rich: this.oaRich(stats),
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
            markdown: `## ${title}\n\n${status}`
          },
          {
            type: "markdown",
            id: "ticket_notice",
            markdown: this.interactiveNotice(content)
          },
          {
            type: "divider",
            id: "divider_base"
          },
          {
            type: "markdown",
            id: "ticket_base",
            markdown: this.interactiveBaseMarkdown(ticket)
          },
          {
            type: "divider",
            id: "divider_stats"
          },
          {
            type: "markdown",
            id: "ticket_stats",
            markdown: this.interactiveStatsMarkdown(stats)
          },
          {
            type: "action",
            id: "ticket_action",
            actions: [
              {
                type: "jump",
                text: action.title,
                url: action.url
              }
            ]
          }
        ].filter((item) => !(item.type === "markdown" && "markdown" in item && !item.markdown))
      }
    };
  }

  private ticketAction(ticket: TicketNotificationInfo, target: NotifyTarget, notificationType: NotificationType) {
    const baseUrl = this.appBaseUrl();
    if (!baseUrl) return null;
    const isHandler = target.dingtalkUserId === ticket.handlerUserId;
    const isApplicant = target.dingtalkUserId === ticket.applicantUserId;
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

  private oaContent(ticket: TicketNotificationInfo, content: string, stats: TicketNoticeStats, actionTitle: string) {
    const notice = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0];
    const statText = stats.metrics.map((metric) => `${metric.label}${metric.value}`).join("，");
    return [
      notice || `${ticket.ticketNo} 状态更新`,
      `当前状态：${statusText[ticket.status]}`,
      `问题摘要：${this.descriptionSummary(ticket.description)}`,
      `${stats.title}：${statText}`,
      stats.footnote,
      `点击卡片${actionTitle}`
    ].join("\n");
  }

  private oaStatusText(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "已超时";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "即将超时";
    return statusText[ticket.status];
  }

  private oaHeadColor(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "FFFFEAEA";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "FFFFF4DE";
    if (ticket.status === "COMPLETED" || ticket.status === "CLOSED") return "FFE9F9F1";
    return "FFEAF6FF";
  }

  private oaStatusColor(ticket: TicketNotificationInfo, notificationType: NotificationType) {
    if (notificationType === "TICKET_OVERDUE") return "0xFFFF4D4F";
    if (notificationType === "TICKET_FIRST_RESPONSE_DUE_SOON" || notificationType === "TICKET_RESOLVE_DUE_SOON") return "0xFFFF9800";
    const colors: Record<Ticket["status"], string> = {
      PENDING: "0xFFFF9800",
      ASSIGNED: "0xFF007CBE",
      PROCESSING: "0xFF16C784",
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
    const isHandler = target.dingtalkUserId === ticket.handlerUserId;
    const isApplicant = target.dingtalkUserId === ticket.applicantUserId;

    if (isHandler) {
      const [completedThisMonth, activeCount, overdueCount, onTimeCompleted, todayCompleted] = await this.prisma.$transaction([
        this.prisma.ticket.count({
          where: { handlerUserId: target.dingtalkUserId, status: { in: finishedStatuses }, resolvedAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { handlerUserId: target.dingtalkUserId, status: { in: activeStatuses } }
        }),
        this.prisma.ticket.count({
          where: {
            handlerUserId: target.dingtalkUserId,
            status: { in: activeStatuses },
            OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }]
          }
        }),
        this.prisma.ticket.count({
          where: {
            handlerUserId: target.dingtalkUserId,
            status: { in: finishedStatuses },
            resolvedAt: { gte: monthStart },
            isResolveOverdue: false
          }
        }),
        this.prisma.ticket.count({
          where: { handlerUserId: target.dingtalkUserId, status: { in: finishedStatuses }, resolvedAt: { gte: dayStart } }
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
          where: { applicantUserId: target.dingtalkUserId, createdAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { applicantUserId: target.dingtalkUserId, status: { in: activeStatuses } }
        }),
        this.prisma.ticket.count({
          where: { applicantUserId: target.dingtalkUserId, status: { in: finishedStatuses }, resolvedAt: { gte: monthStart } }
        }),
        this.prisma.ticket.count({
          where: { applicantUserId: target.dingtalkUserId, createdAt: { gte: dayStart } }
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
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private startOfDay() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private descriptionSummary(description: string) {
    const text = description.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}...` : text || "-";
  }

  private escapeMarkdown(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }
}
