// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { NotificationType, PrismaClient, Ticket, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";

type NotifyTarget = Pick<User, "dingtalkUserId" | "name">;

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  async sendTicketNotification(
    ticket: Pick<Ticket, "id" | "ticketNo"> | null,
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
      await this.dingtalkClient.sendWorkNotification(target.dingtalkUserId, content);
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
    const notification = await this.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
    try {
      await this.dingtalkClient.sendWorkNotification(notification.receiverUserId, notification.content);
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
}
