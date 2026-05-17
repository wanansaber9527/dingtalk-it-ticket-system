// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { fail, ok } from "@/src/lib/http";
import { KnowledgeBaseService } from "@/src/server/services/knowledgeBaseService";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const keyword = url.searchParams.get("keyword") || undefined;
    const categoryId = url.searchParams.get("categoryId") || undefined;
    const service = new KnowledgeBaseService();
    return ok(await service.search(keyword, categoryId));
  } catch (error) {
    return fail(error);
  }
}
