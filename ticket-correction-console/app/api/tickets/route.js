import { requireSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { searchTickets } from "@/lib/ticket-service";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    requireSession(request);
    const url = new URL(request.url);
    return jsonOk(await searchTickets(url.searchParams.get("q") || ""));
  } catch (error) {
    return jsonError(error);
  }
}
