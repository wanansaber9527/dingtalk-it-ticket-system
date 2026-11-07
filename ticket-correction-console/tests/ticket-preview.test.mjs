import test from "node:test";
import assert from "node:assert/strict";
import { previewTicketCorrection, draftPayloadFields, DATE_FIELDS } from "../lib/ticket-preview.js";
import { prepareTicketCorrection } from "../lib/ticket-domain.js";
import { parseCorrectionPayload } from "../lib/validation.js";
import { toShanghaiInputValue } from "../lib/time.js";

const ticket = {
  id: "test", title: "旧标题", categoryName: "设备", priority: "NORMAL", status: "COMPLETED",
  applicantName: "员工", applicantDepartment: null, applicantPosition: null,
  handlerUserId: null, handlerName: null, description: "问题描述", expectedResolveTime: null,
  createdAt: new Date("2026-07-29T08:00:00Z"), updatedAt: new Date("2026-07-29T11:00:00Z"),
  firstResponseAt: new Date("2026-07-29T08:10:00Z"), slaFirstResponseDeadline: new Date("2026-07-29T08:30:00Z"),
  resolvedAt: new Date("2026-07-29T09:00:00Z"), slaResolveDeadline: new Date("2026-07-29T10:00:00Z"),
  closedAt: null, isFirstResponseOverdue: true, isResolveOverdue: true,
  resultSummary: null, satisfactionLevel: null, satisfactionComment: null
};

function draftFrom(source) {
  const { id, updatedAt, isFirstResponseOverdue, isResolveOverdue, ...fields } = source;
  return { ...fields, ...Object.fromEntries(DATE_FIELDS.map((field) => [field, toShanghaiInputValue(source[field])])) };
}

test("只改标题时预览与服务端一致保留历史 SLA 标记", () => {
  const draft = { ...draftFrom(ticket), title: " 更正标题 " };
  const serializedTicket = JSON.parse(JSON.stringify(ticket));
  const preview = previewTicketCorrection(serializedTicket, draft);
  const parsed = parseCorrectionPayload({
    expectedUpdatedAt: ticket.updatedAt.toISOString(), expectedFingerprint: "a".repeat(64),
    reason: "核对后更正", fields: draftPayloadFields(draft)
  });
  const server = prepareTicketCorrection(ticket, parsed.fields);
  assert.deepEqual(preview.changes, server.changes);
  assert.deepEqual(preview.changes.map((change) => change.field), ["title"]);
  assert.equal(preview.next.isFirstResponseOverdue, true);
  assert.equal(preview.next.isResolveOverdue, true);
});

test("更正完成时间只重算处理 SLA，确认值与保存值一致", () => {
  const draft = { ...draftFrom(ticket), resolvedAt: "2026-07-29T17:30:00.000" };
  const preview = previewTicketCorrection(JSON.parse(JSON.stringify(ticket)), draft);
  const parsed = parseCorrectionPayload({
    expectedUpdatedAt: ticket.updatedAt.toISOString(), expectedFingerprint: "a".repeat(64),
    reason: "核对后更正", fields: draftPayloadFields(draft)
  });
  const server = prepareTicketCorrection(ticket, parsed.fields);
  assert.deepEqual(preview.changes, server.changes);
  assert.equal(preview.next.isResolveOverdue, false);
  assert.equal(preview.next.isFirstResponseOverdue, true);
});
