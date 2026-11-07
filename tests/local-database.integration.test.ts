import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Explicit opt-in only. Never fall back to .env or another database.
test("isolated MySQL service integration", { skip: process.env.RUN_LOCAL_DB_TESTS !== "1" }, async (t) => {
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "33427");
  assert.equal(url.pathname, "/itdesk_local");
  const [{ PrismaClient }, { TicketService }, { DashboardService }, { NotificationService }] = await Promise.all([
    import("@prisma/client"), import("../src/server/services/ticketService"), import("../src/server/services/dashboardService"), import("../src/server/services/notificationService")
  ]);
  const prisma = new PrismaClient();
  const prefix = `regression-${randomUUID().slice(0, 8)}`;
  const sent: unknown[][] = [];
  const notifier = { sendTicketEvent: async (ticket: unknown, targets: { target: unknown; notificationType: string; content: string }[]) => { for (const entry of targets) sent.push([ticket, entry.target, entry.notificationType, entry.content]); return targets.map(() => ({ sendStatus: "SUCCESS", delivery: "sent" })); } };
  const service = new TicketService(prisma, notifier as never);
  const makeUser = (suffix: string, role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN") => prisma.user.create({ data: { dingtalkUserId: `${prefix}-${suffix}`, name: `Test ${suffix}`, roleAssignments: { create: { role } } }, include: { roleAssignments: true } });
  try {
    const [applicant, handler, admin] = await Promise.all([makeUser("applicant", "EMPLOYEE"), makeUser("handler", "IT_HANDLER"), makeUser("admin", "SUPER_ADMIN")]);
    const category = await prisma.ticketCategory.create({ data: { name: prefix, defaultHandlerUserId: handler.dingtalkUserId, defaultHandlerName: handler.name, firstResponseMinutes: 60, resolveMinutes: 120 } });
    const makeTicket = (suffix: string) => prisma.ticket.create({ data: {
      ticketNo: `${prefix}-${suffix}`, title: `${prefix} ${suffix}`, categoryName: category.name, status: "PROCESSING", description: "Integration test only",
      applicantUserId: applicant.dingtalkUserId, applicantName: applicant.name, handlerUserId: handler.dingtalkUserId, handlerName: handler.name,
      createdAt: new Date(Date.now() - 7_200_000), slaFirstResponseDeadline: new Date(Date.now() - 3_600_000), slaResolveDeadline: new Date(Date.now() - 1_800_000)
    } });
    await t.test("row concurrency permits one completion and records late SLA", async () => {
      const ticket = await makeTicket("concurrency");
      const beforeSent = sent.length;
      const result = await Promise.allSettled([service.resolve(ticket.id, handler, "A"), service.resolve(ticket.id, handler, "B")]);
      assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(after.status, "COMPLETED");
      assert.equal(after.isFirstResponseOverdue, true);
      assert.equal(after.isResolveOverdue, true);
      assert.equal(await prisma.ticketLog.count({ where: { ticketId: ticket.id, actionType: "RESOLVE" } }), 1);
      assert.equal(sent.length - beforeSent, 1);
    });
    await t.test("database log constraint failure rolls back completion", async () => {
      const ticket = await makeTicket("rollback");
      const beforeSent = sent.length;
      await assert.rejects(service.resolve(ticket.id, { ...handler, name: "X".repeat(10_000) }, "Repaired"));
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(after.status, "PROCESSING");
      assert.equal(after.resolvedAt, null);
      assert.equal(after.updatedAt.getTime(), ticket.updatedAt.getTime());
      assert.equal(await prisma.ticketLog.count({ where: { ticketId: ticket.id } }), 0);
      assert.equal(sent.length, beforeSent);
    });
    await t.test("concurrent ticket creation retries real unique constraints", async () => {
      const results = await Promise.all(Array.from({ length: 4 }, (_, index) => service.createTicket({ title: `${prefix} create ${index}`, description: "Integration only", priority: "NORMAL", categoryId: category.id }, applicant)));
      assert.equal(new Set(results.map((result) => result.ticket.ticketNo)).size, 4);
      for (const result of results) assert.equal(await prisma.ticketLog.count({ where: { ticketId: result.ticket.id, actionType: "CREATE" } }), 1);
    });
    await t.test("dashboard aggregates every row, including older rows beyond five hundred", async () => {
      await prisma.ticket.createMany({ data: Array.from({ length: 501 }, (_, index) => ({
        ticketNo: `${prefix}-stats-${index}`, title: `${prefix} stats ${index}`, description: "Integration only", categoryName: category.name,
        applicantUserId: applicant.dingtalkUserId, applicantName: applicant.name, handlerUserId: handler.dingtalkUserId, handlerName: handler.name,
        createdAt: new Date("2025-01-01T00:00:00Z"), firstResponseAt: new Date("2025-01-01T00:05:00Z"), resolvedAt: new Date("2025-01-01T01:00:00Z"),
        status: "COMPLETED" as const, satisfactionLevel: "SATISFIED" as const, isResolveOverdue: index % 2 === 0
      })) });
      const result = await new DashboardService(prisma, service).dashboard(admin);
      const rows = await prisma.ticket.findMany({ select: { isResolveOverdue: true, satisfactionLevel: true, createdAt: true, resolvedAt: true } });
      assert.ok(rows.length > 500);
      assert.equal(result.cards.total, rows.length);
      assert.equal(result.cards.satisfaction.satisfied, rows.filter((row) => row.satisfactionLevel === "SATISFIED").length);
      assert.equal(result.cards.resolveOverdueRate, Math.round(rows.filter((row) => row.isResolveOverdue).length / rows.length * 100));
      const minutes = rows.filter((row) => row.resolvedAt).map((row) => Math.round((row.resolvedAt!.getTime() - row.createdAt.getTime()) / 60_000));
      assert.equal(result.cards.averageResolveMinutes, Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length));
      assert.equal(result.cards.pending + result.cards.assigned + result.cards.processing + result.cards.returned + result.cards.completed + result.cards.rejected + result.cards.cancelled, result.cards.total);
    });
    await t.test("persisted reminder key deduplicates real concurrent database inserts", async () => {
      const ticket = await makeTicket("notification");
      let deliveries = 0;
      const client = { sendWorkNotification: async () => { deliveries++; } };
      const first = new NotificationService(prisma, client as never);
      const second = new NotificationService(prisma, client as never);
      const options = { deduplicationKey: `${prefix}-notification` };
      await Promise.all([
        first.sendTicketNotification(ticket, handler, "TICKET_RESOLVE_DUE_SOON", "Integration reminder only", options),
        second.sendTicketNotification(ticket, handler, "TICKET_RESOLVE_DUE_SOON", "Integration reminder only", options)
      ]);
      assert.equal(deliveries, 1);
      assert.equal(await prisma.notification.count({ where: { ticketId: ticket.id, sendStatus: "SUCCESS" } }), 1);
    });
  } finally {
    const tickets = await prisma.ticket.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { ticketId: { in: tickets.map((row) => row.id) } } });
    await prisma.knowledgeBase.deleteMany({ where: { maintainerUserId: { startsWith: prefix } } });
    await prisma.ticket.deleteMany({ where: { title: { startsWith: prefix } } });
    await prisma.ticketCategory.deleteMany({ where: { name: prefix } });
    await prisma.user.deleteMany({ where: { dingtalkUserId: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
});
