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

  const message = error instanceof Error ? error.message : "服务异常";
  console.error(error);
  return NextResponse.json(
    { success: false, code: "INTERNAL_ERROR", message },
    { status: 500 }
  );
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
