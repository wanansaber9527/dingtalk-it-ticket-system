// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { PrismaClient, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/server/permissions";
import { TicketService } from "./ticketService";

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date = new Date()) {
  const day = date.getDay() || 7;
  const start = startOfDay(date);
  start.setDate(start.getDate() - day + 1);
  return start;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function minutesBetween(start?: Date | null, end?: Date | null) {
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function avg(values: Array<number | null>) {
  const valid = values.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, item) => sum + item, 0) / valid.length);
}

export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly ticketService = new TicketService(prisma)
  ) {}

  async dashboard(user: User) {
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    await this.ticketService.refreshOverdueFlags();
    // 中文注释：后台看板只面向管理员，统计全量数据。
    const now = new Date();
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const month = startOfMonth(now);
    const scope = {};

    const [
      todayNew,
      weekNew,
      monthNew,
      pending,
      processing,
      completed,
      overdue,
      tickets,
      categoryRanking,
      departmentRanking,
      handlerRanking
    ] = await Promise.all([
      this.prisma.ticket.count({ where: { ...scope, createdAt: { gte: today } } }),
      this.prisma.ticket.count({ where: { ...scope, createdAt: { gte: week } } }),
      this.prisma.ticket.count({ where: { ...scope, createdAt: { gte: month } } }),
      this.prisma.ticket.count({ where: { ...scope, status: "PENDING" } }),
      this.prisma.ticket.count({ where: { ...scope, status: "PROCESSING" } }),
      this.prisma.ticket.count({ where: { ...scope, status: { in: ["COMPLETED", "CLOSED"] } } }),
      this.prisma.ticket.count({
        where: { ...scope, OR: [{ isFirstResponseOverdue: true }, { isResolveOverdue: true }] }
      }),
      this.prisma.ticket.findMany({ where: scope, take: 500, orderBy: { createdAt: "desc" } }),
      this.prisma.ticket.groupBy({
        by: ["categoryName"],
        where: scope,
        _count: { _all: true },
        orderBy: { _count: { categoryName: "desc" } },
        take: 8
      }),
      this.prisma.ticket.groupBy({
        by: ["applicantDepartment"],
        where: scope,
        _count: { _all: true },
        orderBy: { _count: { applicantDepartment: "desc" } },
        take: 8
      }),
      this.prisma.ticket.groupBy({
        by: ["handlerName"],
        where: { ...scope, handlerName: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { handlerName: "desc" } },
        take: 8
      })
    ]);

    const firstResponseOverdueCount = tickets.filter((ticket) => ticket.isFirstResponseOverdue).length;
    const resolveOverdueCount = tickets.filter((ticket) => ticket.isResolveOverdue).length;
    const satisfaction = {
      satisfied: tickets.filter((ticket) => ticket.satisfactionLevel === "SATISFIED").length,
      normal: tickets.filter((ticket) => ticket.satisfactionLevel === "NORMAL").length,
      unsatisfied: tickets.filter((ticket) => ticket.satisfactionLevel === "UNSATISFIED").length
    };

    const handlerAverageResolve = Object.values(
      tickets.reduce<Record<string, number[]>>((acc, ticket) => {
        if (!ticket.handlerName || !ticket.resolvedAt) return acc;
        const value = minutesBetween(ticket.createdAt, ticket.resolvedAt);
        if (value === null) return acc;
        acc[ticket.handlerName] ||= [];
        acc[ticket.handlerName].push(value);
        return acc;
      }, {})
    );

    const handlerAverageResolveRanking = Object.entries(
      tickets.reduce<Record<string, number[]>>((acc, ticket) => {
        if (!ticket.handlerName || !ticket.resolvedAt) return acc;
        const value = minutesBetween(ticket.createdAt, ticket.resolvedAt);
        if (value === null) return acc;
        acc[ticket.handlerName] ||= [];
        acc[ticket.handlerName].push(value);
        return acc;
      }, {})
    )
      .map(([handlerName, values]) => ({ handlerName, averageMinutes: avg(values) }))
      .sort((a, b) => a.averageMinutes - b.averageMinutes)
      .slice(0, 8);

    return {
      cards: {
        todayNew,
        weekNew,
        monthNew,
        pending,
        processing,
        completed,
        overdue,
        firstResponseOverdueRate: tickets.length ? Math.round((firstResponseOverdueCount / tickets.length) * 100) : 0,
        resolveOverdueRate: tickets.length ? Math.round((resolveOverdueCount / tickets.length) * 100) : 0,
        averageFirstResponseMinutes: avg(tickets.map((ticket) => minutesBetween(ticket.createdAt, ticket.firstResponseAt))),
        averageResolveMinutes: avg(tickets.map((ticket) => minutesBetween(ticket.createdAt, ticket.resolvedAt))),
        satisfaction
      },
      rankings: {
        category: categoryRanking.map((item) => ({ name: item.categoryName, count: item._count._all })),
        department: departmentRanking.map((item) => ({
          name: item.applicantDepartment || "未填写",
          count: item._count._all
        })),
        handler: handlerRanking.map((item) => ({ name: item.handlerName || "未分派", count: item._count._all })),
        handlerAverageResolve: handlerAverageResolveRanking,
        handlerAverageResolveGroups: handlerAverageResolve.length
      }
    };
  }
}
