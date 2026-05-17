// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok } from "@/src/lib/http";
import { UserService } from "@/src/server/services/userService";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    const url = new URL(request.url);
    const service = new UserService();
    if (url.searchParams.get("role") === "handlers") {
      return ok(await service.handlers(user));
    }
    if (url.searchParams.get("role") === "admins") {
      return ok(await service.admins(user));
    }
    if (url.searchParams.get("role") === "executors") {
      return ok(await service.executors(user));
    }
    return ok(await service.list(user));
  } catch (error) {
    return fail(error);
  }
}
