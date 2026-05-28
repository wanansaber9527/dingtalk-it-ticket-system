// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { CategoryService, type CategoryInput } from "@/src/server/services/categoryService";
import { requireRole } from "@/src/server/permissions";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const service = new CategoryService();
    return ok(await service.list(false));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const body = await parseJson<CategoryInput>(request);
    const service = new CategoryService();
    return ok(await service.create(body, user), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
