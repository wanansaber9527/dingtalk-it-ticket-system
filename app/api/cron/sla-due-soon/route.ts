// 中文注释：定时任务入口，扫描即将超时的 SLA 并发送钉钉通知。
import { AppError, fail, ok } from "@/src/lib/http";
import { TicketService } from "@/src/server/services/ticketService";

export const dynamic = "force-dynamic";

function readSecret(request: Request) {
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return request.headers.get("x-cron-secret") || bearer || url.searchParams.get("secret");
}

async function run(request: Request) {
  try {
    const expectedSecret = process.env.SLA_CRON_SECRET;
    if (!expectedSecret) {
      throw new AppError(500, "SLA_CRON_SECRET_MISSING", "缺少 SLA_CRON_SECRET，禁止执行定时通知任务");
    }
    if (readSecret(request) !== expectedSecret) {
      throw new AppError(401, "INVALID_CRON_SECRET", "定时任务密钥无效");
    }

    const service = new TicketService();
    return ok(await service.sendUpcomingSlaNotifications());
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
