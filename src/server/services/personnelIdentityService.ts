import type { Prisma, PrismaClient, User } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { requireSuperAdmin } from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { DingTalkClient, type DingTalkSelectableUser } from "@/src/server/dingtalk/DingTalkClient";

const include = { roleAssignments: true } satisfies Prisma.UserInclude;
type DirectoryPerson = DingTalkSelectableUser & { unionId?: string };
type UpsertOptions = { source: "LOGIN" | "SYNC"; corpId?: string; now?: Date; syncLockToken?: string };
export type DirectoryPersonAction = "CREATED" | "UPDATED" | "UNCHANGED" | "RESTORED";
export type DepartureEvidence = {
  source: "DINGTALK_DEPARTURE" | "ADMIN_CONFIRMED";
  reason: string;
  externalUserId?: string;
  occurredAt?: Date;
  operatorId?: string;
  syncLockToken?: string;
};

export function personnelCorpId(value?: string) {
  const corpId = (value || process.env.DINGTALK_CORP_ID || "").trim();
  if (corpId) return corpId;
  if (process.env.NODE_ENV !== "production" && process.env.DINGTALK_MOCK_ENABLED === "true") return "local-corp";
  throw new AppError(500, "DINGTALK_CORP_ID_MISSING", "缺少钉钉企业标识，无法核验人员身份");
}

function validatePerson(person: DirectoryPerson) {
  const dingtalkUserId = person.dingtalkUserId?.trim();
  const name = person.name?.trim();
  if (!dingtalkUserId || dingtalkUserId.length > 191 || !name || name.length > 191) {
    throw new AppError(400, "INVALID_DIRECTORY_PERSON", "钉钉人员缺少有效身份或姓名");
  }
  const unionId = person.unionId?.trim() || undefined;
  if (unionId && unionId.length > 191) throw new AppError(400, "INVALID_DIRECTORY_PERSON", "钉钉人员身份标识无效");
  return { ...person, dingtalkUserId, name, unionId };
}

function profileData(person: DirectoryPerson) {
  // 缺失/空字段不覆盖已知资料：部门详情权限失败与资料删除不能混为一谈。
  const data: Prisma.UserUpdateInput = { name: person.name };
  for (const key of ["mobile", "departmentId", "departmentName", "position", "avatar"] as const) {
    const value = person[key]?.trim();
    if (value) data[key] = value;
  }
  return data;
}

function changedFields(existing: User | null, person: DirectoryPerson) {
  if (!existing) return ["name", "departmentId", "departmentName", "position", "avatar", "mobile"].filter((field) => Boolean(person[field as keyof DirectoryPerson]));
  return ["name", "mobile", "departmentId", "departmentName", "position", "avatar"].filter((field) => {
    const value = person[field as keyof DirectoryPerson]?.trim();
    return value && value !== existing[field as keyof User];
  });
}

function conflict(message = "人员身份存在冲突，请由管理员核实后关联档案"): never {
  throw new AppError(409, "PERSONNEL_IDENTITY_CONFLICT", message);
}

