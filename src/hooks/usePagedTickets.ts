"use client";
import { useCallback, useEffect, useState } from "react";
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number; stats?: { todo: number; returned: number; overdue: number } };
export function usePagedTickets<T>(endpoint: string, filters: Record<string, string | boolean | undefined> = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<PageResult<T> & { statsScope?: string }>({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
  const url = `${endpoint}?${query}`;
  const scope = new URLSearchParams();
  Object.entries(filters).filter(([key]) => !["status", "statusGroup", "overdue", "includeStats"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
    if (value !== undefined && value !== "") scope.set(key, String(value));
  });
  const statsScope = `${endpoint}?${scope}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    setData(previous => ({ items: [], total: 0, page, pageSize, totalPages: 0, statsScope, stats: previous.statsScope === statsScope ? previous.stats : undefined }));
    fetch(url, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || "加载失败");
      if (!controller.signal.aborted) {
        const result = json.data as PageResult<T>;
        const lastPage = Math.max(1, result.totalPages);
        if (page > lastPage) setPage(lastPage);
        else setData({ ...result, statsScope });
      }
    }).catch(e => {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "加载失败");
        setData(previous => ({ ...previous, stats: undefined }));
      }
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, revision, page, pageSize, statsScope]);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const changePage = useCallback((next: number, size: number) => { setPage(next); setPageSize(size); }, []);
  return { tickets: data.items, total: data.total, stats: data.statsScope === statsScope ? data.stats : undefined, page, pageSize, loading, error, refresh, changePage, setPage };
}
