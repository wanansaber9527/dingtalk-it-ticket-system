import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOverdue,
  calculateTicketOverdue,
  prepareTicketCorrection,
  ticketFingerprint
} from "../lib/ticket-domain.js";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function baseTicket(overrides = {}) {
  return {
    id: "ticket-1",
    ticketNo: "IT202607290001",
    title: "电脑异常",
    categoryId: "category-1",
    categoryName: "终端支持",
    priority: "NORMAL",
    status: "COMPLETED",
    applicantUserId: "applicant-1",
    applicantName: "测试员工",
    applicantDepartment: "测试部门",
    applicantPosition: "专员",
    handlerUserId: "handler-1",
    handlerName: "处理人",
    description: "测试问题",
    attachments: JSON.stringify([
      { name: "error.png", url: "/uploads/error.png", size: 128 }
    ]),
    expectedResolveTime: null,
    firstResponseAt: new Date("2026-07-29T08:10:00.000Z"),
    resolvedAt: new Date("2026-07-29T09:00:00.000Z"),
    closedAt: null,
    slaFirstResponseDeadline: new Date("2026-07-29T08:30:00.000Z"),
    slaResolveDeadline: new Date("2026-07-29T10:00:00.000Z"),
    isFirstResponseOverdue: false,
    isResolveOverdue: false,
    resultSummary: "已修复",
    satisfactionLevel: null,
    satisfactionComment: null,
    createdAt: new Date("2026-07-29T08:00:00.000Z"),
    updatedAt: new Date("2026-07-29T10:00:00.000Z"),
    ...overrides
  };
}

function fieldsFrom(ticket) {
  return {
    title: ticket.title,
    categoryName: ticket.categoryName,
    priority: ticket.priority,
    status: ticket.status,
    applicantName: ticket.applicantName,
    applicantDepartment: ticket.applicantDepartment,
    applicantPosition: ticket.applicantPosition,
    handlerUserId: ticket.handlerUserId,
    handlerName: ticket.handlerName,
    description: ticket.description,
    expectedResolveTime: ticket.expectedResolveTime,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    slaFirstResponseDeadline: ticket.slaFirstResponseDeadline,
    slaResolveDeadline: ticket.slaResolveDeadline,
    resultSummary: ticket.resultSummary,
    satisfactionLevel: ticket.satisfactionLevel,
    satisfactionComment: ticket.satisfactionComment,
    createdAt: ticket.createdAt
  };
}

test("完成时间早于或等于截止时间时为正常，晚于时为超时", () => {
  const deadline = new Date("2026-07-29T10:00:00.000Z");
  assert.equal(calculateOverdue(new Date("2026-07-29T09:59:59.999Z"), deadline, "COMPLETED", NOW), false);
  assert.equal(calculateOverdue(new Date("2026-07-29T10:00:00.000Z"), deadline, "COMPLETED", NOW), false);
  assert.equal(calculateOverdue(new Date("2026-07-29T10:00:00.001Z"), deadline, "COMPLETED", NOW), true);
});

test("没有截止时间时不判超时", () => {
  assert.equal(calculateOverdue(new Date("2026-07-29T10:00:00.001Z"), null, "COMPLETED", NOW), false);
});

test("未完成工单只在 SLA 运行状态下按当前时间判断", () => {
  const deadline = new Date("2026-07-29T11:59:59.999Z");
  assert.equal(calculateOverdue(null, deadline, "PROCESSING", NOW), true);
  assert.equal(calculateOverdue(null, deadline, "RETURNED", NOW), false);
  assert.equal(calculateOverdue(null, deadline, "CLOSED", NOW), false);
});

test("更正完成时间会把处理超时从超时双向清回正常", () => {
  const current = baseTicket({
    resolvedAt: new Date("2026-07-29T10:30:00.000Z"),
    isResolveOverdue: true
  });
  const fields = fieldsFrom(current);
  fields.resolvedAt = new Date("2026-07-29T09:30:00.000Z");
  const prepared = prepareTicketCorrection(current, fields, NOW);
  assert.equal(prepared.updateData.isResolveOverdue, false);
  assert.equal(
    prepared.changes.some(
      (change) => change.field === "isResolveOverdue" && change.after === false
    ),
    true
  );
});

