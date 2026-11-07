"use client";

import { Select, App as AntApp } from "antd";
import { useState } from "react";
import { apiPost } from "@/src/lib/clientApi";

export function LocalTestIdentity({ userId }: { userId?: string }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO !== "true") return null;
  async function switchIdentity(id: string) {
    setLoading(true);
    try {
      await apiPost("/api/dev/session", { userId: id });
      window.location.href = id === "local-admin" ? "/admin" : id === "local-handler" ? "/handler/tickets" : "/tickets/new";
    } catch (error) {
      message.error(error instanceof Error ? error.message : "切换失败");
      setLoading(false);
    }
  }
  return (
    <div className="local-test-control">
      <span className="local-test-dot" />
      <span>本地体验</span>
      <Select aria-label="切换本地测试身份" placeholder="加载中" value={userId} loading={loading || !userId} disabled={loading || !userId} onChange={switchIdentity} size="small" options={[
        { value: "local-admin", label: "管理员" },
        { value: "local-handler", label: "处理人" },
        { value: "local-employee", label: "员工" }
      ]} />
    </div>
  );
}
