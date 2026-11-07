// 中文注释：通用基础库，封装 Prisma、HTTP 响应、标签映射和前端请求方法。
import { NextResponse } from "next/server";

export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, code: error.code, message: error.message },
      { status: error.status }
    );
  }

  console.error(error);
  return NextResponse.json(
    { success: false, code: "INTERNAL_ERROR", message: "服务暂时异常，请稍后重试" },
    { status: 500 }
  );
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    const value: unknown = await request.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
    return value as T;
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求正文必须是有效的 JSON 对象");
  }
}
