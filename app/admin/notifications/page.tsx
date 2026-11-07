"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Space, Table, Typography, App as AntApp } from "antd";
import { ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { apiGet, apiPost } from "@/src/lib/clientApi";
import { notificationTypeLabels, sendStatusLabels } from "@/src/lib/labels";

type Notification = {
  id: string;
  ticketNo?: string;
  receiverName: string;
  notificationType: string;
  content: string;
  sendStatus: keyof typeof sendStatusLabels;
  errorMessage?: string;
  createdAt: string;
};

export default function NotificationsPage() {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<Notification[]>([]);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const load = useCallback(() => {
    setLoading(true);
    return apiGet<Notification[]>("/api/admin/notifications").then(setItems).catch((error) => message.error(error.message)).finally(() => setLoading(false));
  }, [message]);
  useEffect(() => { void load(); }, [load]);

  async function resend(id: string) {
    if (sendingRef.current) return;
    sendingRef.current = true; setSending(id);
    try {
      await apiPost(`/api/admin/notifications/${id}/resend`);
      message.success("已重新发送");
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    } finally { sendingRef.current = false; setSending(null); }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          通知记录
        </Typography.Title>
        <div className="muted">钉钉工作通知发送记录和失败原因</div>
      </div>
      <div className="content-band">
        <div className="toolbar">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
        </div>
        <Table
          loading={loading}
          rowKey="id"
          dataSource={items}
          scroll={{ x: 1100 }}
          columns={[
            { title: "工单编号", dataIndex: "ticketNo", width: 150, render: (value) => value || "-" },
            { title: "接收人", dataIndex: "receiverName", width: 120 },
            {
              title: "类型",
              dataIndex: "notificationType",
              width: 160,
              render: (value) => notificationTypeLabels[value as keyof typeof notificationTypeLabels] || value
            },
            { title: "内容", dataIndex: "content", width: 320 },
            { title: "状态", dataIndex: "sendStatus", width: 100, render: (value) => sendStatusLabels[value as keyof typeof sendStatusLabels] },
            { title: "失败原因", dataIndex: "errorMessage", width: 240, render: (value) => value || "-" },
            { title: "创建时间", dataIndex: "createdAt", width: 180, render: (value) => new Date(value).toLocaleString() },
            {
              title: "操作",
              width: 120,
              fixed: "right",
              render: (_, record) => (
                <Button size="small" loading={sending === record.id} disabled={sending !== null && sending !== record.id} icon={<SendOutlined />} onClick={() => resend(record.id)}>
                  重发
                </Button>
              )
            }
          ]}
        />
      </div>
    </Space>
  );
}
