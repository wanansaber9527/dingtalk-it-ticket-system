import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness(options: { corpId?: string; fetch?: typeof fetch } = {}) {
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const scripts: FakeScript[] = [];
  class FakeScript extends EventTarget {
    src = "";
    async = false;
    dataset: Record<string, string> = {};
    remove() { const index = scripts.indexOf(this); if (index >= 0) scripts.splice(index, 1); }
  }
  const document = { baseURI: "https://example.invalid/", scripts, createElement: () => new FakeScript(), head: { appendChild: (script: FakeScript) => scripts.push(script) } };
  const storage = new Map([["itdesk_dingtalk_authing", "1"]]);
  let reloads = 0;
  const window = {
    navigator: { userAgent: "DingTalk Test" }, location: { pathname: "/tickets/new", reload: () => { reloads++; } },
    sessionStorage: { removeItem: (key: string) => storage.delete(key) }, dd: undefined as any
  };
  const state: any[] = [];
  const effects: Array<() => (() => void) | undefined> = [];
  let hookIndex = 0;
  const react = {
    useState: (initial: any) => { const index = hookIndex++; state[index] = initial; return [initial, (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef: (initial: any) => ({ current: initial }),
    useEffect: (effect: () => (() => void) | undefined) => effects.push(effect)
  };
  const source = fs.readFileSync("components/auth/DingTalkAuthBootstrap.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require,exports){${code}\nexports.helpers = {loadScript,requestAuthCode,fetchWithTimeout};})`, {
    window, document, URL, DOMException, AbortController, Error, console,
    process: { env: { NEXT_PUBLIC_DINGTALK_CORP_ID: options.corpId ?? "test-corp" } },
    fetch: options.fetch || (async () => ({ ok: true, status: 200 })),
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id)
  })((id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (id === "antd") return { Alert: () => null, Button: () => null };
    throw new Error(`Unexpected import ${id}`);
  }, exports);
  return { ...exports.helpers, component: exports.DingTalkAuthBootstrap, window, state, effects, storage, scripts, timers, reloads: () => reloads, expire: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };

test("a stale sessionStorage authing flag does not block a new login", async () => {
  const requests: string[] = [];
  const responses = [401, 200, 200];
  const h = harness({ fetch: (async (url: string) => { requests.push(url); const status = responses.shift()!; return { ok: status === 200, status }; }) as unknown as typeof fetch });
  h.window.dd = { ready: (callback: () => void) => callback(), runtime: { permission: { requestAuthCode: ({ onSuccess }: any) => onSuccess({ code: "test-code" }) } } };
  h.component();
  h.effects[0]();
  await flush();
  assert.deepEqual(requests, ["/api/me", "/api/dingtalk/callback", "/api/me"]);
  assert.equal(h.reloads(), 1);
  assert.equal(h.storage.has("itdesk_dingtalk_authing"), false);
  assert.equal(h.state[1], null);
});

test("local mode with no corpId makes no authentication requests", async () => {
  let requests = 0;
  const h = harness({ corpId: "", fetch: (async () => { requests++; return { ok: true, status: 200 }; }) as unknown as typeof fetch });
  h.component(); h.effects[0](); await flush();
  assert.equal(requests, 0);
  assert.equal(h.state[1], null);
});

test("initial session fetch failure becomes retryable UI state, not an unhandled rejection", async () => {
  const h = harness({ fetch: (async () => { throw new Error("Offline"); }) as unknown as typeof fetch });
  h.component(); h.effects[0](); await flush();
  assert.match(h.state[1], /登录服务连接失败/);
  assert.equal(h.state[2], false);
  assert.equal(h.reloads(), 0);
});

test("a successful callback without a working cookie does not create a reload loop", async () => {
  const responses = [401, 200, 401];
  const h = harness({ fetch: (async () => { const status = responses.shift()!; return { ok: status === 200, status }; }) as unknown as typeof fetch });
  h.window.dd = { ready: (callback: () => void) => callback(), runtime: { permission: { requestAuthCode: ({ onSuccess }: any) => onSuccess({ code: "test-code" }) } } };
  h.component(); h.effects[0](); await flush();
  assert.equal(h.reloads(), 0);
  assert.match(h.state[1], /登录信息未生效/);
});

test("a script that never loads times out and can be loaded by the next attempt", async () => {
  const h = harness();
  const first = h.loadScript("https://example.invalid/sdk.js", new AbortController().signal);
  const rejection = assert.rejects(first, /加载超时/);
  h.expire(); await rejection;
  assert.equal(h.scripts.length, 0);
  const second = h.loadScript("https://example.invalid/sdk.js", new AbortController().signal);
  h.window.dd = { runtime: { permission: { requestAuthCode: () => {} } } };
  h.scripts[0].dispatchEvent(new Event("load"));
  await second;
  assert.equal(h.timers.size, 0);
});

test("SDK ready timeout ignores a late callback and abort cancels pending script load", async () => {
  const h = harness();
  let ready!: () => void;
  let codeRequests = 0;
  h.window.dd = { ready: (callback: () => void) => { ready = callback; }, runtime: { permission: { requestAuthCode: () => { codeRequests++; } } } };
  const code = h.requestAuthCode("corp", new AbortController().signal);
  const rejection = assert.rejects(code, /授权超时/);
  h.expire(); await rejection;
  ready();
  assert.equal(codeRequests, 0);
  h.window.dd = undefined;
  const controller = new AbortController();
  const script = h.loadScript("https://example.invalid/sdk.js", controller.signal);
  const cancelled = assert.rejects(script, { name: "AbortError" });
  controller.abort(); await cancelled;
  assert.equal(h.scripts.length, 0);
  assert.equal(h.timers.size, 0);
});

test("HTTP timeout aborts the request and effect cleanup prevents late state updates", async () => {
  const hangingFetch = (async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })) as unknown as typeof fetch;
  const h = harness({ fetch: hangingFetch });
  const request = h.fetchWithTimeout("/api/me", {}, new AbortController().signal);
  const rejected = assert.rejects(request, /请求超时/);
  h.expire(); await rejected;
  h.component();
  const cleanup = h.effects[0]();
  cleanup?.();
  await flush();
  assert.equal(h.state[1], null);
  assert.equal(h.reloads(), 0);
  assert.equal(h.timers.size, 0);
});
