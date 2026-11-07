import { PrismaClient } from "@prisma/client";

// 本轮只允许本机隔离数据库；以后生产迁移须独立审核，不复用本地凭据。
async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  if (process.env.ITDESK_LOCAL_ISOLATED !== "1" || url.hostname !== "127.0.0.1" || url.port !== "33427" || url.pathname !== "/itdesk_local") throw new Error("仅允许隔离本地库 itdesk_local");
  const db = new PrismaClient();
  try {
    if (!process.argv.includes("--apply")) {
      console.log(JSON.stringify({ mode: "preview", users: await db.user.count(), tickets: await db.ticket.count() }));
      return;
    }
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE User SET manuallyDisabled = true WHERE status = 'DISABLED' AND employmentStatus = 'ACTIVE'`;
      const applicants = await tx.$executeRaw`UPDATE Ticket t JOIN User u ON u.dingtalkUserId = t.applicantUserId SET t.applicantId = u.id WHERE t.applicantId IS NULL`;
      const handlers = await tx.$executeRaw`UPDATE Ticket t JOIN User u ON u.dingtalkUserId = t.handlerUserId SET t.handlerId = u.id WHERE t.handlerId IS NULL`;
      const categoryCc = await tx.$executeRaw`UPDATE CategoryCcRecipient c JOIN User u ON u.dingtalkUserId = c.userId SET c.personId = u.id WHERE c.personId IS NULL`;
      const ticketCc = await tx.$executeRaw`UPDATE TicketCcRecipient c JOIN User u ON u.dingtalkUserId = c.userId SET c.personId = u.id WHERE c.personId IS NULL`;
      const notices = await tx.$executeRaw`UPDATE Notification n JOIN User u ON u.dingtalkUserId = n.receiverUserId SET n.receiverPersonId = u.id WHERE n.receiverPersonId IS NULL`;
      const users = await tx.user.findMany({ where: { mergedIntoId: null } });
      for (const user of users) await tx.userIdentity.upsert({
        where: { corpId_externalUserId: { corpId: "local-corp", externalUserId: user.dingtalkUserId } },
        create: { corpId: "local-corp", externalUserId: user.dingtalkUserId, userId: user.id, active: user.employmentStatus === "ACTIVE" }, update: {}
      });
      const unresolved = await tx.ticket.count({ where: { applicantId: null } });
      if (unresolved) throw new Error(`仍有 ${unresolved} 条工单无法关联人员，已回滚数据回填`);
      return { applicants, handlers, categoryCc, ticketCc, notices, identities: users.length, unresolved };
    }, { timeout: 120_000 });
    console.log(JSON.stringify({ mode: "applied-local-only", ...result }));
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "人员回填失败"); process.exitCode = 1; });
