import { NextResponse } from "next/server.js";

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonOk(data, init = {}) {
  return NextResponse.json({ ok: true, data }, { ...init, status: init.status || 200 });
}

export function jsonError(error) {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      },
      { status: error.status }
    );
  }

  console.error("Unhandled correction-console error", error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "操作失败，请稍后重试"
      }
    },
    { status: 500 }
  );
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_JSON", "请求内容不是有效 JSON");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new AppError(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "请求内容不是有效 JSON");
  } finally {
    reader.releaseLock();
  }
}
