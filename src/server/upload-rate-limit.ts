import { AppError } from "@/src/lib/http";

const windowMs = 10 * 60 * 1000;
const maxUploads = 30;
const buckets = new Map<string, { count: number; expiresAt: number }>();
let inFlight = 0;

export function consumeUploadAllowance(userId: string, now = Date.now()) {
  for (const [key, value] of buckets) if (value.expiresAt <= now) buckets.delete(key);
  const entry = buckets.get(userId);
  if (entry && entry.count >= maxUploads) throw new AppError(429, "UPLOAD_RATE_LIMIT", "图片上传过于频繁，请稍后重试");
  if (!entry && buckets.size >= 10000) throw new AppError(429, "UPLOAD_BUSY", "上传服务繁忙，请稍后重试");
  buckets.set(userId, entry ? { ...entry, count: entry.count + 1 } : { count: 1, expiresAt: now + windowMs });
}

export async function withUploadSlot<T>(run: () => Promise<T>) {
  if (inFlight >= 2) throw new AppError(429, "UPLOAD_BUSY", "上传服务繁忙，请稍后重试");
  inFlight += 1;
  try { return await run(); } finally { inFlight -= 1; }
}

export async function readUploadForm(request: Request) {
  const maxBodyBytes = 11 * 1024 * 1024;
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new AppError(400, "INVALID_UPLOAD_BODY", "请使用图片上传表单");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw new AppError(413, "UPLOAD_TOO_LARGE", "图片不能超过 10MB");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "UPLOAD_FILE_REQUIRED", "请选择要上传的图片");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new AppError(413, "UPLOAD_TOO_LARGE", "图片不能超过 10MB");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new AppError(400, "INVALID_UPLOAD_BODY", "图片上传表单无效");
  }
}
