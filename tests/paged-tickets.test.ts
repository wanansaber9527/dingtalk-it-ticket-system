import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness() {
  const state: any[] = [];
  const requests: Array<{ url: string; signal: AbortSignal; resolve: (value: any) => void; reject: (error: Error) => void }> = [];
  let index = 0;
  let dependencies: unknown[] | undefined;
  let pendingEffect: (() => (() => void)) | undefined;
  let cleanup: (() => void) | undefined;
  let filters: Record<string, string> = { keyword: "Printer", includeStats: "true" };
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (next: any) => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }];
    },
    useCallback: (callback: unknown) => callback,
    useEffect(effect: () => (() => void), next: unknown[]) {
      if (!dependencies || next.some((value, position) => value !== dependencies![position])) pendingEffect = effect;
      dependencies = next;
    }
  };
  const code = ts.transpileModule(fs.readFileSync("src/hooks/usePagedTickets.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require,exports){${code}\n})`, {
    URLSearchParams, AbortController, Error,
    fetch: (url: string, init: RequestInit) => new Promise((resolve, reject) => requests.push({ url, signal: init.signal!, resolve, reject }))
  })((id: string) => { if (id === "react") return react; throw new Error(`Unexpected import ${id}`); }, exports);
  function render(nextFilters = filters) {
    filters = nextFilters;
    index = 0;
    let result = exports.usePagedTickets("/api/admin/tickets", filters);
    if (pendingEffect) {
      cleanup?.();
      cleanup = pendingEffect();
      pendingEffect = undefined;
      index = 0;
      result = exports.usePagedTickets("/api/admin/tickets", filters);
    }
    return result;
  }
  return { render, requests };
}
const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };
const response = (todo: number) => ({ ok: true, json: async () => ({ success: true, data: { items: [{ id: `ticket-${todo}` }], total: todo, page: 1, pageSize: 20, totalPages: Math.ceil(todo / 20), stats: { todo, returned: 7, overdue: 3 } } }) });

test("paged stats stay steady for quick filters but invalidate on scope changes, errors and stale responses", async () => {
  const h = harness();
  assert.equal(h.render().stats, undefined);
  h.requests[0].resolve(response(210)); await flush();
  assert.equal(h.render().stats.todo, 210);
  const sameScope = h.render({ keyword: "Printer", includeStats: "true", statusGroup: "todo" });
  assert.equal(sameScope.loading, true);
  assert.equal(sameScope.stats.todo, 210);
  const newScope = h.render({ keyword: "Network", includeStats: "true", statusGroup: "todo" });
  assert.equal(newScope.stats, undefined);
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve(response(999)); await flush();
  assert.equal(h.render().stats, undefined);
  h.requests[2].resolve(response(6)); await flush();
  assert.equal(h.render().stats.todo, 6);
  const overdue = h.render({ keyword: "Network", includeStats: "true", overdue: "true" });
  assert.equal(overdue.stats.todo, 6);
  h.requests[3].reject(new Error("Offline")); await flush();
  const failure = h.render();
  assert.equal(failure.error, "Offline");
  assert.equal(failure.stats, undefined);
  assert.equal(failure.loading, false);
});
