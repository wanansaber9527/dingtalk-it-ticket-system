// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { CategoryService } from "@/src/server/services/categoryService";
import { fail, ok } from "@/src/lib/http";

export async function GET() {
  try {
    const service = new CategoryService();
    return ok(await service.list(true));
  } catch (error) {
    return fail(error);
  }
}