test("修改完成时间不改变独立的首响超时结果", () => {
  const current = baseTicket({
    firstResponseAt: new Date("2026-07-29T09:00:00.000Z"),
    isFirstResponseOverdue: true,
    resolvedAt: new Date("2026-07-29T10:30:00.000Z"),
    isResolveOverdue: true
  });
  const fields = fieldsFrom(current);
  fields.resolvedAt = new Date("2026-07-29T09:30:00.000Z");
  const prepared = prepareTicketCorrection(current, fields, NOW);
  assert.equal(prepared.updateData.isFirstResponseOverdue, true);
  assert.equal(prepared.updateData.isResolveOverdue, false);
});

test("修改标题等无关字段不重算历史 SLA 标记", () => {
  const current = baseTicket({
    isFirstResponseOverdue: true,
    isResolveOverdue: true
  });
  const fields = fieldsFrom(current);
  fields.title = "更正后的标题";

  const prepared = prepareTicketCorrection(current, fields, NOW);
  assert.equal(prepared.updateData.isFirstResponseOverdue, true);
  assert.equal(prepared.updateData.isResolveOverdue, true);
  assert.equal(
    prepared.changes.some((change) =>
      ["isFirstResponseOverdue", "isResolveOverdue"].includes(change.field)
    ),
    false
  );
});

test("首响依赖变化只重算首响超时，不改处理超时", () => {
  const current = baseTicket({
    isFirstResponseOverdue: true,
    isResolveOverdue: true
  });
  const fields = fieldsFrom(current);
  fields.firstResponseAt = new Date("2026-07-29T08:20:00.000Z");

  const prepared = prepareTicketCorrection(current, fields, NOW);
  assert.equal(prepared.updateData.isFirstResponseOverdue, false);
  assert.equal(prepared.updateData.isResolveOverdue, true);
});

test("首响和处理 SLA 截止时间只重算各自的超时标记", () => {
  const current = baseTicket({
    isFirstResponseOverdue: true,
    isResolveOverdue: true
  });

  const firstResponseFields = fieldsFrom(current);
  firstResponseFields.slaFirstResponseDeadline = new Date("2026-07-29T09:30:00.000Z");
  const firstResponsePrepared = prepareTicketCorrection(
    current,
    firstResponseFields,
    NOW
  );
  assert.equal(firstResponsePrepared.updateData.isFirstResponseOverdue, false);
  assert.equal(firstResponsePrepared.updateData.isResolveOverdue, true);

  const resolveFields = fieldsFrom(current);
  resolveFields.slaResolveDeadline = new Date("2026-07-29T11:00:00.000Z");
  const resolvePrepared = prepareTicketCorrection(current, resolveFields, NOW);
  assert.equal(resolvePrepared.updateData.isFirstResponseOverdue, true);
  assert.equal(resolvePrepared.updateData.isResolveOverdue, false);
});

test("状态变化会同时重算首响和处理超时", () => {
  const current = baseTicket({
    isFirstResponseOverdue: true,
    isResolveOverdue: true
  });
  const fields = fieldsFrom(current);
  fields.status = "CLOSED";
  fields.closedAt = new Date("2026-07-29T09:30:00.000Z");

  const prepared = prepareTicketCorrection(current, fields, NOW);
  assert.equal(prepared.updateData.isFirstResponseOverdue, false);
  assert.equal(prepared.updateData.isResolveOverdue, false);
});

test("状态和时间矛盾时拒绝保存", () => {
  const current = baseTicket();
  const fields = fieldsFrom(current);
  fields.status = "PROCESSING";
  assert.throws(
    () => prepareTicketCorrection(current, fields, NOW),
    /未结束状态不能保留完成时间/
  );
});

test("指纹覆盖 Ticket 全行有业务意义的标量字段", () => {
  const original = baseTicket();
  const fingerprint = ticketFingerprint(original);

  for (const [field, value] of Object.entries(original)) {
    const changedValue =
      value instanceof Date
        ? new Date(value.getTime() + 1)
        : typeof value === "boolean"
          ? !value
          : value === null
            ? `changed-${field}`
            : `${value}-changed`;
    assert.notEqual(
      fingerprint,
      ticketFingerprint({ ...original, [field]: changedValue }),
      `字段 ${field} 未纳入指纹`
    );
  }

  assert.equal(
    calculateTicketOverdue(original, NOW).isResolveOverdue,
    false
  );
});
