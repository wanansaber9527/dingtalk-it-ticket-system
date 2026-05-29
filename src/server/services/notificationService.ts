// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { NotificationType, PrismaClient, Ticket, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";
import type { DingTalkWorkNoticeMessage } from "@/src/server/dingtalk/DingTalkClient";

type NotifyTarget = Pick<User, "dingtalkUserId" | "name">;
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
      await this.dingtalkClient.sendWorkNotification(
        target.dingtalkUserId,
        this.buildTicketWorkNotice(ticket, target, notificationType, content)
      );
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
      await this.dingtalkClient.sendWorkNotification(
        notification.receiverUserId,
        this.buildTicketWorkNotice(
          notification.ticket,
          { dingtalkUserId: notification.receiverUserId, name: notification.receiverName },
          notification.notificationType,
          notification.content
        )
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

  private buildTicketWorkNotice(
    ticket: TicketNotificationInfo | null,
    target: NotifyTarget,
    notificationType: NotificationType,
    content: string
  ): string | DingTalkWorkNoticeMessage {
    const action = ticket ? this.ticketAction(ticket, target, notificationType) : null;
    if (!ticket || !action) return content;
    return {
      msgtype: "action_card",
      action_card: {
        title: `${ticket.ticketNo} ${ticket.title}`,
        markdown: this.ticketMarkdown(ticket, content),
        single_title: action.title,
        single_url: action.url
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

  private ticketMarkdown(ticket: TicketNotificationInfo, content: string) {
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
      "### 趣然工单通知",
      "",
      ...noticeLines.map((line) => `**${this.escapeMarkdown(line)}**  `),
      "",
      ...rows.map(([key, value]) => `**${key}：** ${this.escapeMarkdown(value)}  `)
    ]
      .filter(Boolean)
      .join("\n");
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

  private descriptionSummary(description: string) {
    const text = description.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}...` : text || "-";
  }

  private escapeMarkdown(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }
}
