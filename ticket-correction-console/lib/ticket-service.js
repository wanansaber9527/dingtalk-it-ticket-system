import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { AppError } from "./http.js";
import { appendAudit, appendAuditFailure } from "./audit.js";
import { reconcileAuditState } from "./audit-recovery.js";
import { assertSilentWriteContract } from "./database-contract.js";
import { withCorrectionLock } from "./correction-lock.js";
import {
  prepareTicketCorrection,
  ticketFingerprint
} from "./ticket-domain.js";

const DATE_FIELDS = [
  "expectedResolveTime",
  "firstResponseAt",
  "resolvedAt",
  "closedAt",
  "slaFirstResponseDeadline",
  "slaResolveDeadline",
  "createdAt",
  "updatedAt"
];

export function serializeTicket(ticket) {
  const serialized = { ...ticket };
  for (const field of DATE_FIELDS) {
    serialized[field] = ticket[field] ? ticket[field].toISOString() : null;
  }
  serialized.fingerprint = ticketFingerprint(ticket);
  return serialized;
}

export async function searchTickets(query) {
  const keyword = String(query || "").trim().slice(0, 100);
  const tickets = await prisma.ticket.findMany({
    where: keyword
      ? {
          OR: [
            { ticketNo: { contains: keyword } },
            { title: { contains: keyword } },
            { applicantName: { contains: keyword } },
            { handlerName: { contains: keyword } }
          ]
        }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: 50
  });
  return tickets.map(serializeTicket);
}

export async function getTicket(id) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "工单不存在");
  return serializeTicket(ticket);
}

function isDeadlock(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function updateWithLock(
  id,
  expectedUpdatedAt,
  expectedFingerprint,
  updateData,
  plannedUpdatedAt
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Ticket WHERE id = ${id} FOR UPDATE`;
    const locked = await tx.ticket.findUnique({ where: { id } });
    if (!locked) throw new AppError(404, "TICKET_NOT_FOUND", "工单不存在");
    if (
      locked.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
      ticketFingerprint(locked) !== expectedFingerprint
    ) {
      throw new AppError(409, "TICKET_CHANGED", "工单已被其他操作更新，请刷新后重新更正");
    }

    const result = await tx.ticket.updateMany({
      where: { id, updatedAt: expectedUpdatedAt },
      data: { ...updateData, updatedAt: plannedUpdatedAt }
    });
    if (result.count !== 1) {
      throw new AppError(409, "TICKET_CHANGED", "工单已被其他操作更新，请刷新后重新更正");
    }
    return tx.ticket.findUniqueOrThrow({ where: { id } });
  });
}

async function updateWithRetry(
  id,
  expectedUpdatedAt,
  expectedFingerprint,
  updateData,
  plannedUpdatedAt
) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await updateWithLock(
        id,
        expectedUpdatedAt,
        expectedFingerprint,
        updateData,
        plannedUpdatedAt
      );
    } catch (error) {
      lastError = error;
      if (!isDeadlock(error) || attempt === 1) throw error;
    }
  }
  throw lastError;
}

export function correctTicket(id, parsed, context) {
  return withCorrectionLock(() => correctTicketLocked(id, parsed, context));
}

async function correctTicketLocked(id, parsed, context) {
  await reconcileAuditState();
  const current = await prisma.ticket.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "TICKET_NOT_FOUND", "工单不存在");
  if (
    current.updatedAt.getTime() !== parsed.expectedUpdatedAt.getTime() ||
    ticketFingerprint(current) !== parsed.expectedFingerprint
  ) {
    throw new AppError(409, "TICKET_CHANGED", "工单已被其他操作更新，请刷新后重新更正");
  }

  const prepared = prepareTicketCorrection(current, parsed.fields, new Date());
  await assertSilentWriteContract(prepared.next.status);
  const plannedUpdatedAt = new Date();
  const plannedFingerprint = ticketFingerprint({
    ...prepared.next,
    updatedAt: plannedUpdatedAt
  });

  const operationId = crypto.randomUUID();
  const baseAudit = {
    operationId,
    requestId: context.requestId,
    operator: context.username,
    ticketId: current.id,
    ticketNo: current.ticketNo,
    reason: parsed.reason
  };
  await appendAudit({
    ...baseAudit,
    phase: "PREPARED",
    expectedUpdatedAt: current.updatedAt.toISOString(),
    expectedFingerprint: parsed.expectedFingerprint,
    plannedUpdatedAt: plannedUpdatedAt.toISOString(),
    plannedFingerprint,
    changes: prepared.changes
  });

  let updated;
  try {
    updated = await updateWithRetry(
      current.id,
      current.updatedAt,
      parsed.expectedFingerprint,
      prepared.updateData,
      plannedUpdatedAt
    );
  } catch (error) {
    await appendAuditFailure({
      ...baseAudit,
      phase: "FAILED",
      errorCode: error instanceof AppError ? error.code : "DATABASE_WRITE_FAILED"
    });
    throw error;
  }

  let auditPending = false;
  try {
    await appendAudit({
      ...baseAudit,
      phase: "COMMITTED",
      updatedAt: updated.updatedAt.toISOString(),
      fingerprint: ticketFingerprint(updated)
    });
  } catch (error) {
    auditPending = true;
    console.error(
      "Ticket correction committed but final audit marker is pending reconciliation",
      error
    );
  }

  return {
    ticket: serializeTicket(updated),
    changes: prepared.changes,
    auditPending
  };
}
