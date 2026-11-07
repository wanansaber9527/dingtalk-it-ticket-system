import { timingSafeEqual } from "node:crypto";
import { AppError, fail, ok } from "@/src/lib/http";
import { DirectorySyncService } from "@/src/server/services/directorySyncService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const expected = process.env.DIRECTORY_SYNC_CRON_SECRET || "";
    if (Buffer.byteLength(expected) < 32) throw new AppError(500, "DIRECTORY_SYNC_SECRET_MISSING", "未配置独立的人员同步任务密钥");
    const header = request.headers.get("authorization") || "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-cron-secret") || "";
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AppError(401, "INVALID_CRON_SECRET", "定时任务身份无效");
    return ok(await new DirectorySyncService().run({ trigger: "AUTO" }));
  } catch (error) { return fail(error); }
}
