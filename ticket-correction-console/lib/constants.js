export const TICKET_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "PROCESSING",
  "RETURNED",
  "COMPLETED",
  "CLOSED",
  "REJECTED",
  "CANCELLED"
];

export const ACTIVE_STATUSES = new Set(["PENDING", "ASSIGNED", "PROCESSING", "RETURNED"]);
export const SLA_RUNNING_STATUSES = new Set(["PENDING", "ASSIGNED", "PROCESSING"]);

export const STATUS_LABELS = {
  PENDING: "待受理",
  ASSIGNED: "已分派",
  PROCESSING: "处理中",
  RETURNED: "待申请人补充",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  REJECTED: "已驳回",
  CANCELLED: "已取消"
};

export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export const PRIORITY_LABELS = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急"
};

export const SATISFACTION_LEVELS = ["SATISFIED", "NORMAL", "UNSATISFIED"];

export const SATISFACTION_LABELS = {
  SATISFIED: "满意",
  NORMAL: "一般",
  UNSATISFIED: "不满意"
};

export const FIELD_LABELS = {
  title: "工单标题",
  categoryName: "工单分类",
  priority: "紧急程度",
  status: "工单状态",
  applicantName: "申请人",
  applicantDepartment: "申请部门",
  applicantPosition: "申请岗位",
  handlerUserId: "处理人用户 ID",
  handlerName: "处理人姓名",
  description: "问题描述",
  expectedResolveTime: "期望完成时间",
  firstResponseAt: "首次响应时间",
  resolvedAt: "完成时间",
  closedAt: "关闭时间",
  slaFirstResponseDeadline: "首响 SLA 截止时间",
  slaResolveDeadline: "完成 SLA 截止时间",
  isFirstResponseOverdue: "首响超时",
  isResolveOverdue: "处理超时",
  resultSummary: "处理结果",
  satisfactionLevel: "满意度",
  satisfactionComment: "满意度说明",
  createdAt: "提交时间"
};
