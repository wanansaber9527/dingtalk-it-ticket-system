import { NextRequest, NextResponse } from "next/server";

function isDingTalkUserAgent(userAgent: string) {
  return /DingTalk|AliApp\(DingTalk/i.test(userAgent);
}

export function middleware(request: NextRequest) {
  // 正式环境下员工首页与报修入口采用相同钉钉入口策略；API 仍独立校验身份。
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_ENABLED === "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (["/", "/ai-assistant", "/tickets/new"].includes(pathname) && !isDingTalkUserAgent(request.headers.get("user-agent") || "")) {
    const url = new URL(process.env.APP_BASE_URL || request.nextUrl.origin);
    url.pathname = "/open-in-dingtalk";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/ai-assistant", "/tickets/new"]
};
