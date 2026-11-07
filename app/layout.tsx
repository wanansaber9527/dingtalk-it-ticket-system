// 中文注释：应用根布局，挂载 Ant Design 注册器与全局 Provider。
import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "趣然工单系统",
  description: "公司内部 IT 工单提交、流转、处理与通知",
  other: {
    "wpk-bid": "dta_1_4586226521"
  }
};

const dingtalkWpkMonitorScript = `
  (function () {
    var isDingtalk = navigator && /DingTalk/.test(navigator.userAgent);
    var isProductEnv = window && window.location && window.location.host
      && window.location.host.indexOf("127.0.0.1") === -1
      && window.location.host.indexOf("localhost") === -1
      && window.location.host.indexOf("192.168.") === -1;

    if (isProductEnv && isDingtalk) {
      !(function (c, i, e, b) {
        var h = i.createElement("script");
        var f = i.getElementsByTagName("script")[0];
        h.type = "text/javascript";
        h.crossOrigin = "anonymous";
        h.onload = function () {
          c[b] || (c[b] = new c.wpkReporter({ bid: "dta_1_4586226521" }));
          c[b].installAll();
        };
        f.parentNode.insertBefore(h, f);
        h.src = e;
      })(window, document, "https://g.alicdn.com/woodpeckerx/jssdk??wpkReporter.js", "__wpk");
    }
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
        {/* 中文注释：生产域名且钉钉客户端内打开时，加载钉钉前端监控。 */}
        <Script id="dingtalk-wpk-monitor" strategy="afterInteractive">
          {dingtalkWpkMonitorScript}
        </Script>
      </body>
    </html>
  );
}
