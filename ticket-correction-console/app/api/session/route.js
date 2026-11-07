import { requireSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const session = requireSession(request);
    return jsonOk({
      username: session.sub,
      csrf: session.csrf,
      expiresAt: new Date(session.exp).toISOString()
    });
  } catch (error) {
    return jsonError(error);
  }
}
