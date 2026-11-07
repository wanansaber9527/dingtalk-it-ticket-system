import { FIELD_LABELS, SLA_RUNNING_STATUSES } from "./constants.js";
import { sameInstant } from "./time.js";

export const EDITABLE_FIELDS = [
  "title",
  "categoryName",
  "priority",
  "status",
  "applicantName",
  "applicantDepartment",
  "applicantPosition",
  "handlerUserId",
  "handlerName",
  "description",
  "expectedResolveTime",
  "firstResponseAt",
  "resolvedAt",
  "closedAt",
  "slaFirstResponseDeadline",
  "slaResolveDeadline",
  "resultSummary",
  "satisfactionLevel",
  "satisfactionComment",
  "createdAt"
];

const DATE_FIELDS = new Set([
  "expectedResolveTime",
  "firstResponseAt",
  "resolvedAt",
  "closedAt",
  "slaFirstResponseDeadline",
  "slaResolveDeadline",
  "createdAt"
]);

const FIRST_RESPONSE_OVERDUE_DEPENDENCIES = [
  "status",
  "firstResponseAt",
  "slaFirstResponseDeadline"
];

const RESOLVE_OVERDUE_DEPENDENCIES = [
  "status",
  "resolvedAt",
  "slaResolveDeadline"
];

export function calculateOverdue(actualAt, deadline, status, now = new Date()) {
  if (!deadline) return false;
  if (actualAt) return new Date(actualAt).getTime() > new Date(deadline).getTime();
  return SLA_RUNNING_STATUSES.has(status) && now.getTime() > new Date(deadline).getTime();
}

export function calculateTicketOverdue(ticket, now = new Date()) {
  return {
    isFirstResponseOverdue: calculateOverdue(
      ticket.firstResponseAt,
      ticket.slaFirstResponseDeadline,
      ticket.status,
      now
    ),
    isResolveOverdue: calculateOverdue(
      ticket.resolvedAt,
      ticket.slaResolveDeadline,
      ticket.status,
      now
    )
  };
}

function fieldEqual(field, before, after) {
  return DATE_FIELDS.has(field) ? sameInstant(before, after) : (before ?? null) === (after ?? null);
}

function auditValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function anyDependencyChanged(current, candidate, dependencies) {
  return dependencies.some(
    (field) => !fieldEqual(field, current[field], candidate[field])
  );
}

export function planTicketCorrection(current, fields, now = new Date()) {
  const candidate = {
    ...current,
    ...Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, fields[field]]))
  };

  const overdue = {
    isFirstResponseOverdue: anyDependencyChanged(
      current,
      candidate,
      FIRST_RESPONSE_OVERDUE_DEPENDENCIES
    )
      ? calculateOverdue(
          candidate.firstResponseAt,
          candidate.slaFirstResponseDeadline,
          candidate.status,
          now
        )
      : Boolean(current.isFirstResponseOverdue),
    isResolveOverdue: anyDependencyChanged(
      current,
      candidate,
      RESOLVE_OVERDUE_DEPENDENCIES
    )
      ? calculateOverdue(
          candidate.resolvedAt,
          candidate.slaResolveDeadline,
          candidate.status,
          now
        )
      : Boolean(current.isResolveOverdue)
  };
  const next = { ...candidate, ...overdue };
  const comparedFields = [...EDITABLE_FIELDS, "isFirstResponseOverdue", "isResolveOverdue"];
  const changes = comparedFields
    .filter((field) => !fieldEqual(field, current[field], next[field]))
    .map((field) => ({
      field,
      label: FIELD_LABELS[field] || field,
      before: auditValue(current[field]),
      after: auditValue(next[field])
    }));

  return {
    changes,
    next,
    updateData: {
      ...Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, next[field]])),
      ...overdue
    }
  };
}
