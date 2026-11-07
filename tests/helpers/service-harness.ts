import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

// Execute the real service source with database/network entry points blocked.
export function loadService(relative: string, overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, { exports: any }>();
  class AppError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  function load(file: string): any {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const source = fs.readFileSync(filename, "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as any };
    cache.set(filename, module);
    function safeRequire(id: string): any {
      if (id in overrides) return overrides[id];
      if (id === "@/src/lib/prisma") return { prisma: new Proxy({}, { get() { throw new Error("Default database access forbidden in tests"); } }) };
      if (id === "@/src/lib/http") return { AppError };
      if (id === "@/src/server/uploads") return { validateOwnedAttachments: async (value: unknown) => value };
      if (id === "@/src/server/dingtalk/DingTalkClient") return { DingTalkClient: class { constructor() { throw new Error("Default network client forbidden in tests"); } } };
      if (id === "node:crypto") return crypto;
      if (id === "@prisma/client") return { Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } } };
      if (id.startsWith("@/")) return load(path.resolve(id.slice(2) + ".ts"));
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), id + ".ts"));
      throw new Error(`Unapproved import: ${id}`);
    }
    vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {
      Date, Intl, URLSearchParams, console,
      process: { env: { APP_BASE_URL: "https://example.invalid" } }
    }, { filename })(safeRequire, module, module.exports);
    return module.exports;
  }
  return load(relative);
}

export const handler = { id: "handler-id", dingtalkUserId: "handler", name: "Handler", status: "ACTIVE", employmentStatus: "ACTIVE", sessionVersion: 0, mergedIntoId: null, roleAssignments: [{ role: "IT_HANDLER" }] };
export const applicant = { id: "applicant-id", dingtalkUserId: "applicant", name: "Applicant", status: "ACTIVE", employmentStatus: "ACTIVE", sessionVersion: 0, mergedIntoId: null, roleAssignments: [{ role: "EMPLOYEE" }] };
export const admin = { id: "admin-id", dingtalkUserId: "admin", name: "Admin", status: "ACTIVE", employmentStatus: "ACTIVE", sessionVersion: 0, mergedIntoId: null, roleAssignments: [{ role: "SUPER_ADMIN" }] };

export function ticket(patch: Record<string, any> = {}) {
  return {
    id: "ticket-1", ticketNo: "IT202611070001", title: "Printer", categoryName: "IT", categoryId: "cat",
    status: "PROCESSING", priority: "NORMAL", handlerUserId: handler.dingtalkUserId, handlerName: handler.name,
    applicantUserId: applicant.dingtalkUserId, applicantName: applicant.name, description: "Printer stopped",
    createdAt: new Date(Date.now() - 7_200_000), updatedAt: new Date(Date.now() - 60_000),
    firstResponseAt: null, resolvedAt: null, closedAt: null, resultSummary: null,
    slaFirstResponseDeadline: new Date(Date.now() - 3_600_000), slaResolveDeadline: new Date(Date.now() - 1_800_000),
    isFirstResponseOverdue: false, isResolveOverdue: false, ccRecipients: [], ...patch
  };
}

function compare(value: any, condition: any): boolean {
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (condition === null) return value == null;
  if (typeof condition !== "object") return value === condition;
  return Object.entries(condition).every(([operator, expected]: [string, any]) => {
    if (operator === "in") return expected.includes(value);
    if (operator === "not") return !compare(value, expected);
    if (operator === "contains") return typeof value === "string" && value.includes(expected);
    if (operator === "gt") return value != null && value > expected;
    if (operator === "gte") return value != null && value >= expected;
    if (operator === "lt") return value != null && value < expected;
    if (operator === "lte") return value != null && value <= expected;
    if (operator === "some") return value.some((item: any) => matches(item, expected));
    throw new Error(`Unsupported matcher: ${operator}`);
  });
}
export function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "AND") return condition.every((part: any) => matches(row, part));
    if (key === "OR") return condition.some((part: any) => matches(row, part));
    return compare(row[key], condition);
  });
}

