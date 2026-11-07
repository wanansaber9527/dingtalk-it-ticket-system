import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail, ok, parseJson } from "@/src/lib/http";
import { requireSuperAdmin } from "@/src/server/permissions";
import { PersonnelIdentityService } from "@/src/server/services/personnelIdentityService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const operator = await getCurrentUser(request);
    requireSuperAdmin(operator);
    const { id } = await context.params;
    const body = await parseJson<{ reason?: string }>(request);
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) throw new AppError(400, "RESTORE_REASON_REQUIRED", "请填写 1–500 字的返聘身份核验依据");
    return ok(await new PersonnelIdentityService().restoreArchivedUser(id, operator, body.reason.trim()));
  } catch (error) { return fail(error); }
}
