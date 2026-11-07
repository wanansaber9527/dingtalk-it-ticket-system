import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { TicketService } from "./ticketService";
import { businessDate } from "./serviceHelpers";

type AggregateRow = Record<string, number | bigint | Prisma.Decimal | null>;
type HandlerAverage = { handlerUserId: string | null; handlerName: string | null; averageMinutes: number | Prisma.Decimal | null };
const number = (value: AggregateRow[string]) => value === null || value === undefined ? 0 : Number(value);

export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly ticketService = new TicketService(prisma)
  ) {}

  async dashboard(user: UserWithRoles) {
    requireRole(user, ["SUPER_ADMIN"]);
    await this.ticketService.refreshOverdueFlags();
    const { start: today, stamp } = businessDate();
    const weekday = new Date(today.getTime() + 8 * 3_600_000).getUTCDay() || 7;
    const week = new Date(today.getTime() - (weekday - 1) * 86_400_000);
    const month = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-01T00:00:00+08:00`);

    // 同一事务快照中的全量聚合，不截断样本，也不把工单正文拉入内存。
    return this.prisma.$transaction(async (tx) => {
      const [rows, categoryRanking, departmentRanking, handlerRanking, handlerAverages] = await Promise.all([
        tx.$queryRaw<AggregateRow[]>(Prisma.sql`
          SELECT COUNT(*) AS total,
            SUM(createdAt >= ${today}) AS todayNew,
            SUM(createdAt >= ${week}) AS weekNew,
            SUM(createdAt >= ${month}) AS monthNew,
            SUM(status = 'PENDING') AS pending,
            SUM(status = 'ASSIGNED') AS assigned,
            SUM(status = 'PROCESSING') AS processing,
            SUM(status = 'RETURNED') AS returned,
            SUM(status IN ('COMPLETED', 'CLOSED')) AS completed,
            SUM(status = 'REJECTED') AS rejected,
            SUM(status = 'CANCELLED') AS cancelled,
            SUM(isFirstResponseOverdue OR isResolveOverdue) AS overdue,
            SUM(isFirstResponseOverdue) AS firstResponseOverdue,
            SUM(isResolveOverdue) AS resolveOverdue,
            AVG(ROUND(TIMESTAMPDIFF(MICROSECOND, createdAt, firstResponseAt) / 60000000)) AS averageFirstResponseMinutes,
            AVG(ROUND(TIMESTAMPDIFF(MICROSECOND, createdAt, resolvedAt) / 60000000)) AS averageResolveMinutes,
            SUM(satisfactionLevel = 'SATISFIED') AS satisfied,
            SUM(satisfactionLevel = 'NORMAL') AS normal,
            SUM(satisfactionLevel = 'UNSATISFIED') AS unsatisfied
          FROM Ticket
        `),
        tx.ticket.groupBy({ by: ["categoryName"], _count: { _all: true }, orderBy: { _count: { categoryName: "desc" } }, take: 8 }),
        tx.ticket.groupBy({ by: ["applicantDepartment"], _count: { _all: true }, orderBy: { _count: { applicantDepartment: "desc" } }, take: 8 }),
        tx.ticket.groupBy({ by: ["handlerUserId", "handlerName"], where: { handlerName: { not: null } }, _count: { _all: true }, orderBy: { _count: { handlerName: "desc" } }, take: 8 }),
        tx.$queryRaw<HandlerAverage[]>(Prisma.sql`
          SELECT handlerUserId, handlerName,
            AVG(ROUND(TIMESTAMPDIFF(MICROSECOND, createdAt, resolvedAt) / 60000000)) AS averageMinutes
          FROM Ticket WHERE handlerName IS NOT NULL AND resolvedAt IS NOT NULL
          GROUP BY handlerUserId, handlerName ORDER BY averageMinutes ASC
        `)
      ]);
      const row = rows[0] || {};
      const total = number(row.total);
      return {
        cards: {
          todayNew: number(row.todayNew), weekNew: number(row.weekNew), monthNew: number(row.monthNew), total,
          pending: number(row.pending), assigned: number(row.assigned), processing: number(row.processing),
          returned: number(row.returned), completed: number(row.completed), rejected: number(row.rejected), cancelled: number(row.cancelled),
          overdue: number(row.overdue),
          firstResponseOverdueRate: total ? Math.round(number(row.firstResponseOverdue) / total * 100) : 0,
          resolveOverdueRate: total ? Math.round(number(row.resolveOverdue) / total * 100) : 0,
          averageFirstResponseMinutes: Math.round(number(row.averageFirstResponseMinutes)),
          averageResolveMinutes: Math.round(number(row.averageResolveMinutes)),
          satisfaction: { satisfied: number(row.satisfied), normal: number(row.normal), unsatisfied: number(row.unsatisfied) }
        },
        rankings: {
          category: categoryRanking.map((item) => ({ name: item.categoryName, count: item._count._all })),
          department: departmentRanking.map((item) => ({ name: item.applicantDepartment || "未填写", count: item._count._all })),
          handler: handlerRanking.map((item) => ({ name: item.handlerName || "未分派", count: item._count._all })),
          handlerAverageResolve: handlerAverages.slice(0, 8).map((item) => ({ handlerName: item.handlerName || "未分派", averageMinutes: Math.round(number(item.averageMinutes)) })),
          handlerAverageResolveGroups: handlerAverages.length
        }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
