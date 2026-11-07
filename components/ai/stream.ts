import type { AiStreamEvent } from "@/src/lib/ai";

/** SSE chunks may split UTF-8 characters, lines, or complete events. */
export async function readAiStream(response: Response, onEvent: (event: AiStreamEvent) => void) {
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "AI 服务暂时不可用，请稍后重试");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  function consume(block: string) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as AiStreamEvent;
    onEvent(event);
    if (event.type === "done") finished = true;
    if (event.type === "error") throw new Error(event.message);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!finished) throw new Error("回答连接已中断，可重新打开当前对话查看已保存的内容");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
