import { prisma } from "./prisma.js";
import { appendAudit, inspectAuditChain } from "./audit.js";
import { AppError } from "./http.js";
import { ticketFingerprint } from "./ticket-domain.js";
import { withCorrectionLock } from "./correction-lock.js";

const TERMINAL_PHASES = new Set([
  "COMMITTED",
  "FAILED",
  "RECOVERED_COMMITTED",
  "RECOVERED_NOT_COMMITTED"
]);

function operationStates(records) {
  const states = new Map();
  for (const record of records) {
    if (!record.operationId) continue;
    const state = states.get(record.operationId) || { prepared: null, latest: null };
    if (record.phase === "PREPARED") state.prepared = record;
    state.latest = record;
    states.set(record.operationId, state);
  }
  return states;
}

export function classifyAuditRecovery(prepared, currentFingerprint) {
  if (
    typeof prepared?.ticketId !== "string" ||
    typeof prepared.expectedFingerprint !== "string" ||
    typeof prepared.plannedFingerprint !== "string"
  ) {
    throw new AppError(
      503,
      "AUDIT_RECORD_INCOMPLETE",
      "独立更正记录缺少恢复信息，写入功能已关闭"
    );
  }
  if (currentFingerprint === prepared.plannedFingerprint) {
    return "RECOVERED_COMMITTED";
  }
  if (currentFingerprint === prepared.expectedFingerprint) {
    return "RECOVERED_NOT_COMMITTED";
  }
  return "RECONCILIATION_REQUIRED";
}

export function reconcileAuditState(options = {}) {
  return withCorrectionLock(() => reconcileLocked(options.client || prisma));
}

async function reconcileLocked(client) {
  const { records } = await inspectAuditChain();
  const states = operationStates(records);
  let recovered = 0;

  for (const [operationId, state] of states) {
    if (!state.prepared) continue;
    if (state.latest?.phase === "RECONCILIATION_REQUIRED") {
      throw new AppError(
        503,
        "AUDIT_RECONCILIATION_REQUIRED",
        "存在无法自动确认的历史更正，写入功能已关闭"
      );
    }
    if (TERMINAL_PHASES.has(state.latest?.phase)) continue;

    const prepared = state.prepared;
    classifyAuditRecovery(prepared, null);
    const ticket = await client.ticket.findUnique({ where: { id: prepared.ticketId } });
    const currentFingerprint = ticket ? ticketFingerprint(ticket) : null;
    const recoveryPhase = classifyAuditRecovery(prepared, currentFingerprint);
    if (recoveryPhase === "RECOVERED_COMMITTED") {
      await appendAudit({
        operationId,
        requestId: prepared.requestId,
        operator: prepared.operator,
        ticketId: prepared.ticketId,
        ticketNo: prepared.ticketNo,
        phase: recoveryPhase,
        fingerprint: currentFingerprint
      });
      recovered += 1;
      continue;
    }
    if (recoveryPhase === "RECOVERED_NOT_COMMITTED") {
      await appendAudit({
        operationId,
        requestId: prepared.requestId,
        operator: prepared.operator,
        ticketId: prepared.ticketId,
        ticketNo: prepared.ticketNo,
        phase: recoveryPhase,
        fingerprint: currentFingerprint
      });
      recovered += 1;
      continue;
    }

    await appendAudit({
      operationId,
      requestId: prepared.requestId,
      operator: prepared.operator,
      ticketId: prepared.ticketId,
      ticketNo: prepared.ticketNo,
      phase: "RECONCILIATION_REQUIRED",
      currentFingerprint
    });
    throw new AppError(
      503,
      "AUDIT_RECONCILIATION_REQUIRED",
      "存在无法自动确认的历史更正，写入功能已关闭"
    );
  }

  return { ready: true, recovered };
}
