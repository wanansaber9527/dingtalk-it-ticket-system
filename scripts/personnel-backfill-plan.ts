/** Pure validation/planning for the one-time production identity migration. No database or environment-file access. */
export class PersonnelBackfillError extends Error {}

export type BackfillOptions = { apply: boolean; database: string; corpId: string };

export function productionBackfillOptions(args: string[], env: Record<string, string | undefined>): BackfillOptions {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply" && !apply) { apply = true; continue; }
    if (!["--expected-database", "--expected-corp-id"].includes(arg) || values.has(arg) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new PersonnelBackfillError("参数无效；必须显式提供 --expected-database 和 --expected-corp-id，默认仅预览");
    }
    values.set(arg, args[++i]);
  }
  if (env.NODE_ENV !== "production") throw new PersonnelBackfillError("仅允许显式生产环境");
  for (const key of ["DEV_AUTH_ENABLED", "DINGTALK_MOCK_ENABLED", "AI_LOCAL_DEMO_ENABLED", "NEXT_PUBLIC_LOCAL_DEMO"]) {
    if (env[key] && env[key] !== "false") throw new PersonnelBackfillError("必须关闭开发身份、Mock 和本地演示开关");
  }
  if (env.ITDESK_LOCAL_ISOLATED || env.DIRECTORY_SYNC_LOCAL_FIXTURE || env.LOCAL_NEXT_DIST_DIR) {
    throw new PersonnelBackfillError("不能携带本地隔离、测试数据或本地构建配置");
  }
  let url: URL;
  try { url = new URL(env.DATABASE_URL || ""); } catch { throw new PersonnelBackfillError("数据库地址无效"); }
  let database: string;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new PersonnelBackfillError("数据库名称无效"); }
  const expectedDatabase = values.get("--expected-database");
  if (url.protocol !== "mysql:" || !url.hostname || !database || database.includes("/") || database === "itdesk_local" || !expectedDatabase || database !== expectedDatabase) {
    throw new PersonnelBackfillError("数据库类型或名称与显式预期不匹配，或目标为本地测试库");
  }
  const serverCorp = env.DINGTALK_CORP_ID?.trim();
  const publicCorp = env.NEXT_PUBLIC_DINGTALK_CORP_ID?.trim();
  if (serverCorp && publicCorp && serverCorp !== publicCorp) throw new PersonnelBackfillError("服务端与前端企业标识不一致");
  const corpId = serverCorp || publicCorp;
  if (!corpId || corpId === "local-corp" || corpId.length > 191 || values.get("--expected-corp-id") !== corpId) {
    throw new PersonnelBackfillError("企业标识与显式预期不匹配，或目标为本地模拟企业");
  }
  return { apply, database, corpId };
}

export type BackfillPerson = { id: string; dingtalkUserId: string; status: string; employmentStatus: string; manuallyDisabled: boolean; mergedIntoId: string | null };
export type BackfillIdentity = { userId: string; corpId: string; externalUserId: string };
export type RelationKind = "applicants" | "handlers" | "categoryCc" | "ticketCc" | "notices";
export type BackfillRelation = { kind: RelationKind; id: string; externalId: string | null; personId: string | null };
export type BackfillSnapshot = { users: BackfillPerson[]; identities: BackfillIdentity[]; relations: BackfillRelation[] };
export type BackfillPlan = {
  relations: { kind: RelationKind; id: string; personId: string }[];
  manuallyDisabledIds: string[];
  identities: { userId: string; corpId: string; externalUserId: string; active: boolean }[];
  counts: { users: number; inspectedRelations: number; applicants: number; handlers: number; categoryCc: number; ticketCc: number; notices: number; manuallyDisabled: number; identities: number; unresolvedApplicants: number; unresolvedHandlers: number; unresolvedCategoryCc: number; unresolvedTicketCc: number; unresolvedNotices: number };
};

export function planPersonnelBackfill(snapshot: BackfillSnapshot, corpId: string): BackfillPlan {
  const byId = new Map(snapshot.users.map(user => [user.id, user]));
  const byExternal = new Map(snapshot.users.map(user => [user.dingtalkUserId, user]));
  if (byId.size !== snapshot.users.length || byExternal.size !== snapshot.users.length) throw new PersonnelBackfillError("人员唯一标识存在冲突");
  const identityByExternal = new Map<string, BackfillIdentity>();
  for (const identity of snapshot.identities) {
    if (identity.corpId !== corpId || !byId.has(identity.userId)) throw new PersonnelBackfillError("现有身份绑定的企业范围或人员关联不匹配");
    const previous = identityByExternal.get(identity.externalUserId);
    const current = byExternal.get(identity.externalUserId);
    if ((previous && previous.userId !== identity.userId) || (current && current.id !== identity.userId)) throw new PersonnelBackfillError("现有外部身份绑定与人员档案冲突");
    identityByExternal.set(identity.externalUserId, identity);
  }
  const plan: BackfillPlan = { relations: [], manuallyDisabledIds: [], identities: [], counts: {
    users: snapshot.users.length, inspectedRelations: snapshot.relations.length,
    applicants: 0, handlers: 0, categoryCc: 0, ticketCc: 0, notices: 0, manuallyDisabled: 0, identities: 0,
    unresolvedApplicants: 0, unresolvedHandlers: 0, unresolvedCategoryCc: 0, unresolvedTicketCc: 0, unresolvedNotices: 0
  } };
  const unresolved = { applicants: "unresolvedApplicants", handlers: "unresolvedHandlers", categoryCc: "unresolvedCategoryCc", ticketCc: "unresolvedTicketCc", notices: "unresolvedNotices" } as const;
  let conflicts = 0;
  for (const row of snapshot.relations) {
    const identity = row.externalId ? identityByExternal.get(row.externalId) : undefined;
    const expectedId = identity?.userId || (row.externalId ? byExternal.get(row.externalId)?.id : undefined);
    const expected = expectedId ? byId.get(expectedId) : undefined;
    if (row.personId) {
      // Never overwrite an existing association. Historical external identities can still prove ownership after rehire.
      if (!expected || expected.mergedIntoId || expected.id !== row.personId) conflicts++;
      continue;
    }
    if (row.kind === "handlers" && !row.externalId) continue;
    if (!expected || expected.mergedIntoId) { plan.counts[unresolved[row.kind]]++; continue; }
    plan.relations.push({ kind: row.kind, id: row.id, personId: expected.id });
    plan.counts[row.kind]++;
  }
  if (conflicts) throw new PersonnelBackfillError(`已有内部人员关联与可核验外部身份冲突：${conflicts} 条；未覆盖任何关联`);
  if (plan.counts.unresolvedApplicants || plan.counts.unresolvedHandlers) {
    throw new PersonnelBackfillError(`工单人员无法完整关联：申请人 ${plan.counts.unresolvedApplicants} 条，非空处理人 ${plan.counts.unresolvedHandlers} 条`);
  }
  for (const user of snapshot.users) {
    if (user.mergedIntoId) continue;
    // A later repeat must not turn an automatically departed employee into a manually disabled account.
    if (user.status === "DISABLED" && user.employmentStatus === "ACTIVE" && !user.manuallyDisabled) plan.manuallyDisabledIds.push(user.id);
    if (!identityByExternal.has(user.dingtalkUserId)) plan.identities.push({ userId: user.id, corpId, externalUserId: user.dingtalkUserId, active: user.employmentStatus === "ACTIVE" });
  }
  plan.counts.manuallyDisabled = plan.manuallyDisabledIds.length;
  plan.counts.identities = plan.identities.length;
  return plan;
}
