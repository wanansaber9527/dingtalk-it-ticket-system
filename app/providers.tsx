"use client";

// 中文注释：客户端 Provider，集中配置 Ant Design 中文语言包和主题 token。

import "@ant-design/v5-patch-for-react-19";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { DingTalkAuthBootstrap } from "@/components/auth/DingTalkAuthBootstrap";
import { corporateCleanTheme } from "@/src/lib/uiTheme";

dayjs.locale("zh-cn");

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={corporateCleanTheme}
    >
      <AntApp>
        <DingTalkAuthBootstrap />
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
