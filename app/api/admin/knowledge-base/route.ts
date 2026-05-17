// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { KnowledgeBaseService, type KnowledgeBaseInput } from "@/src/server/services/knowledgeBaseService";
import { requireRole } from "@/src/server/permissions";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const url = new URL(request.url);
    const service = new KnowledgeBaseService();
    return ok(await service.list(url.searchParams.get("keyword") || undefined, url.searchParams.get("categoryId") || undefined));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    // 中文注释：后台新增知识库入口只允许管理员访问，处理人沉淀知识走工单处理流程生成草稿。
    requireRole(user, ["IT_ADMIN", "SUPER_ADMIN"]);
    const body = await parseJson<KnowledgeBaseInput>(request);
    const service = new KnowledgeBaseService();
    return ok(await service.create(body, user), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
