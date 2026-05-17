// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { KnowledgeBaseService, type KnowledgeBaseInput } from "@/src/server/services/knowledgeBaseService";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<KnowledgeBaseInput>(request);
    const service = new KnowledgeBaseService();
    return ok(await service.update(id, body, user));
  } catch (error) {
    return fail(error);
  }
}
