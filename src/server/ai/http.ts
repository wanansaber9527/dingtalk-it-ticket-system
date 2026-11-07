import { AppError } from "@/src/lib/http";

export function checkAiMutationOrigin(request: Request) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError(403, "CROSS_ORIGIN", "不允许跨站操作");
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(request.url).origin]);
    if (process.env.APP_BASE_URL) allowed.add(new URL(process.env.APP_BASE_URL).origin);
    if (!allowed.has(origin)) throw new AppError(403, "CROSS_ORIGIN", "请求来源不正确");
  }
}

export async function aiJson(request: Request): Promise<unknown> {
  const limit = 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new AppError(413, "BODY_TOO_LARGE", "请求内容过长");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AppError(413, "BODY_TOO_LARGE", "请求内容过长"); }
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid object");
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "请求正文必须是JSON对象");
  } finally { reader.releaseLock(); }
}
