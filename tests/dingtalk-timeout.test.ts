import test from "node:test";
import assert from "node:assert/strict";
import { DingTalkClient } from "../src/server/dingtalk/DingTalkClient";

test("all DingTalk request paths attach a 20-second deadline without making network calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const deadlines: number[] = [];
  const requests: RequestInit[] = [];
  AbortSignal.timeout = (delay: number) => { deadlines.push(delay); return originalTimeout(delay); };
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    requests.push(init);
    return Response.json({ errcode: 0, result: { ok: true }, ok: true });
  };
  try {
    const client = new DingTalkClient() as unknown as {
      fetchOapi<T>(url: string, body?: unknown): Promise<T>;
      fetchJson<T>(url: string, options: { method: "POST"; body: unknown }): Promise<T>;
      fetchDingTalkOpenApi<T>(url: string, token: string, body: unknown): Promise<T>;
    };
    assert.deepEqual(await client.fetchOapi("https://example.invalid/oapi", { example: true }), { ok: true });
    assert.ok(await client.fetchJson("https://example.invalid/json", { method: "POST", body: { example: true } }));
    assert.ok(await client.fetchDingTalkOpenApi("https://example.invalid/openapi", "test-token", { example: true }));
    assert.deepEqual(deadlines, [20_000, 20_000, 20_000]);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((request) => request.method === "POST"));
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test("a DingTalk timeout remains an error for the existing service fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException("Request deadline reached", "TimeoutError"); };
  try {
    const client = new DingTalkClient() as unknown as { fetchOapi(url: string): Promise<unknown> };
    await assert.rejects(client.fetchOapi("https://example.invalid/oapi"), (error: unknown) => error instanceof Error && error.name === "TimeoutError");
  } finally { globalThis.fetch = originalFetch; }
});
