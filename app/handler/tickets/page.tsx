"use client";

// 中文注释：处理人移动端工作台，只展示当前处理人被分配的工单。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Empty, Input, Select, Space, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { apiGet } from "@/src/lib/clientApi";
import { priorityLabels, ticketStatusLabels } from "@/src/lib/labels";

type Ticket = {
  id: string;
  ticketNo: string;
  title: string;
  categoryName: string;
  priority: keyof typeof priorityLabels;
  status: keyof typeof ticketStatusLabels;
  applicantName: string;
  applicantDepartment?: string;
  isFirstResponseOverdue: boolean;
  isResolveOverdue: boolean;
  createdAt: string;
  updatedAt: string;
  slaResolveDeadline?: string;
};

const todoStatuses = new Set(["PENDING", "ASSIGNED", "PROCESSING"]);

export default function HandlerTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (keyword.trim()) query.set("keyword", keyword.trim());
      if (status) query.set("status", status);
      setTickets(await apiGet<Ticket[]>(`/api/admin/tickets?${query.toString()}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const todo = tickets.filter((ticket) => todoStatuses.has(ticket.status)).length;
    const overdue = tickets.filter((ticket) => ticket.isFirstResponseOverdue || ticket.isResolveOverdue).length;
    return { todo, overdue };
  }, [tickets]);

  return (
    <EmployeeShell title="处理工单">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Card size="small">
          <Space size={10} wrap>
            <Badge count={stats.todo} showZero color="#007CBE">
              <span className="handler-stat-pill">待处理</span>
            </Badge>
            <Badge count={stats.overdue} showZero color="#ff4d4f">
              <span className="handler-stat-pill">已超时</span>
            </Badge>
          </Space>
        </Card>

        <Card size="small">
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索工单编号、标题或描述"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={load}
            />
            <Select
              allowClear
              placeholder="按状态筛选"
              value={status}
              onChange={setStatus}
              options={Object.entries(ticketStatusLabels).map(([value, label]) => ({ value, label }))}
            />
            <Button block icon={<ReloadOutlined />} loading={loading} onClick={load}>
              查询
            </Button>
          </Space>
        </Card>

        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {tickets.length === 0 && <Empty description={loading ? "正在加载" : "暂无分配给你的工单"} />}
          {tickets.map((ticket) => (
            <Card key={ticket.id} size="small" className="ticket-work-card">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
                  <Typography.Text strong>{ticket.ticketNo}</Typography.Text>
                  <TicketStatusTag status={ticket.status as never} />
                </Space>
                <Typography.Text strong>{ticket.title}</Typography.Text>
                <div className="muted">
                  {ticket.categoryName} · {priorityLabels[ticket.priority]} · {ticket.applicantName}
                  {ticket.applicantDepartment ? `（${ticket.applicantDepartment}）` : ""}
                </div>
                <div className="muted">提交时间：{new Date(ticket.createdAt).toLocaleString()}</div>
                <div className="muted">预计处理时间：{ticket.slaResolveDeadline ? new Date(ticket.slaResolveDeadline).toLocaleString() : "-"}</div>
                {(ticket.isFirstResponseOverdue || ticket.isResolveOverdue) && <Typography.Text type="danger">该工单已超时，请优先处理</Typography.Text>}
                <Link href={`/handler/tickets/${ticket.id}`}>
                  <Button
                    block
                    type={ticket.status === "COMPLETED" ? "default" : "primary"}
                    className={ticket.status === "COMPLETED" ? "handler-completed-ticket-button" : undefined}
                    icon={<EyeOutlined />}
                  >
                    {ticket.status === "COMPLETED" ? "查看已完结工单" : "进入处理"}
                  </Button>
                </Link>
              </Space>
            </Card>
          ))}
        </Space>
      </Space>
    </EmployeeShell>
  );
}
