import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail, ok } from "@/src/lib/http";
import { requireRole } from "@/src/server/permissions";
import { AiService } from "@/src/server/services/aiService";
import { aiJson, checkAiMutationOrigin } from "@/src/server/ai/http";
import { getAiSettings, getPublicAiSettings, getCategoryConfigs, saveAiSettings, saveCategoryConfig } from "@/src/server/ai/config";
import { testAiConnection } from "@/src/server/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) {
  try {
    checkAiMutationOrigin(request);
    const user = await getCurrentUser(request);
    requireRole(user, ["SUPER_ADMIN"]);
    const path = (await context.params).path || [];
    const method = request.method;
    if (path.join("/") === "settings") {
      if (method === "GET") return ok(await getPublicAiSettings());
      if (method === "PUT") return ok(await saveAiSettings(await aiJson(request), user));
    }
    if (path.join("/") === "test" && method === "POST") return ok(await testAiConnection(await getAiSettings()));
    if (path.join("/") === "categories" && method === "GET") return ok(await getCategoryConfigs());
    if (path[0] === "categories" && path.length === 2 && method === "PUT") return ok(await saveCategoryConfig(path[1], await aiJson(request), user));
    if (path.join("/") === "stats" && method === "GET") return ok(await new AiService().stats(user));
    throw new AppError(404, "NOT_FOUND", "接口不存在");
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
