"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { Card, Col, Row, Segmented, Space, Table, Typography, message } from "antd";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/src/lib/clientApi";

type Dashboard = {
  cards: {
    todayNew: number;
    weekNew: number;
    monthNew: number;
    total: number;
    pending: number;
    assigned: number;
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

const statusColors = ["#8bb7e8", "#66a9d5", "#33b8a3", "#7bc96f", "#ff9f43"];
const barColors = ["#007cbe", "#4aa3df", "#6ac9b8", "#8fcf77", "#f3c969", "#e99b78", "#b0a7e8", "#8aa0b5"];

export default function AdminDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [mode, setMode] = useState<"classic" | "graphic">("classic");

  useEffect(() => {
    apiGet<Dashboard>("/api/admin/dashboard").then(setData).catch((error) => message.error(error.message));
  }, []);

  const cards = data?.cards;
  const satisfaction = cards?.satisfaction;
  const pendingTotal = (cards?.pending || 0) + (cards?.assigned || 0) + (cards?.processing || 0);
  const statusChartData = [
    { name: "待受理", value: cards?.pending || 0 },
    { name: "已分派", value: cards?.assigned || 0 },
    { name: "处理中", value: cards?.processing || 0 },
    { name: "已完成", value: cards?.completed || 0 },
    { name: "已超时", value: cards?.overdue || 0 }
  ].filter((item) => item.value > 0);
  const categoryChartData = data?.rankings.category || [];
  const handlerChartData = data?.rankings.handler || [];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div className="dashboard-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            首页看板
          </Typography.Title>
          <div className="muted">工单处理概览、SLA与满意度趋势</div>
        </div>
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as "classic" | "graphic")}
          options={[
            { label: "原样式", value: "classic" },
            { label: "图形化样式", value: "graphic" }
          ]}
        />
      </div>

      {mode === "classic" ? (
        <>
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
        </>
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div className="graphic-stat-grid">
            {[
              ["工单总数", cards?.total || 0, "全部历史工单"],
              ["待处理", pendingTotal, "待受理 / 已分派 / 处理中"],
              ["处理中", cards?.processing || 0, "正在处理的工单"],
              ["已完成", cards?.completed || 0, "已完成和已关闭"],
              ["超时/逾期", cards?.overdue || 0, "首响或处理超时"]
            ].map(([label, value, desc]) => (
              <div className="graphic-stat-card" key={label}>
                <div>
                  <div className="graphic-stat-label">{label}</div>
                  <div className="graphic-stat-desc">{desc}</div>
                </div>
                <div className="graphic-stat-value">{value}</div>
              </div>
            ))}
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Card title="工单状态分布" className="graphic-chart-card">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={3}>
                      {statusChartData.map((item, index) => (
                        <Cell key={item.name} fill={statusColors[index % statusColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} 个`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="chart-legend">
                  {statusChartData.map((item, index) => (
                    <span key={item.name}>
                      <i style={{ background: statusColors[index % statusColors.length] }} />
                      {item.name} {item.value}
                    </span>
                  ))}
                </div>
              </Card>
            </Col>
            <Col xs={24} xl={14}>
              <Card title="各分类工单数量" className="graphic-chart-card">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryChartData} margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0, 72, 115, 0.09)" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                    <Tooltip formatter={(value) => [`${value} 个`, "工单量"]} />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                      {categoryChartData.map((item, index) => (
                        <Cell key={item.name} fill={barColors[index % barColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24}>
              <Card title="各执行人工单处理数量" className="graphic-chart-card">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={handlerChartData} layout="vertical" margin={{ top: 10, right: 28, bottom: 10, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0, 72, 115, 0.09)" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={90} />
                    <Tooltip formatter={(value) => [`${value} 个`, "工单量"]} />
                    <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="#007cbe" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </Row>
        </Space>
      )}
    </Space>
  );
}
