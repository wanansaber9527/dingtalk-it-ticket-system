// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService, type AttachmentInput } from "@/src/server/services/ticketService";

type Body = { remark: string; attachments?: AttachmentInput[] };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<Body>(request);
    const service = new TicketService();
    return ok(await service.addComment(id, body.remark, user, body.attachments));
  } catch (error) {
    return fail(error);
  }
}
