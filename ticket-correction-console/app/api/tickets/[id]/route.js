import crypto from "node:crypto";
import { assertMutationRequest, requireSession } from "@/lib/auth";
import { jsonError, jsonOk, readJson } from "@/lib/http";
import { correctTicket, getTicket } from "@/lib/ticket-service";
import { parseCorrectionPayload } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  try {
    requireSession(request);
    const { id } = await context.params;
    return jsonOk(await getTicket(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request, context) {
  try {
    const session = requireSession(request);
    assertMutationRequest(request, session);
    const body = await readJson(request);
    const parsed = parseCorrectionPayload(body);
    const { id } = await context.params;
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    return jsonOk(
      await correctTicket(id, parsed, {
        requestId,
        username: session.sub
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
