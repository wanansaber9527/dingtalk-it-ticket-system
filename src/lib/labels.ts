// 中文注释：通用基础库，封装 Prisma、HTTP 响应、标签映射和前端请求方法。
import type {
  SatisfactionLevel,
  SendStatus,
  TicketActionType,
  NotificationType,
  TicketPriority,
  TicketStatus,
  UserRole,
  UserStatus
} from "@prisma/client";

export const roleLabels: Record<UserRole, string> = {
  EMPLOYEE: "普通员工",
  IT_HANDLER: "IT处理人",
  SUPER_ADMIN: "超级管理员"
};

export const userStatusLabels: Record<UserStatus, string> = {
  ACTIVE: "启用",
  DISABLED: "禁用"
};

export const priorityLabels: Record<TicketPriority, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急"
};

export const ticketStatusLabels: Record<TicketStatus, string> = {
  PENDING: "待受理",
  ASSIGNED: "已分派",
  PROCESSING: "处理中",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  REJECTED: "已驳回",
  CANCELLED: "已取消"
};

export const actionTypeLabels: Record<TicketActionType, string> = {
  CREATE: "创建工单",
  ASSIGN: "分派工单",
  ACCEPT: "接单",
  COMMENT: "补充说明",
  TRANSFER: "转交工单",
  RESOLVE: "处理完成",
  REJECT: "驳回",
  CONFIRM: "确认完成",
  CLOSE: "关闭",
  CANCEL: "取消",
  REOPEN: "退回继续处理",
  STATUS_CHANGE: "状态变更",
  SATISFACTION: "满意度评价",
  SYNC_AI_TABLE_FAILED: "外部同步失败",
  SYNC_AI_TABLE_SUCCESS: "外部同步成功"
};

export const satisfactionLabels: Record<SatisfactionLevel, string> = {
  SATISFIED: "满意",
  NORMAL: "一般",
  UNSATISFIED: "不满意"
};

export const sendStatusLabels: Record<SendStatus, string> = {
  PENDING: "待发送",
  SUCCESS: "成功",
  FAILED: "失败"
};

export const notificationTypeLabels: Record<NotificationType, string> = {
  TICKET_CREATED: "工单提交成功",
  NEW_TICKET_PENDING: "新工单待处理",
  TICKET_ASSIGNED: "工单分派",
  STATUS_UPDATED: "状态更新",
  TICKET_RESOLVED: "工单处理完成",
  TICKET_FIRST_RESPONSE_DUE_SOON: "首响即将超时",
  TICKET_RESOLVE_DUE_SOON: "处理即将超时",
  TICKET_OVERDUE: "工单已超时",
  UNSATISFIED_REVIEW: "不满意评价"
};

export const ticketCategorySeeds = [
  { name: "电脑故障", firstResponseMinutes: 60, resolveMinutes: 1440, sortOrder: 10 },
  { name: "网络问题", firstResponseMinutes: 30, resolveMinutes: 240, sortOrder: 20 },
  { name: "打印机问题", firstResponseMinutes: 60, resolveMinutes: 480, sortOrder: 30 },
  { name: "钉钉问题", firstResponseMinutes: 120, resolveMinutes: 1440, sortOrder: 40 },
  { name: "在线表格问题", firstResponseMinutes: 120, resolveMinutes: 2880, sortOrder: 50 },
  { name: "系统账号问题", firstResponseMinutes: 240, resolveMinutes: 1440, sortOrder: 60 },
  { name: "软件安装", firstResponseMinutes: 240, resolveMinutes: 1440, sortOrder: 70 },
  { name: "RPA/自动化问题", firstResponseMinutes: 480, resolveMinutes: 4320, sortOrder: 80 },
  { name: "数据报表问题", firstResponseMinutes: 480, resolveMinutes: 4320, sortOrder: 90 },
  { name: "其他问题", firstResponseMinutes: 240, resolveMinutes: 2880, sortOrder: 100 }
];
