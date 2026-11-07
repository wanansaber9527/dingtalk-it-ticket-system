import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail, ok, parseJson } from "@/src/lib/http";
import { requireSuperAdmin } from "@/src/server/permissions";
import { PersonnelIdentityService } from "@/src/server/services/personnelIdentityService";

export async function POST(request: Request) {
  try {
    const operator = await getCurrentUser(request);
    requireSuperAdmin(operator);
    const body = await parseJson<{ currentUserId?: string; archivedUserId?: string; reason?: string }>(request);
    if (typeof body.currentUserId !== "string" || !body.currentUserId || body.currentUserId.length > 191 || typeof body.archivedUserId !== "string" || !body.archivedUserId || body.archivedUserId.length > 191 || typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) {
      throw new AppError(400, "INVALID_REHIRE_LINK", "请选择当前人员和离职档案，并填写 1–500 字的关联原因");
    }
    return ok(await new PersonnelIdentityService().linkRehire(body.currentUserId, body.archivedUserId, operator, body.reason.trim()));
  } catch (error) { return fail(error); }
}