export class PersonnelIdentityService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma, private readonly dingtalkClient = new DingTalkClient()) {}

  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (attempt >= 3 || !["P2034", "P2002"].includes(code || "")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }

  private async requireSyncLease(tx: Prisma.TransactionClient, token?: string) {
    if (!token) return;
    const now = new Date();
    const lock = await tx.directorySyncState.updateMany({ where: { id: "directory", lockedBy: token, lockedUntil: { gt: now } }, data: { lockedUntil: new Date(now.getTime() + 120_000) } });
    if (lock.count !== 1) throw new AppError(409, "SYNC_LEASE_LOST", "同步任务锁已失效，已停止写入");
  }

  async upsertDirectoryPerson(raw: DirectoryPerson, options: UpsertOptions): Promise<{ user: UserWithRoles; action: DirectoryPersonAction; changes: string[] }> {
    const person = validatePerson(raw);
    const corpId = personnelCorpId(options.corpId);
    const now = options.now || new Date();
    return this.transaction(async (tx) => {
      await this.requireSyncLease(tx, options.syncLockToken);
      const binding = await tx.userIdentity.findUnique({ where: { corpId_externalUserId: { corpId, externalUserId: person.dingtalkUserId } }, include: { user: { include } } });
      if (binding?.unionId && person.unionId && binding.unionId !== person.unionId) conflict("钉钉账号标识与历史身份不一致，已阻止自动关联");
      const unionBindings = person.unionId ? await tx.userIdentity.findMany({ where: { corpId, unionId: person.unionId }, include: { user: { include } } }) : [];
      const unionUserIds = new Set(unionBindings.map((identity) => identity.userId));
      if (unionUserIds.size > 1) conflict();
      const unionUser = unionBindings[0]?.user || null;
      const legacy = await tx.user.findUnique({ where: { dingtalkUserId: person.dingtalkUserId }, include });
      if (binding && unionUser && binding.userId !== unionUser.id) conflict();
      if (legacy && !binding && !unionUser && await tx.userIdentity.findFirst({ where: { userId: legacy.id, corpId: { not: corpId } } })) conflict("当前企业与历史档案的企业范围不一致");
      let existing = binding?.user || unionUser || legacy;
      if (legacy && existing && legacy.id !== existing.id) conflict();
      if (existing?.mergedIntoId) conflict("该档案已合并，请使用已核验的当前钉钉账号登录");
      if (binding && !binding.active && existing?.employmentStatus === "ACTIVE" && existing.dingtalkUserId !== person.dingtalkUserId) {
        conflict("该钉钉身份已被替换，不能重新启用旧账号");
      }
      const externalChanged = Boolean(existing && existing.dingtalkUserId !== person.dingtalkUserId);
      if (externalChanged && existing?.employmentStatus !== "DEPARTED") conflict("已在职人员出现另一钉钉账号，请管理员核实");
      if (externalChanged && (!person.unionId || !unionUser)) conflict("无法核验返聘身份，请管理员关联离职档案");
      const restoring = existing?.employmentStatus === "DEPARTED";
      if (restoring && existing?.archivedAt && existing.archivedAt > now) throw new AppError(409, "STALE_DIRECTORY_OBSERVATION", "人员已在本次读取后离职，已阻止旧结果恢复账号");
      if (restoring && !(person.unionId && ((binding?.unionId === person.unionId) || unionUser?.id === existing?.id))) {
        throw new AppError(409, "PERSONNEL_REHIRE_REVIEW_REQUIRED", "离职档案缺少可靠身份标识，请管理员核验返聘");
      }
      if (externalChanged && existing) await this.moveAiOwnership(tx, existing.dingtalkUserId, person.dingtalkUserId, existing.id);
      const changes = changedFields(existing, person);
      const manuallyDisabled = existing ? existing.manuallyDisabled || (existing.employmentStatus !== "DEPARTED" && existing.status === "DISABLED") : false;
      if (!existing) {
        existing = await tx.user.create({ data: { dingtalkUserId: person.dingtalkUserId, name: person.name,
          mobile: person.mobile || null, departmentId: person.departmentId || null, departmentName: person.departmentName || null,
          position: person.position || null, avatar: person.avatar || null, lastSyncedAt: now,
          roleAssignments: { create: { role: "EMPLOYEE" } }
        }, include });
      } else {
        // 只在可信返聘时恢复在职状态；人工禁用始终独立保留。
        existing = await tx.user.update({ where: { id: existing.id }, data: {
          ...profileData(person), dingtalkUserId: person.dingtalkUserId, lastSyncedAt: now, manuallyDisabled,
          ...(restoring ? { employmentStatus: "ACTIVE", departedAt: null, archivedAt: null, status: manuallyDisabled ? "DISABLED" : "ACTIVE", sessionVersion: { increment: 1 } } : {})
        }, include });
        if (restoring) await tx.userRoleAssignment.deleteMany({ where: { userId: existing.id, role: { not: "EMPLOYEE" } } });
        await tx.userRoleAssignment.upsert({ where: { userId_role: { userId: existing.id, role: "EMPLOYEE" } }, create: { userId: existing.id, role: "EMPLOYEE" }, update: {} });
      }
      await tx.userIdentity.updateMany({ where: { userId: existing.id, active: true, NOT: { corpId, externalUserId: person.dingtalkUserId } }, data: { active: false } });
      await tx.userIdentity.upsert({ where: { corpId_externalUserId: { corpId, externalUserId: person.dingtalkUserId } },
        create: { userId: existing.id, corpId, externalUserId: person.dingtalkUserId, unionId: person.unionId, active: true },
        update: { active: true, ...(person.unionId ? { unionId: person.unionId } : {}) }
      });
      const created = !binding && !unionUser && !legacy;
      const action: DirectoryPersonAction = created ? "CREATED" : restoring ? "RESTORED" : changes.length ? "UPDATED" : "UNCHANGED";
      if (created || restoring || externalChanged) await tx.personnelIdentityAudit.create({ data: { action, userId: existing.id,
        reason: options.source === "LOGIN" ? "钉钉免登身份核验" : "钉钉通讯录同步", details: JSON.stringify({ corpId, externalUserId: person.dingtalkUserId, externalChanged }) } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: existing.id }, include });
      return { user, action, changes };
    });
  }

  async archiveUser(userId: string, evidence: DepartureEvidence, now = new Date()) {
    if (!["DINGTALK_DEPARTURE", "ADMIN_CONFIRMED"].includes(evidence.source) || !evidence.reason?.trim()) throw new AppError(400, "DEPARTURE_EVIDENCE_REQUIRED", "离职归档需要明确依据");
    return this.transaction(async (tx) => {
      await this.requireSyncLease(tx, evidence.syncLockToken);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include });
      if (user.mergedIntoId) conflict("已合并的档案不能再次归档");
      if (evidence.source === "ADMIN_CONFIRMED") {
        if (!evidence.operatorId) throw new AppError(403, "FORBIDDEN", "人工归档需要管理员身份");
        const admin = await tx.user.findUniqueOrThrow({ where: { id: evidence.operatorId }, include });
        requireSuperAdmin(admin);
        if (user.id === admin.id) throw new AppError(409, "CANNOT_ARCHIVE_SELF", "不能通过人工操作归档自己的账号");
        if (user.status === "ACTIVE" && user.roleAssignments.some((role) => role.role === "SUPER_ADMIN")) {
          const admins = await tx.user.count({ where: { status: "ACTIVE", employmentStatus: "ACTIVE", roleAssignments: { some: { role: "SUPER_ADMIN" } } } });
          if (admins <= 1) throw new AppError(409, "LAST_ADMIN_REQUIRED", "请先设置其他有效管理员，再归档此人员");
        }
      }
      if (evidence.externalUserId && evidence.externalUserId !== user.dingtalkUserId) conflict("离职记录属于旧钉钉身份，不能停用当前账号");
      if (user.employmentStatus === "DEPARTED") return user;
      if (evidence.occurredAt && user.lastSyncedAt && evidence.occurredAt < user.lastSyncedAt) {
        throw new AppError(409, "STALE_DEPARTURE_EVIDENCE", "离职记录早于最近一次在职核验，已跳过归档");
      }
      await tx.userIdentity.updateMany({ where: { userId }, data: { active: false } });
      await tx.userRoleAssignment.deleteMany({ where: { userId, role: { not: "EMPLOYEE" } } });
      await tx.ticketCategory.updateMany({ where: { defaultHandlerUserId: user.dingtalkUserId }, data: { defaultHandlerUserId: null, defaultHandlerName: null } });
      await tx.categoryCcRecipient.deleteMany({ where: { OR: [{ personId: userId }, { personId: null, userId: user.dingtalkUserId }] } });
      const archived = await tx.user.update({ where: { id: userId }, data: { employmentStatus: "DEPARTED", status: "DISABLED", departedAt: evidence.occurredAt || now, archivedAt: now,
        manuallyDisabled: user.manuallyDisabled || user.status === "DISABLED", sessionVersion: { increment: 1 } }, include });
      await tx.personnelIdentityAudit.create({ data: { action: "DEPARTED", userId, operatorId: evidence.operatorId,
        reason: evidence.reason.trim().slice(0, 2000), details: JSON.stringify({ source: evidence.source, externalUserId: evidence.externalUserId, occurredAt: evidence.occurredAt?.toISOString() }) } });
      return archived;
    });
  }

  private async moveAiOwnership(tx: Prisma.TransactionClient, from: string, to: string, personId: string) {
    if (from === to) return;
    await tx.aiConversation.updateMany({ where: { userId: from }, data: { userId: to } });
    const usage = await tx.aiDailyUsage.findMany({ where: { userId: { in: [from, to] } } });
    const totals = new Map<string, number>();
    for (const row of usage) totals.set(row.day, (totals.get(row.day) || 0) + row.count);
    // AI 服务以永久人员 ID + 日期记账；关联后合计两个账号的额度，不能重置或留下唯一键冲突。
    if (usage.length) await tx.aiDailyUsage.deleteMany({ where: { id: { in: usage.map((row) => row.id) } } });
    for (const [day, count] of totals) await tx.aiDailyUsage.create({ data: { id: `${personId}:${day}`, userId: to, day, count } });
  }

  async restoreArchivedUser(userId: string, operator: UserWithRoles, reason: string) {
    requireSuperAdmin(operator);
    if (!reason?.trim() || reason.trim().length > 2000) throw new AppError(400, "REHIRE_REASON_REQUIRED", "请填写返聘核验依据（最多 2000 字）");
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include });
    if (previous.employmentStatus !== "DEPARTED" || previous.mergedIntoId) conflict("只能恢复尚未合并的离职档案");
    const observedAt = new Date();
    const detail = await this.dingtalkClient.getUserDetail(previous.dingtalkUserId);
    if ((detail.userid || detail.userId) !== previous.dingtalkUserId) conflict("钉钉实时核验返回的账号不一致");
    const person = validatePerson({ dingtalkUserId: previous.dingtalkUserId, name: detail.name, unionId: detail.unionid || detail.unionId,
      mobile: detail.mobile, avatar: detail.avatar, position: detail.position || detail.title });
    const corpId = personnelCorpId();
    return this.transaction(async (tx) => {
      const admin = await tx.user.findUniqueOrThrow({ where: { id: operator.id }, include });
      requireSuperAdmin(admin);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include });
      if (user.employmentStatus !== "DEPARTED" || user.mergedIntoId || user.dingtalkUserId !== previous.dingtalkUserId || (user.archivedAt && user.archivedAt > observedAt)) conflict("人员状态已变化，请刷新后重新核验");
      const binding = await tx.userIdentity.findUnique({ where: { corpId_externalUserId: { corpId, externalUserId: person.dingtalkUserId } } });
      if (binding && binding.userId !== userId) conflict();
      if (!binding && await tx.userIdentity.findFirst({ where: { userId, corpId: { not: corpId } } })) conflict("当前企业与历史档案的企业范围不一致");
      if (binding?.unionId && person.unionId && binding.unionId !== person.unionId) conflict("账号的已知身份标识发生冲突，请使用人工关联流程核实");
      if (person.unionId && await tx.userIdentity.findFirst({ where: { corpId, unionId: person.unionId, userId: { not: userId } } })) conflict();
      await tx.userIdentity.updateMany({ where: { userId }, data: { active: false } });
      await tx.userIdentity.upsert({ where: { corpId_externalUserId: { corpId, externalUserId: person.dingtalkUserId } },
        create: { userId, corpId, externalUserId: person.dingtalkUserId, unionId: person.unionId, active: true }, update: { active: true, ...(person.unionId ? { unionId: person.unionId } : {}) } });
      await tx.userRoleAssignment.deleteMany({ where: { userId, role: { not: "EMPLOYEE" } } });
      await tx.userRoleAssignment.upsert({ where: { userId_role: { userId, role: "EMPLOYEE" } }, create: { userId, role: "EMPLOYEE" }, update: {} });
      const restored = await tx.user.update({ where: { id: userId }, data: { ...profileData(person), employmentStatus: "ACTIVE", departedAt: null, archivedAt: null, lastSyncedAt: observedAt,
        status: user.manuallyDisabled ? "DISABLED" : "ACTIVE", sessionVersion: { increment: 1 } }, include });
      await tx.personnelIdentityAudit.create({ data: { action: "MANUAL_RESTORE", userId, operatorId: operator.id, reason: reason.trim(), details: JSON.stringify({ corpId, externalUserId: person.dingtalkUserId }) } });
      return restored;
    });
  }

  async linkRehire(currentUserId: string, archivedUserId: string, operator: UserWithRoles, reason: string) {
    requireSuperAdmin(operator);
    if (currentUserId === archivedUserId || !reason?.trim() || reason.trim().length > 2000) throw new AppError(400, "INVALID_REHIRE_LINK", "请选择不同的在职与离职档案，并填写核验依据（最多 2000 字）");
    const corpId = personnelCorpId();
    return this.transaction(async (tx) => {
      const admin = await tx.user.findUniqueOrThrow({ where: { id: operator.id }, include });
      requireSuperAdmin(admin);
      const [current, archived] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: currentUserId }, include }), tx.user.findUniqueOrThrow({ where: { id: archivedUserId }, include })
      ]);
      if (current.employmentStatus !== "ACTIVE" || current.mergedIntoId || archived.employmentStatus !== "DEPARTED" || archived.mergedIntoId) conflict("只能把在职人员关联到尚未合并的离职档案");
      if (current.roleAssignments.some((assignment) => assignment.role !== "EMPLOYEE")) conflict("请先移除该在职档案的管理员或处理人角色，再关联历史档案");
      const activeIdentity = await tx.userIdentity.findFirst({ where: { userId: currentUserId, corpId, active: true, externalUserId: current.dingtalkUserId } });
      if (!activeIdentity) conflict("在职档案尚未完成当前企业的钉钉身份核验，请先同步或登录");
      if (await tx.userIdentity.findFirst({ where: { userId: archivedUserId, corpId: { not: corpId } } })) conflict("离职档案的企业范围不同，不能关联");
      const now = new Date();
      // 保留源档案作为合并审计，释放当前账号唯一键；绝不物理删除人员或工单。
      await tx.user.update({ where: { id: currentUserId }, data: { dingtalkUserId: `archived:${currentUserId}`, employmentStatus: "DEPARTED", status: "DISABLED", departedAt: now, archivedAt: now,
        mergedIntoId: archivedUserId, sessionVersion: { increment: 1 } } });
      await tx.userIdentity.updateMany({ where: { userId: archivedUserId }, data: { active: false } });
      await tx.userIdentity.updateMany({ where: { userId: currentUserId }, data: { userId: archivedUserId } });
      await tx.ticket.updateMany({ where: { OR: [{ applicantId: currentUserId }, { applicantId: null, applicantUserId: current.dingtalkUserId }] }, data: { applicantId: archivedUserId } });
      await tx.ticket.updateMany({ where: { OR: [{ handlerId: currentUserId }, { handlerId: null, handlerUserId: current.dingtalkUserId }] }, data: { handlerId: archivedUserId } });
      await tx.ticketCcRecipient.updateMany({ where: { OR: [{ personId: currentUserId }, { personId: null, userId: current.dingtalkUserId }] }, data: { personId: archivedUserId } });
      await tx.categoryCcRecipient.updateMany({ where: { OR: [{ personId: currentUserId }, { personId: null, userId: current.dingtalkUserId }] }, data: { personId: archivedUserId } });
      await tx.notification.updateMany({ where: { OR: [{ receiverPersonId: currentUserId }, { receiverPersonId: null, receiverUserId: current.dingtalkUserId }] }, data: { receiverPersonId: archivedUserId } });
      await this.moveAiOwnership(tx, archived.dingtalkUserId, current.dingtalkUserId, archivedUserId);
      await tx.userRoleAssignment.deleteMany({ where: { userId: { in: [currentUserId, archivedUserId] }, role: { not: "EMPLOYEE" } } });
      await tx.userRoleAssignment.upsert({ where: { userId_role: { userId: archivedUserId, role: "EMPLOYEE" } }, create: { userId: archivedUserId, role: "EMPLOYEE" }, update: {} });
      const manuallyDisabled = archived.manuallyDisabled || current.manuallyDisabled || current.status === "DISABLED";
      const restored = await tx.user.update({ where: { id: archivedUserId }, data: { dingtalkUserId: current.dingtalkUserId, name: current.name,
        mobile: current.mobile, departmentId: current.departmentId, departmentName: current.departmentName, position: current.position, avatar: current.avatar,
        employmentStatus: "ACTIVE", departedAt: null, archivedAt: null, lastSyncedAt: current.lastSyncedAt, manuallyDisabled, status: manuallyDisabled ? "DISABLED" : "ACTIVE", sessionVersion: { increment: 1 } }, include });
      await tx.personnelIdentityAudit.create({ data: { action: "MANUAL_LINK", userId: archivedUserId, relatedUserId: currentUserId, operatorId: operator.id,
        reason: reason.trim(), details: JSON.stringify({ previousExternalUserId: archived.dingtalkUserId, currentExternalUserId: current.dingtalkUserId }) } });
      return restored;
    });
  }
}
