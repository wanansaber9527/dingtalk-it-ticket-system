// 中文注释：非钉钉环境提示页，只展示说明，不暴露工单表单和后台入口。
"use client";

import { Card, Typography } from "antd";

export default function OpenInDingTalkPage() {
  return (
    <main className="mobile-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <Card style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          请在钉钉客户端内打开
        </Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 0, color: "#68788a" }}>
          请在钉钉客户端内打开本页面后再提交工单。
        </Typography.Paragraph>
      </Card>
    </main>
  );
}
