import { parseShanghaiDateTime } from "./time.js";
import { planTicketCorrection } from "./ticket-plan.js";

export const DATE_FIELDS = [
  "createdAt", "expectedResolveTime", "firstResponseAt", "slaFirstResponseDeadline",
  "resolvedAt", "slaResolveDeadline", "closedAt"
];
const OPTIONAL_TEXT_FIELDS = [
  "applicantDepartment", "applicantPosition", "handlerUserId", "handlerName",
  "resultSummary", "satisfactionComment"
];

export function draftPayloadFields(draft) {
  return {
    ...draft,
    ...Object.fromEntries(["title", "categoryName", "applicantName", "description"]
      .map((field) => [field, draft[field]?.trim() || ""])),
    ...Object.fromEntries(OPTIONAL_TEXT_FIELDS
      .map((field) => [field, draft[field]?.trim() || null])),
    satisfactionLevel: draft.satisfactionLevel || null,
    ...Object.fromEntries(DATE_FIELDS.map((field) => [field, draft[field] || null]))
  };
}

export function previewTicketCorrection(ticket, draft, now = new Date()) {
  const payloadFields = draftPayloadFields(draft);
  const parsedFields = {
    ...payloadFields,
    ...Object.fromEntries(DATE_FIELDS.map((field) => [
      field, parseShanghaiDateTime(payloadFields[field])
    ]))
  };
  return planTicketCorrection(ticket, parsedFields, now);
}
