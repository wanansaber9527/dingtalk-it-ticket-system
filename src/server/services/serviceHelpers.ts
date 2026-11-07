import { randomUUID } from "node:crypto";
import { AppError } from "@/src/lib/http";

export type Pagination = { page: number; pageSize: number };
export type PageResult<T> = Pagination & { items: T[]; total: number; totalPages: number };

export function parsePagination(params: URLSearchParams): Pagination | undefined {
  if (!params.has("page") && !params.has("pageSize")) return undefined;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw new AppError(400, "INVALID_PAGINATION", "页码需为正整数，每页数量需在 1 至 100 之间");
  }
  return { page, pageSize };
}

export function businessDate(date = new Date()) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const start = new Date(`${stamp}T00:00:00+08:00`);
  return { stamp: stamp.replaceAll("-", ""), start, end: new Date(start.getTime() + 86_400_000) };
}

export function knowledgeBaseNumber(date = new Date()) {
  return `KB${businessDate(date).stamp}${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function isUniqueConflict(error: unknown, field?: string) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const target = "meta" in error ? (error.meta as { target?: unknown } | undefined)?.target : undefined;
  return !field || target === undefined || String(target).includes(field);
}

export async function retryNumberConflict<T>(operation: () => Promise<T>, field: string, attempts = 5): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (!isUniqueConflict(error, field) || attempt >= attempts - 1) throw error;
    }
  }
}
