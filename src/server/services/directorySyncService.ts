import { randomUUID } from "node:crypto";
import type { DirectorySyncRun, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { DIRECTORY_SYNC_DEFAULT_INTERVAL, DIRECTORY_SYNC_MAX_INTERVAL, DIRECTORY_SYNC_MIN_INTERVAL, type DirectorySyncResult } from "@/src/lib/directorySync";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { requireSuperAdmin } from "@/src/server/permissions";
import { DingTalkClient, type DingTalkDeparture } from "@/src/server/dingtalk/DingTalkClient";
import { PersonnelIdentityService, personnelCorpId } from "@/src/server/services/personnelIdentityService";

const STATE_ID = "directory";
const LEASE_MS = 120_000;
const MAX_RUN_MS = 20 * 60_000;
const counts = () => ({ total: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, departedCount: 0, restoredCount: 0, pendingCount: 0, failedCount: 0 });

export function safeSyncError(error: unknown) {
  const raw = error instanceof Error ? error.message : "同步失败";
  return raw.replace(/https?:\/\/[^\s]+/gi, "[接口地址]").replace(/(access_token|token|secret|password|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[已隐藏]").slice(0, 500);
}

function runDto(run: DirectorySyncRun) {
  const { lockToken: _token, ...result } = run;
  void _token;
  return result;
}

function positiveInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new AppError(400, "INVALID_PAGINATION", "分页参数无效");
  return number;
}

function dateFilter(value: string | null, end: boolean) {
  if (!value) return undefined;
  if (value.length > 40) throw new AppError(400, "INVALID_DATE", "日期格式无效");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T${end ? "23:59:59.999" : "00:00:00"}+08:00` : value);
  if (!Number.isFinite(date.getTime())) throw new AppError(400, "INVALID_DATE", "日期格式无效");
  return date;
}

export class DirectorySyncService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly client = new DingTalkClient(),
    private readonly identities = new PersonnelIdentityService(prisma)
  ) {}

  private ensureState(now = new Date()) {
    return this.prisma.directorySyncState.upsert({
      where: { id: STATE_ID }, update: {},
      create: { id: STATE_ID, enabled: true, intervalMinutes: DIRECTORY_SYNC_DEFAULT_INTERVAL, nextRunAt: new Date(now.getTime() + DIRECTORY_SYNC_DEFAULT_INTERVAL * 60_000) }
    });
  }

  private async recoverExpiredRun(now: Date) {
    await this.prisma.$transaction(async (tx) => {
      const state = await tx.directorySyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
      if (!state.lockedBy || (state.lockedUntil && state.lockedUntil > now)) return;
      const released = await tx.directorySyncState.updateMany({ where: {
        id: STATE_ID, lockedBy: state.lockedBy, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }]
      }, data: { lockedBy: null, lockedUntil: null } });
      if (!released.count) return;
      await tx.directorySyncRun.updateMany({ where: { status: "RUNNING", lockToken: state.lockedBy }, data: {
        status: "FAILED", finishedAt: now, errorMessage: "上次同步进程中断或租约超时，已恢复调度；按已保存的下次执行时间运行"
      } });
    });
  }

  async settings(operator: UserWithRoles) {
    requireSuperAdmin(operator);
    const [state, lastRun] = await Promise.all([this.ensureState(), this.prisma.directorySyncRun.findFirst({ orderBy: { startedAt: "desc" } })]);
    return { enabled: state.enabled, intervalMinutes: state.intervalMinutes, nextRunAt: state.nextRunAt, lastSuccessAt: state.lastSuccessAt,
      running: Boolean(state.lockedBy && state.lockedUntil && state.lockedUntil > new Date()), lastRun: lastRun ? runDto(lastRun) : null };
  }

  async updateSettings(input: unknown, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    const value = input as { enabled?: unknown; intervalMinutes?: unknown } | null;
    if (!value || typeof value.enabled !== "boolean" || typeof value.intervalMinutes !== "number" || !Number.isInteger(value.intervalMinutes) || value.intervalMinutes < DIRECTORY_SYNC_MIN_INTERVAL || value.intervalMinutes > DIRECTORY_SYNC_MAX_INTERVAL) {
      throw new AppError(400, "INVALID_SYNC_SETTINGS", `同步间隔必须为 ${DIRECTORY_SYNC_MIN_INTERVAL}–${DIRECTORY_SYNC_MAX_INTERVAL} 分钟的整数`);
    }
    await this.ensureState();
    await this.prisma.directorySyncState.update({ where: { id: STATE_ID }, data: {
      enabled: value.enabled, intervalMinutes: value.intervalMinutes, nextRunAt: new Date(Date.now() + value.intervalMinutes * 60_000)
    } });
    return this.settings(operator);
  }

  async logs(params: URLSearchParams, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    const page = positiveInteger(params.get("page"), 1, 100000);
    const pageSize = positiveInteger(params.get("pageSize"), 20, 100);
    const status = params.get("status") || undefined;
    if (status && !["RUNNING", "SUCCESS", "PARTIAL", "FAILED"].includes(status)) throw new AppError(400, "INVALID_SYNC_STATUS", "同步状态无效");
    const keyword = (params.get("keyword") || "").trim();
    if (keyword.length > 191) throw new AppError(400, "INVALID_KEYWORD", "搜索词过长");
    const from = dateFilter(params.get("from"), false);
    const to = dateFilter(params.get("to"), true);
    if (from && to && from > to) throw new AppError(400, "INVALID_DATE", "开始日期不能晚于结束日期");
    const where: Prisma.DirectorySyncRunWhereInput = {
      ...(status ? { status } : {}), ...(from || to ? { startedAt: { gte: from, lte: to } } : {}),
      ...(keyword ? { items: { some: { OR: [{ name: { contains: keyword } }, { externalUserId: { contains: keyword } }, { errorMessage: { contains: keyword } }] } } } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.directorySyncRun.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.directorySyncRun.count({ where })
    ]);
    return { items: items.map(runDto), total, page, pageSize };
  }

  async logDetail(id: string, operator: UserWithRoles) {
    requireSuperAdmin(operator);
    const run = await this.prisma.directorySyncRun.findUnique({ where: { id }, include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    if (!run) throw new AppError(404, "SYNC_LOG_NOT_FOUND", "同步日志不存在");
    return { ...runDto(run), items: run.items.map((item) => {
      let changes: string[] = [];
      try { const value: unknown = JSON.parse(item.changesJson || "[]"); if (Array.isArray(value)) changes = value.filter((part): part is string => typeof part === "string"); } catch { /* Earlier records may lack a structured change summary. */ }
      return { ...item, changes };
    }) };
  }

  async run(options: { trigger: "MANUAL"; operator: UserWithRoles } | { trigger: "AUTO" }): Promise<DirectorySyncResult | { skipped: true; reason: "RUNNING" | "NOT_DUE" | "DISABLED" }> {
    if (options.trigger === "MANUAL") requireSuperAdmin(options.operator);
    const startedAt = new Date();
    await this.ensureState(startedAt);
    await this.recoverExpiredRun(startedAt);
    const token = randomUUID();
    let scheduledAt = startedAt;
    const run = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.directorySyncState.updateMany({ where: {
        id: STATE_ID, OR: [{ lockedBy: null }, { lockedUntil: null }, { lockedUntil: { lte: startedAt } }],
        ...(options.trigger === "AUTO" ? { enabled: true, nextRunAt: { lte: startedAt } } : {})
      }, data: { lockedBy: token, lockedUntil: new Date(startedAt.getTime() + LEASE_MS) } });
      if (!claimed.count) return null;
      const lockedState = await tx.directorySyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
      scheduledAt = lockedState.nextRunAt;
      await tx.directorySyncRun.updateMany({ where: { status: "RUNNING" }, data: { status: "FAILED", finishedAt: startedAt, errorMessage: "上次同步进程中断或租约超时，本轮已恢复调度" } });
      return tx.directorySyncRun.create({ data: { trigger: options.trigger, status: "RUNNING", startedAt, lockToken: token, operatorId: options.trigger === "MANUAL" ? options.operator.id : null } });
    });
    if (!run) {
      const state = await this.prisma.directorySyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
      const reason = state.lockedBy && state.lockedUntil && state.lockedUntil > startedAt ? "RUNNING" : !state.enabled ? "DISABLED" : "NOT_DUE";
      if (options.trigger === "MANUAL") throw new AppError(409, "SYNC_ALREADY_RUNNING", "已有人员同步正在执行，请稍后查看结果");
      return { skipped: true, reason };
    }

    const result = counts();
    let leaseLost = false;
    let renewing = false;
    const renew = async () => {
      if (leaseLost || Date.now() - startedAt.getTime() > MAX_RUN_MS) throw new AppError(409, "SYNC_LEASE_LOST", "同步超过时限或任务租约已失效");
      const now = new Date();
      const updated = await this.prisma.directorySyncState.updateMany({ where: { id: STATE_ID, lockedBy: token, lockedUntil: { gt: now } }, data: { lockedUntil: new Date(now.getTime() + LEASE_MS) } });
      if (updated.count !== 1) { leaseLost = true; throw new AppError(409, "SYNC_LEASE_LOST", "同步任务租约已失效"); }
    };
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void renew().catch(() => { leaseLost = true; }).finally(() => { renewing = false; });
    }, 30_000);
    heartbeat.unref();
    let status = "SUCCESS";
    let errorMessage: string | null = null;
    const item = async (data: Omit<Prisma.DirectorySyncItemUncheckedCreateInput, "runId">) => {
      await renew();
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const fenced = await tx.directorySyncState.updateMany({ where: { id: STATE_ID, lockedBy: token, lockedUntil: { gt: now } }, data: { lockedUntil: new Date(now.getTime() + LEASE_MS) } });
        if (!fenced.count) throw new AppError(409, "SYNC_LEASE_LOST", "同步任务租约已失效");
        await tx.directorySyncItem.create({ data: { ...data, runId: run.id } });
        await tx.directorySyncRun.updateMany({ where: { id: run.id, lockToken: token, status: "RUNNING" }, data: result });
      });
    };
    try {
      const corpId = personnelCorpId();
      // Only retry the read phase. Mutations are individually idempotent, never replay a whole partially committed run.
      let people;
      try { people = await this.client.listUsers(); }
      catch (firstError) {
        if (!(firstError instanceof Error) || !["TimeoutError", "AbortError", "TypeError"].includes(firstError.name)) throw firstError;
        await renew();
        people = await this.client.listUsers();
      }
      if (!people.length) throw new AppError(502, "EMPTY_DIRECTORY", "本轮通讯录为空，已停止同步；请检查授权范围");
      const seen = new Set<string>();
      for (const person of people) {
        if (!person.dingtalkUserId?.trim() || !person.name?.trim() || seen.has(person.dingtalkUserId)) throw new AppError(502, "INCOMPLETE_DIRECTORY", "通讯录身份缺失或重复，已停止同步");
        seen.add(person.dingtalkUserId);
      }
      result.total = people.length;
      for (const person of people) {
        await renew();
        try {
          const changed = await this.identities.upsertDirectoryPerson(person, { source: "SYNC", corpId, syncLockToken: token, now: startedAt });
          const key = { CREATED: "createdCount", UPDATED: "updatedCount", UNCHANGED: "unchangedCount", RESTORED: "restoredCount" } as const;
          result[key[changed.action]]++;
          await item({ userId: changed.user.id, externalUserId: person.dingtalkUserId, name: person.name, action: changed.action, changesJson: JSON.stringify(changed.changes || []) });
        } catch (error) {
          if (error instanceof AppError && error.code === "SYNC_LEASE_LOST") throw error;
          const pending = error instanceof AppError && ["PERSONNEL_REHIRE_REVIEW_REQUIRED", "PERSONNEL_IDENTITY_CONFLICT", "STALE_DIRECTORY_OBSERVATION"].includes(error.code);
          if (pending) result.pendingCount++; else result.failedCount++;
          await item({ externalUserId: person.dingtalkUserId, name: person.name, action: pending ? "PENDING" : "FAILED", errorMessage: safeSyncError(error) });
        }
      }

      // Re-read after additions/rehire: the former external ID of a restored person must not be mistaken for a departure.
      const missing = await this.prisma.user.findMany({ where: { employmentStatus: "ACTIVE", dingtalkUserId: { notIn: [...seen] } } });
      if (missing.length) {
        let departures: DingTalkDeparture[] = [];
        let departureError: string | null = null;
        try { departures = await this.client.listDepartures(new Date(startedAt.getTime() - 30 * 86400000), startedAt); }
        catch (error) { departureError = safeSyncError(error); }
        for (const person of missing) {
          await renew();
          const lastConfirmed = person.lastSyncedAt || person.createdAt;
          const evidence = departures.filter((entry) => entry.externalUserId === person.dingtalkUserId && entry.occurredAt > lastConfirmed && entry.occurredAt <= startedAt).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
          if (!evidence) {
            result.pendingCount++;
            await item({ userId: person.id, externalUserId: person.dingtalkUserId, name: person.name, action: "PENDING", errorMessage: departureError || "本轮目录中未找到，最近 30 天内无晚于最后在职确认的离职记录；请核实授权范围或由管理员确认离职" });
            continue;
          }
          try {
            await this.identities.archiveUser(person.id, { source: "DINGTALK_DEPARTURE", reason: evidence.reason, externalUserId: evidence.externalUserId, occurredAt: evidence.occurredAt, syncLockToken: token });
            result.departedCount++;
            await item({ userId: person.id, externalUserId: person.dingtalkUserId, name: person.name, action: "DEPARTED", changesJson: JSON.stringify(["离职归档", "登录会话作废", "工单保留"]) });
          } catch (error) {
            if (error instanceof AppError && error.code === "SYNC_LEASE_LOST") throw error;
            result.failedCount++;
            await item({ userId: person.id, externalUserId: person.dingtalkUserId, name: person.name, action: "FAILED", errorMessage: safeSyncError(error) });
          }
        }
      }
      if (result.failedCount || result.pendingCount) status = "PARTIAL";
    } catch (error) {
      status = "FAILED";
      errorMessage = safeSyncError(error);
      result.failedCount++;
    } finally {
      clearInterval(heartbeat);
    }
    const finishedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Acquire the state row before reading the schedule: an administrator may change the interval during a run.
      const fenced = await tx.directorySyncState.updateMany({ where: { id: STATE_ID, lockedBy: token, lockedUntil: { gt: finishedAt } }, data: { lockedUntil: new Date(finishedAt.getTime() + LEASE_MS) } });
      if (!fenced.count) throw new AppError(409, "SYNC_LEASE_LOST", "任务租约已失效，运行结果将由下一轮恢复检查确认");
      const state = await tx.directorySyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
      const released = await tx.directorySyncState.updateMany({ where: { id: STATE_ID, lockedBy: token, lockedUntil: { gt: finishedAt } }, data: {
        lockedBy: null, lockedUntil: null,
        ...(state.nextRunAt.getTime() === scheduledAt.getTime() ? { nextRunAt: new Date(finishedAt.getTime() + state.intervalMinutes * 60_000) } : {}),
        ...(status === "SUCCESS" ? { lastSuccessAt: finishedAt } : {})
      } });
      if (!released.count) throw new AppError(409, "SYNC_LEASE_LOST", "任务租约已失效，运行结果将由下一轮恢复检查确认");
      await tx.directorySyncRun.updateMany({ where: { id: run.id, lockToken: token, status: "RUNNING" }, data: { ...result, status, finishedAt, errorMessage } });
    });
    return { runId: run.id, ...result, status };
  }
}
