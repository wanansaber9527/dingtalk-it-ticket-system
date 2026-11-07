import {
  assertMutationRequest,
  requireSession,
  SESSION_COOKIE_NAME
} from "@/lib/auth";
import { authConfig } from "@/lib/server-config";
import { jsonError, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const session = requireSession(request);
    assertMutationRequest(request, session);
    const config = authConfig();
    const response = jsonOk({ loggedOut: true });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: config.secureCookie,
      path: config.cookiePath,
      maxAge: 0
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
