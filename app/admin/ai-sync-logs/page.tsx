"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { Button, Modal, Space, Table, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { apiGet, apiPost } from "@/src/lib/clientApi";

type SyncLog = {
  id: string;
  ticketNo?: string;
  operationType: string;
  requestPayload?: string;
  responsePayload?: string;
  status: string;
  errorMessage?: string;
  createdAt: string;
};

export default function AiSyncLogsPage() {
  const [items, setItems] = useState<SyncLog[]>([]);
  const [detail, setDetail] = useState<SyncLog | null>(null);

  const load = () => {
    apiGet<SyncLog[]>("/api/admin/ai-sync-logs").then(setItems).catch((error) => message.error(error.message));
  };

  useEffect(load, []);

  async function retry(id?: string) {
    try {
      if (id) {
        await apiPost(`/api/admin/ai-sync-logs/${id}/retry`);
      } else {
        await apiPost("/api/admin/ai-sync-logs");
      }
      message.success("已触发重试");
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重试失败");
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          AI表格同步日志
        </Typography.Title>
        <div className="muted">同步请求、响应、失败原因与重试</div>
      </div>
      <div className="content-band">
        <div className="toolbar">
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={() => retry()}>
            批量重试失败
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={items}
          scroll={{ x: 1100 }}
          columns={[
            { title: "工单编号", dataIndex: "ticketNo", width: 150, render: (value) => value || "-" },
            { title: "操作", dataIndex: "operationType", width: 160 },
            { title: "状态", dataIndex: "status", width: 100 },
            { title: "错误", dataIndex: "errorMessage", width: 280, render: (value) => value || "-" },
            { title: "时间", dataIndex: "createdAt", width: 180, render: (value) => new Date(value).toLocaleString() },
            {
              title: "操作",
              width: 180,
              fixed: "right",
              render: (_, record) => (
                <Space>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)} />
                  <Button size="small" icon={<SyncOutlined />} onClick={() => retry(record.id)}>
                    重试
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </div>
      <Modal width={780} title="同步详情" open={Boolean(detail)} onCancel={() => setDetail(null)} footer={null}>
        <Typography.Text strong>请求参数</Typography.Text>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f6f7f9", padding: 12, borderRadius: 8 }}>{detail?.requestPayload || "-"}</pre>
        <Typography.Text strong>返回结果</Typography.Text>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f6f7f9", padding: 12, borderRadius: 8 }}>{detail?.responsePayload || detail?.errorMessage || "-"}</pre>
      </Modal>
    </Space>
  );
}