export function memoryDatabase(initial: any[] = [ticket()]) {
  let rows = structuredClone(initial);
  let logs: any[] = [];
  let knowledge: any[] = [];
  const notifications: any[] = [];
  let tail = Promise.resolve();
  const users = structuredClone([handler, applicant, admin, { ...handler, id: "next-id", dingtalkUserId: "next", name: "Next" }]);
  const state = { failLog: false, failKnowledge: false, createConflicts: 0, createAttempts: 0 };
  const db: any = {
    ticket: {
      findUnique: async ({ where, include }: any) => {
        const row = rows.find((item) => matches(item, where));
        return row ? { ...structuredClone(row), ...(include?.logs ? { logs: logs.filter((log) => log.ticketId === row.id) } : {}) } : null;
      },
      findUniqueOrThrow: async (args: any) => { const row = await db.ticket.findUnique(args); if (!row) throw new Error("Missing ticket"); return row; },
      findFirst: async ({ where }: any) => structuredClone(rows.find((row) => matches(row, where)) || null),
      findMany: async ({ where, orderBy, take, skip = 0, cursor }: any) => {
        let found = rows.filter((row) => matches(row, where));
        const ordering = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        found = [...found].sort((a, b) => { for (const rule of ordering) { const [key, direction] = Object.entries(rule)[0]; const sign = direction === "desc" ? -1 : 1; if (a[key] < b[key]) return -sign; if (a[key] > b[key]) return sign; } return 0; });
        if (cursor) found = found.slice(found.findIndex((row) => row.id === cursor.id));
        return structuredClone(found.slice(skip, take ? skip + take : undefined));
      },
      count: async ({ where }: any = {}) => rows.filter((row) => matches(row, where)).length,
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        rows = rows.map((row) => matches(row, where) ? (count++, { ...row, ...structuredClone(data) }) : row);
        return { count };
      },
      create: async ({ data }: any) => {
        state.createAttempts++;
        if (state.createConflicts-- > 0 || rows.some((row) => row.ticketNo === data.ticketNo)) throw Object.assign(new Error("Unique number"), { code: "P2002", meta: { target: ["ticketNo"] } });
        const row = ticket({ id: `created-${state.createAttempts}`, updatedAt: new Date(), ...data, ccRecipients: data.ccRecipients?.create || [] }); rows.push(row); return structuredClone(row);
      }
    },
    user: {
      updateMany: async ({ where, data }: any) => {
        const found = users.filter((user) => matches(user, where));
        for (const user of found) if (data.sessionVersion?.increment) user.sessionVersion += data.sessionVersion.increment;
        return { count: found.length };
      },
      findUnique: async ({ where }: any) => structuredClone(users.find((user) => matches(user, where)) || null),
      findMany: async ({ where }: any) => structuredClone(users.filter((user) => matches(user, where)))
    },
    ticketCategory: { findFirst: async () => ({ id: "cat", name: "IT", enabled: true, defaultHandlerUserId: "handler", firstResponseMinutes: 60, resolveMinutes: 120 }) },
    categoryCcRecipient: { findMany: async () => [] },
    ticketCcRecipient: {
      findMany: async ({ where }: any) => rows.filter(row => row.id === where.ticketId).flatMap(row => row.ccRecipients || [])
        .map((person: any) => ({ ...person, user: users.find(user => person.personId ? user.id === person.personId : user.dingtalkUserId === person.userId) }))
        .filter((person: any) => person.user?.status === "ACTIVE"),
      findFirst: async ({ where }: any) => rows.find(row => row.id === where.ticketId)?.ccRecipients?.find((person: any) => matches({ ...person, ticketId: where.ticketId }, where)) || null
    },
    ticketLog: { create: async ({ data }: any) => { if (state.failLog) throw new Error("Log storage failed"); const log = { id: `log-${logs.length}`, ...data }; logs.push(log); return log; } },
    knowledgeBase: { create: async ({ data }: any) => { if (state.failKnowledge) throw new Error("Knowledge storage failed"); knowledge.push(data); return data; } },
    systemConfig: { findUnique: async () => null },
    notification: {
      findFirst: async ({ where }: any) => structuredClone(notifications.find((row) => matches(row, where)) || null),
      create: async ({ data }: any) => {
        const id = data.id || `notification-${notifications.length}`;
        if (notifications.some((n) => n.id === id)) throw Object.assign(new Error("Unique id"), { code: "P2002" });
        const row = { createdAt: new Date(), ...data, id }; notifications.push(row); return structuredClone(row);
      },
      findUniqueOrThrow: async ({ where }: any) => { const row = notifications.find((n) => matches(n, where)); if (!row) throw new Error("Missing notification"); return structuredClone(row); },
      update: async ({ where, data }: any) => { const row = notifications.find((n) => matches(n, where)); if (!row) throw new Error("Missing notification"); Object.assign(row, data); return structuredClone(row); },
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of notifications) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; }
    },
    $transaction: async (operation: any) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone({ rows, logs, knowledge });
      try { return await operation(db); }
      catch (error) { rows = snapshot.rows; logs = snapshot.logs; knowledge = snapshot.knowledge; throw error; }
      finally { release(); }
    }
  };
  return { db, state, users, rows: () => rows, logs: () => logs, knowledge: () => knowledge, notifications: () => notifications };
}
