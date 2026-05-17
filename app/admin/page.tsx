"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { Card, Col, Row, Space, Table, Typography, message } from "antd";
import { apiGet } from "@/src/lib/clientApi";

type Dashboard = {
  cards: {
    todayNew: number;
    weekNew: number;
    monthNew: number;
    pending: number;
    processing: number;
    completed: number;
    overdue: number;
    firstResponseOverdueRate: number;
    resolveOverdueRate: number;
    averageFirstResponseMinutes: number;
    averageResolveMinutes: number;
    satisfaction: { satisfied: number; normal: number; unsatisfied: number };
  };
  rankings: {
    category: Array<{ name: string; count: number }>;
    department: Array<{ name: string; count: number }>;
    handler: Array<{ name: string; count: number }>;
    handlerAverageResolve: Array<{ handlerName: string; averageMinutes: number }>;
  };
};

function minutesText(value: number) {
  if (!value) return "0分钟";
  if (value < 60) return `${value}分钟`;
  return `${Math.round((value / 60) * 10) / 10}小时`;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    apiGet<Dashboard>("/api/admin/dashboard").then(setData).catch((error) => message.error(error.message));
  }, []);

  const cards = data?.cards;
  const satisfaction = cards?.satisfaction;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          首页看板
        </Typography.Title>
        <div className="muted">IT工单处理概览、SLA与满意度趋势</div>
      </div>

      <div className="metric-grid">
        {[
          ["今日新增", cards?.todayNew],
          ["本周新增", cards?.weekNew],
          ["本月新增", cards?.monthNew],
          ["待受理", cards?.pending],
          ["处理中", cards?.processing],
          ["已完成/关闭", cards?.completed],
          ["已超时", cards?.overdue],
          ["首响超时率", `${cards?.firstResponseOverdueRate || 0}%`],
          ["完成超时率", `${cards?.resolveOverdueRate || 0}%`],
          ["平均首响", minutesText((cards?.averageFirstResponseMinutes as number) || 0)],
          ["平均处理", minutesText((cards?.averageResolveMinutes as number) || 0)],
          [
            "满意度",
            satisfaction
              ? `满意${satisfaction.satisfied} / 一般${satisfaction.normal} / 不满意${satisfaction.unsatisfied}`
              : "0"
          ]
        ].map(([label, value]) => (
          <div className="metric-card" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value" style={{ fontSize: String(value).length > 8 ? 18 : 26 }}>
              {String(value ?? 0)}
            </div>
          </div>
        ))}
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="问题分类排行">
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={data?.rankings.category || []}
              columns={[
                { title: "分类", dataIndex: "name" },
                { title: "工单量", dataIndex: "count", width: 100 }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="处理人工单量排行">
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={data?.rankings.handler || []}
              columns={[
                { title: "处理人", dataIndex: "name" },
                { title: "工单量", dataIndex: "count", width: 100 }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="部门工单量排行">
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={data?.rankings.department || []}
              columns={[
                { title: "部门", dataIndex: "name" },
                { title: "工单量", dataIndex: "count", width: 100 }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="处理人平均完成时长">
            <Table
              size="small"
              rowKey="handlerName"
              pagination={false}
              dataSource={data?.rankings.handlerAverageResolve || []}
              columns={[
                { title: "处理人", dataIndex: "handlerName" },
                { title: "平均完成", dataIndex: "averageMinutes", render: minutesText, width: 120 }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
