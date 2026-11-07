import { Prisma, PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { PersonnelBackfillError, planPersonnelBackfill, productionBackfillOptions, type BackfillPlan, type BackfillSnapshot, type RelationKind } from "./personnel-backfill-plan";

type Db = Prisma.TransactionClient;

async function snapshot(db: Db): Promise<BackfillSnapshot> {
  const [users, identities, tickets, categoryCc, ticketCc, notices] = await Promise.all([
    db.user.findMany({ select: { id: true, dingtalkUserId: true, status: true, employmentStatus: true, manuallyDisabled: true, mergedIntoId: true } }),
    db.userIdentity.findMany({ select: { userId: true, corpId: true, externalUserId: true } }),
    db.ticket.findMany({ select: { id: true, applicantUserId: true, applicantId: true, handlerUserId: true, handlerId: true } }),
    db.categoryCcRecipient.findMany({ select: { id: true, userId: true, personId: true } }),
    db.ticketCcRecipient.findMany({ select: { id: true, userId: true, personId: true } }),
    db.notification.findMany({ select: { id: true, receiverUserId: true, receiverPersonId: true } })
  ]);
  return { users, identities, relations: [
    ...tickets.flatMap(row => [
      { kind: "applicants" as const, id: row.id, externalId: row.applicantUserId, personId: row.applicantId },
      { kind: "handlers" as const, id: row.id, externalId: row.handlerUserId, personId: row.handlerId }
    ]),
    ...categoryCc.map(row => ({ kind: "categoryCc" as const, id: row.id, externalId: row.userId, personId: row.personId })),
    ...ticketCc.map(row => ({ kind: "ticketCc" as const, id: row.id, externalId: row.userId, personId: row.personId })),
    ...notices.map(row => ({ kind: "notices" as const, id: row.id, externalId: row.receiverUserId, personId: row.receiverPersonId }))
  ] };
}

const columns: Record<RelationKind, { table: string; column: string }> = {
  applicants: { table: "`Ticket`", column: "`applicantId`" },
  handlers: { table: "`Ticket`", column: "`handlerId`" },
  categoryCc: { table: "`CategoryCcRecipient`", column: "`personId`" },
  ticketCc: { table: "`TicketCcRecipient`", column: "`personId`" },
  notices: { table: "`Notification`", column: "`receiverPersonId`" }
};

async function applyPlan(db: Db, plan: BackfillPlan) {
  const groups = new Map<string, { kind: RelationKind; personId: string; ids: string[] }>();
  for (const row of plan.relations) {
    const key = `${row.kind}:${row.personId}`;
    const group = groups.get(key) || { kind: row.kind, personId: row.personId, ids: [] };
    group.ids.push(row.id); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const target = columns[group.kind];
    for (let offset = 0; offset < group.ids.length; offset += 500) {
      const ids = group.ids.slice(offset, offset + 500);
      // Identifiers are fixed constants; all values are bound. Raw UPDATE preserves business updatedAt timestamps.
      const count = await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(target.table)} SET ${Prisma.raw(target.column)} = ${group.personId} WHERE id IN (${Prisma.join(ids)}) AND ${Prisma.raw(target.column)} IS NULL`);
      if (count !== ids.length) throw new PersonnelBackfillError("迁移期间人员关联发生变化，事务已中止");
    }
  }
  for (let offset = 0; offset < plan.manuallyDisabledIds.length; offset += 500) {
    const ids = plan.manuallyDisabledIds.slice(offset, offset + 500);
    const count = await db.$executeRaw(Prisma.sql`UPDATE User SET manuallyDisabled = true WHERE id IN (${Prisma.join(ids)}) AND status = 'DISABLED' AND employmentStatus = 'ACTIVE' AND manuallyDisabled = false`);
    if (count !== ids.length) throw new PersonnelBackfillError("迁移期间人员状态发生变化，事务已中止");
  }
  for (let offset = 0; offset < plan.identities.length; offset += 500) {
    await db.userIdentity.createMany({ data: plan.identities.slice(offset, offset + 500) });
  }
}

export async function runPersonnelProductionBackfill(db: Pick<PrismaClient, "$transaction">, options: { apply: boolean; corpId: string }) {
  return db.$transaction(async tx => {
    const plan = planPersonnelBackfill(await snapshot(tx), options.corpId);
    if (!options.apply) return { mode: "preview", ...plan.counts };
    await applyPlan(tx, plan);
    const remaining = planPersonnelBackfill(await snapshot(tx), options.corpId);
    if (remaining.relations.length || remaining.identities.length || remaining.manuallyDisabledIds.length) throw new PersonnelBackfillError("回填后校验未通过，事务已中止");
    return { mode: "applied", ...plan.counts, remainingApplicants: remaining.counts.unresolvedApplicants, remainingHandlers: remaining.counts.unresolvedHandlers };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
}

async function main() {
  // Validate every explicit guard before constructing a client or making a database connection.
  const options = productionBackfillOptions(process.argv.slice(2), process.env);
  const db = new PrismaClient({ log: [] });
  try { console.info(JSON.stringify(await runPersonnelProductionBackfill(db, options))); }
  finally { await db.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof PersonnelBackfillError ? error.message : "生产人员回填失败；请检查数据库连接、结构及权限，未输出敏感详情");
    process.exitCode = 1;
  });
}
