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
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500) throw new AppError(400, "ARCHIVE_REASON_REQUIRED", "请填写 1–500 字的离职确认原因");
    if (id === operator.id) throw new AppError(409, "CANNOT_ARCHIVE_SELF", "请由其他管理员确认你的离职状态");
    return ok(await new PersonnelIdentityService().archiveUser(id, { source: "ADMIN_CONFIRMED", reason: body.reason.trim(), operatorId: operator.id }));
  } catch (error) { return fail(error); }
}
