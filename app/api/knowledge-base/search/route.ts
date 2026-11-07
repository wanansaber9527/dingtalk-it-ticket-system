import { AppError, fail } from "@/src/lib/http";
import { getCurrentUser } from "@/src/server/auth";

export async function GET(request: Request) {
  try {
    await getCurrentUser(request);
    throw new AppError(410, "KNOWLEDGE_BASE_RETIRED", "知识库已替换为 AI 助手，请从 AI 助手入口继续。");
  } catch (error) {
    return fail(error);
  }
}
