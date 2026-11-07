// 中文注释：发起人补充被退回的工单信息，并将工单重新交回处理人继续处理。
import { getCurrentUser } from "@/src/server/auth";
import { fail, ok, parseJson } from "@/src/lib/http";
import { TicketService, type AttachmentInput } from "@/src/server/services/ticketService";

type Body = {
  remark?: string;
  attachments?: AttachmentInput[];
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { id } = await context.params;
    const body = await parseJson<Body>(request);
    const service = new TicketService();
    return ok(await service.supplementReturnedTicket(id, user, body.remark, body.attachments));
  } catch (error) {
    return fail(error);
  }
}
