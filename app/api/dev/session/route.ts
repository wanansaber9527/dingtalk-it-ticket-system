import { NextResponse } from "next/server";
import { createAuthCookieValue } from "@/src/server/auth";
import { authCookieOptions } from "@/src/server/auth-session";
import { fail, parseJson } from "@/src/lib/http";
import { prisma } from "@/src/lib/prisma";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH_ENABLED !== "true" || process.env.NEXT_PUBLIC_LOCAL_DEMO !== "true" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    return new NextResponse(null, { status: 404 });
  }
  // Next 开发服务器可能将 Request.url 规范为 localhost；浏览器同源以实际 Host 为准。
  const host = request.headers.get("host") || url.host;
  if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(host)) return new NextResponse(null, { status: 404 });
  let requestOrigin: string;
  try { requestOrigin = new URL(`${url.protocol}//${host}`).origin; } catch { return new NextResponse(null, { status: 404 }); }
  if (request.headers.get("origin") && request.headers.get("origin") !== requestOrigin) return new NextResponse(null, { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new NextResponse(null, { status: 403 });
  try {
    const body = await parseJson<{ userId?: string }>(request);
    if (typeof body.userId !== "string" || !["local-admin", "local-handler", "local-employee"].includes(body.userId)) return new NextResponse(null, { status: 400 });
    const user = await prisma.user.findUniqueOrThrow({ where: { dingtalkUserId: body.userId } });
    if (user.status !== "ACTIVE" || user.employmentStatus !== "ACTIVE") return new NextResponse(null, { status: 403 });
    const response = NextResponse.json({ success: true, data: { userId: body.userId } });
    response.cookies.set("it_session", createAuthCookieValue(user), { ...authCookieOptions(request), sameSite: "strict" });
    return response;
  } catch (error) { return fail(error); }
}
