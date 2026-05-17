import { NextRequest, NextResponse } from "next/server";

function isDingTalkUserAgent(userAgent: string) {
  return /DingTalk|AliApp\(DingTalk/i.test(userAgent);
}

export function middleware(request: NextRequest) {
  // 中文注释：正式环境下提交工单页必须从钉钉客户端进入，普通浏览器统一跳转到提示页。
  if (process.env.DEV_AUTH_ENABLED === "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/tickets/new" && !isDingTalkUserAgent(request.headers.get("user-agent") || "")) {
    const url = request.nextUrl.clone();
    const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const forwardedProto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    // 中文注释：反向代理后 Next 可能看到 localhost，跳转时需要还原公网域名和端口。
    if (forwardedHost) url.host = forwardedHost;
    if (forwardedProto) url.protocol = `${forwardedProto}:`;
    url.pathname = "/open-in-dingtalk";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/tickets/new"]
};
