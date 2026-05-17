// 中文注释：钉钉集成封装，集中处理钉钉开放平台和 AI 表格同步相关逻辑。
import type { KnowledgeBase, Ticket, TicketCategory, TicketLog } from "@prisma/client";
import {
  actionTypeLabels,
  priorityLabels,
  satisfactionLabels,
  ticketStatusLabels
} from "@/src/lib/labels";

function dateText(value?: Date | null) {
  return value ? value.toISOString() : "";
}

function boolText(value?: boolean | null) {
  return value ? "是" : "否";
}

function attachmentsText(value?: string | null) {
  if (!value) return "";
  try {
    const list = JSON.parse(value) as Array<{ url?: string; name?: string }>;
    return list.map((item) => item.url || item.name).filter(Boolean).join("\n");
  } catch {
    return value;
  }
}

export const aiTableTableIds = {
  ticket: () => process.env.DINGTALK_AI_TABLE_TICKET_TABLE_ID || "",
  log: () => process.env.DINGTALK_AI_TABLE_LOG_TABLE_ID || "",
  category: () => process.env.DINGTALK_AI_TABLE_CATEGORY_TABLE_ID || "",
  knowledgeBase: () => process.env.DINGTALK_AI_TABLE_KB_TABLE_ID || "",
  satisfaction: () => process.env.DINGTALK_AI_TABLE_SATISFACTION_TABLE_ID || ""
};

export function mapTicketToAiTable(ticket: Ticket) {
  return {
    工单编号: ticket.ticketNo,
    工单标题: ticket.title,
    申请人: ticket.applicantName,
    所属部门: ticket.applicantDepartment || "",
    问题分类: ticket.categoryName,
    紧急程度: priorityLabels[ticket.priority],
    当前状态: ticketStatusLabels[ticket.status],
    处理人: ticket.handlerName || "",
    提交时间: dateText(ticket.createdAt),
    首次响应时间: dateText(ticket.firstResponseAt),
    完成时间: dateText(ticket.resolvedAt),
    关闭时间: dateText(ticket.closedAt),
    首响是否超时: boolText(ticket.isFirstResponseOverdue),
    完成是否超时: boolText(ticket.isResolveOverdue),
    问题描述: ticket.description,
    附件链接: attachmentsText(ticket.attachments),
    处理结果: ticket.resultSummary || "",
    满意度: ticket.satisfactionLevel ? satisfactionLabels[ticket.satisfactionLevel] : "",
    满意度原因: ticket.satisfactionComment || "",
    是否沉淀知识库: "",
    关联知识库编号: ""
  };
}

export function mapTicketLogToAiTable(log: TicketLog) {
  return {
    工单编号: log.ticketNo,
    操作时间: dateText(log.createdAt),
    操作人: log.operatorName,
    操作类型: actionTypeLabels[log.actionType],
    原状态: log.fromStatus ? ticketStatusLabels[log.fromStatus] : "",
    新状态: log.toStatus ? ticketStatusLabels[log.toStatus] : "",
    操作备注: log.remark || ""
  };
}

export function mapCategoryToAiTable(category: TicketCategory) {
  return {
    分类名称: category.name,
    默认处理人: category.defaultHandlerName || "",
    首响时限: category.firstResponseMinutes ? `${category.firstResponseMinutes}分钟` : "",
    完成时限: category.resolveMinutes ? `${category.resolveMinutes}分钟` : "",
    是否启用: boolText(category.enabled)
  };
}

export function mapKnowledgeBaseToAiTable(kb: KnowledgeBase) {
  return {
    知识编号: kb.kbNo,
    问题标题: kb.title,
    问题分类: kb.categoryName || "",
    适用部门: kb.applicableDepartments || "",
    问题描述: kb.problemDescription,
    解决步骤: kb.solutionSteps,
    来源工单: kb.sourceTicketNo || "",
    维护人: kb.maintainerName || "",
    是否启用: boolText(kb.enabled),
    更新时间: dateText(kb.updatedAt)
  };
}

export function mapSatisfactionToAiTable(ticket: Ticket) {
  return {
    工单编号: ticket.ticketNo,
    申请人: ticket.applicantName,
    处理人: ticket.handlerName || "",
    满意度: ticket.satisfactionLevel ? satisfactionLabels[ticket.satisfactionLevel] : "",
    评价原因: ticket.satisfactionComment || "",
    评价时间: dateText(ticket.updatedAt)
  };
}
