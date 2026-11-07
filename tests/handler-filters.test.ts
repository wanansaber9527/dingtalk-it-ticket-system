import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadService } from "./helpers/service-harness";

// Exercise the actual page event handlers without rendering Ant Design or making HTTP requests.
function harness() {
  const state: unknown[] = [];
  let index = 0;
  let page = 4;
  let filters: Record<string, string | undefined> = {};
  let tree: any;
  let loading = false;
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (next: unknown) => { state[slot] = next; }];
    }
  };
  const element = (type: unknown, props: unknown) => ({ type, props });
  const source = fs.readFileSync("app/handler/tickets/page.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require,exports){${code}\n})`, { Date, Set, Number })((id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (id === "next/link") return "Link";
    if (id === "antd") return { Alert: "Alert", Badge: "Badge", Button: "Button", Card: "Card", Empty: "Empty", Input: "Input", Pagination: "Pagination", Select: "Select", Skeleton: "Skeleton", Space: "Space", Typography: { Text: "Text" } };
    if (id === "@ant-design/icons") return { EyeOutlined: "Eye", ReloadOutlined: "Reload", SearchOutlined: "Search" };
    if (id === "@/components/tickets/EmployeeShell") return { EmployeeShell: "EmployeeShell" };
    if (id === "@/components/tickets/TicketStatusTag") return { TicketStatusTag: "TicketStatusTag" };
    if (id === "@/src/lib/labels") return loadService("src/lib/labels.ts");
    if (id === "@/src/hooks/usePagedTickets") return { usePagedTickets: (_url: string, applied: typeof filters) => {
      filters = applied;
      return { tickets: [], total: 41, stats: loading ? undefined : { todo: 210, returned: 7, overdue: 110 }, page, pageSize: 20, loading, error: "", refresh() {}, setPage(next: number) { page = next; }, changePage() {} };
    } };
    throw new Error(`Unexpected import ${id}`);
  }, exports);
  function nodes(type: string, node = tree): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((item) => nodes(type, item));
    return [...(node.type === type ? [node] : []), ...nodes(type, node.props?.children ?? null)];
  }
  function render() { index = 0; tree = exports.default(); }
  render();
  return { render, nodes, filters: () => filters, page: () => page, setLoading(value: boolean) { loading = value; render(); } };
}

test("workbench chips toggle exclusively, combine overdue and reflect the exact-state selector", () => {
  const h = harness();
  const click = (index: number) => { h.nodes("button")[index].props.onClick(); h.render(); };
  click(0);
  assert.equal(h.page(), 1);
  assert.equal(h.filters().statusGroup, "todo");
  assert.equal(h.nodes("Select")[0].props.value, "TODO");
  assert.equal(h.nodes("button")[0].props["aria-pressed"], true);
  click(2);
  assert.equal(h.filters().overdue, "true");
  assert.equal(h.filters().statusGroup, "todo");
  click(1);
  assert.equal(h.filters().statusGroup, undefined);
  assert.equal(h.filters().status, "RETURNED");
  assert.equal(h.filters().overdue, "true");
  assert.equal(h.nodes("button")[0].props["aria-pressed"], false);
  assert.equal(h.nodes("button")[1].props["aria-pressed"], true);
  click(1);
  assert.equal(h.filters().status, undefined);
  assert.equal(h.filters().overdue, "true");
  click(0);
  h.nodes("Select")[0].props.onChange("PROCESSING"); h.render();
  assert.equal(h.filters().statusGroup, undefined);
  assert.equal(h.filters().status, "PROCESSING");
  assert.equal(h.nodes("button")[0].props["aria-pressed"], false);
  assert.equal(h.filters().overdue, "true");
  click(2);
  assert.equal(h.filters().overdue, undefined);
  assert.equal(h.filters().status, "PROCESSING");
  h.nodes("Select")[0].props.onChange(undefined); h.render();
  click(0); click(0);
  assert.equal(h.filters().statusGroup, undefined);
  assert.equal(h.filters().includeStats, "true");
});

test("chip changes preserve the submitted keyword, and loading counts never masquerade as zero", () => {
  const h = harness();
  h.nodes("Input")[0].props.onChange({ target: { value: " Printer " } }); h.render();
  h.nodes("Input")[0].props.onPressEnter(); h.render();
  assert.equal(h.filters().keyword, "Printer");
  h.nodes("Input")[0].props.onChange({ target: { value: "Network" } }); h.render();
  h.nodes("button")[0].props.onClick(); h.render();
  assert.equal(h.filters().keyword, "Printer");
  assert.equal(h.nodes("Badge")[0].props.count, 210);
  h.setLoading(true);
  assert.ok(h.nodes("Badge").every((node) => node.props.count === "—"));
  h.setLoading(false);
  h.nodes("Input")[0].props.onPressEnter(); h.render();
  assert.equal(h.filters().keyword, "Network");
  assert.equal(h.filters().statusGroup, "todo");
  assert.equal(h.filters().includeStats, "true");
});
