import crypto from "node:crypto";
import { ACTIVE_STATUSES } from "./constants.js";
import { AppError } from "./http.js";
import { planTicketCorrection } from "./ticket-plan.js";
export { calculateOverdue, calculateTicketOverdue } from "./ticket-plan.js";

const FINGERPRINT_FIELDS = [
  "id",
  "ticketNo",
  "title",
  "categoryId",
  "categoryName",
  "priority",
  "status",
  "applicantUserId",
  "applicantName",
  "applicantDepartment",
  "applicantPosition",
  "handlerUserId",
  "handlerName",
  "description",
  "attachments",
  "expectedResolveTime",
  "firstResponseAt",
  "resolvedAt",
  "closedAt",
  "slaFirstResponseDeadline",
  "slaResolveDeadline",
  "isFirstResponseOverdue",
  "isResolveOverdue",
  "resultSummary",
  "satisfactionLevel",
  "satisfactionComment",
  "createdAt",
  "updatedAt"
];

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function canonicalTicket(ticket) {
  return Object.fromEntries(
    FINGERPRINT_FIELDS.map((field) => [field, comparable(ticket[field])])
  );
}

export function ticketFingerprint(ticket) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalTicket(ticket))).digest("hex");
}

function ensureNotBeforeCreatedAt(candidate, field, label) {
  const value = candidate[field];
  if (value && value.getTime() < candidate.createdAt.getTime()) {
    throw new AppError(400, "TIME_ORDER_INVALID", `${label}不能早于提交时间`);
  }
}

export function validateTicketConsistency(candidate) {
  if (!(candidate.createdAt instanceof Date) || Number.isNaN(candidate.createdAt.getTime())) {
    throw new AppError(400, "CREATED_AT_REQUIRED", "提交时间不能为空");
  }

  ensureNotBeforeCreatedAt(candidate, "expectedResolveTime", "期望完成时间");
  ensureNotBeforeCreatedAt(candidate, "firstResponseAt", "首次响应时间");
  ensureNotBeforeCreatedAt(candidate, "resolvedAt", "完成时间");
  ensureNotBeforeCreatedAt(candidate, "closedAt", "关闭时间");
  ensureNotBeforeCreatedAt(candidate, "slaFirstResponseDeadline", "首响 SLA 截止时间");
  ensureNotBeforeCreatedAt(candidate, "slaResolveDeadline", "完成 SLA 截止时间");

  if (
    candidate.firstResponseAt &&
    candidate.resolvedAt &&
    candidate.firstResponseAt.getTime() > candidate.resolvedAt.getTime()
  ) {
    throw new AppError(400, "TIME_ORDER_INVALID", "完成时间不能早于首次响应时间");
  }
  if (
    candidate.resolvedAt &&
    candidate.closedAt &&
    candidate.resolvedAt.getTime() > candidate.closedAt.getTime()
  ) {
    throw new AppError(400, "TIME_ORDER_INVALID", "关闭时间不能早于完成时间");
  }

  const hasHandlerId = Boolean(candidate.handlerUserId);
  const hasHandlerName = Boolean(candidate.handlerName);
  if (hasHandlerId !== hasHandlerName) {
    throw new AppError(400, "HANDLER_PAIR_INVALID", "处理人用户 ID 和姓名必须同时填写或同时清空");
  }

  if (ACTIVE_STATUSES.has(candidate.status) && (candidate.resolvedAt || candidate.closedAt)) {
    throw new AppError(400, "STATUS_TIME_CONFLICT", "未结束状态不能保留完成时间或关闭时间");
  }
  if (candidate.status === "COMPLETED" && !candidate.resolvedAt) {
    throw new AppError(400, "RESOLVED_AT_REQUIRED", "已完成工单必须填写完成时间");
  }
  if (candidate.status === "COMPLETED" && candidate.closedAt) {
    throw new AppError(400, "STATUS_TIME_CONFLICT", "已完成但未关闭的工单不能填写关闭时间");
  }
  if (candidate.status === "CLOSED" && !candidate.closedAt) {
    throw new AppError(400, "CLOSED_AT_REQUIRED", "已关闭工单必须填写关闭时间");
  }
  if (
    ["REJECTED", "CANCELLED"].includes(candidate.status) &&
    (candidate.resolvedAt || candidate.closedAt)
  ) {
    throw new AppError(400, "STATUS_TIME_CONFLICT", "已驳回或已取消工单不能保留完成时间或关闭时间");
  }

  if (
    candidate.satisfactionLevel &&
    !["COMPLETED", "CLOSED"].includes(candidate.status)
  ) {
    throw new AppError(400, "SATISFACTION_STATUS_INVALID", "只有已完成或已关闭工单可以保留满意度");
  }
  if (!candidate.satisfactionLevel && candidate.satisfactionComment) {
    throw new AppError(400, "SATISFACTION_INVALID", "填写满意度说明前必须选择满意度");
  }
  if (
    ["NORMAL", "UNSATISFIED"].includes(candidate.satisfactionLevel) &&
    !candidate.satisfactionComment
  ) {
    throw new AppError(400, "SATISFACTION_COMMENT_REQUIRED", "一般或不满意时必须填写满意度说明");
  }
}

export function prepareTicketCorrection(current, fields, now = new Date()) {
  const plan = planTicketCorrection(current, fields, now);
  validateTicketConsistency(plan.next);
  if (!plan.changes.length) {
    throw new AppError(400, "NO_CHANGES", "没有检测到需要保存的更正");
  }
  return plan;
}
