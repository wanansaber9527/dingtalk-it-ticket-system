import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";

async function retired(request: Request) {
  try {
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    throw new AppError(410, "KNOWLEDGE_BASE_RETIRED", "知识库已归档，请使用 AI 助手管理。");
  } catch (error) {
    return fail(error);
  }
}

export const GET = retired;
export const POST = retired;
