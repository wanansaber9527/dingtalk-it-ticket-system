"use client";

// 中文注释：客户端 Provider，集中配置 Ant Design 中文语言包和主题 token。

import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { DingTalkAuthBootstrap } from "@/components/auth/DingTalkAuthBootstrap";

dayjs.locale("zh-cn");

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#007CBE",
          colorInfo: "#007CBE",
          colorSuccess: "#4d8a72",
          colorWarning: "#ad8540",
          colorError: "#b65f66",
          colorText: "#101923",
          colorTextSecondary: "#68788a",
          colorBorder: "rgba(0, 72, 115, 0.11)",
          colorBgContainer: "rgba(255, 255, 255, 0.74)",
          colorBgElevated: "rgba(251, 254, 255, 0.92)",
          borderRadius: 8,
          boxShadowSecondary: "0 18px 48px rgba(22, 55, 82, 0.08)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 34,
            fontWeight: 560
          },
          Card: {
            borderRadiusLG: 8,
            paddingLG: 20
          },
          Table: {
            borderRadius: 8,
            headerBg: "rgba(248, 252, 255, 0.86)",
            rowHoverBg: "rgba(232, 246, 255, 0.62)"
          },
          Modal: {
            borderRadiusLG: 8
          },
          Menu: {
            itemBorderRadius: 8,
            itemSelectedBg: "rgba(0, 124, 190, 0.1)",
            itemSelectedColor: "#007CBE"
          }
        }
      }}
    >
      <AntApp>
        <DingTalkAuthBootstrap />
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
