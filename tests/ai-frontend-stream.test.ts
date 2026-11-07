import test from "node:test";
import assert from "node:assert/strict";
import { readAiStream } from "../components/ai/stream";
import type { AiStreamEvent } from "../src/lib/ai";

function fragmented(text: string) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      // A byte per chunk exercises split Unicode characters, CRLF and event boundaries.
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}

test("AI browser stream preserves UTF-8 and split CRLF while ignoring keepalive comments", async () => {
  const events: AiStreamEvent[] = [];
  await readAiStream(fragmented(': heartbeat\r\n\r\ndata: {"type":"delta","content":"中文排查"}\r\n\r\ndata: {"type":"done","conversation":{"id":"one"}}\r\n\r\n'), (event) => events.push(event));
  assert.deepEqual(events.map((event) => event.type), ["delta", "done"]);
  assert.equal(events[0].type === "delta" && events[0].content, "中文排查");
});

test("AI browser stream does not report an interrupted reply as completed", async () => {
  await assert.rejects(readAiStream(fragmented('data: {"type":"delta","content":"partial"}\n\n'), () => undefined), /连接已中断/);
});

test("AI browser stream exposes sanitized application errors and rejects HTTP failures", async () => {
  await assert.rejects(readAiStream(fragmented('data: {"type":"error","message":"今日咨询次数已用完"}\n\n'), () => undefined), /今日咨询次数已用完/);
  await assert.rejects(readAiStream(new Response(JSON.stringify({ message: "请重新登录" }), { status: 401 }), () => undefined), /请重新登录/);
});
