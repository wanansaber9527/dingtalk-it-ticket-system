"use client";

// 中文注释：处理人移动端工作台，只展示当前处理人被分配的工单。

import { useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, Empty, Input, Pagination, Select, Skeleton, Space, Typography } from "antd";
import { CheckOutlined, ClockCircleOutlined, CommentOutlined, EyeOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { usePagedTickets } from "@/src/hooks/usePagedTickets";
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

const terminalStatuses = new Set(["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"]);
const todoFilter = "TODO";

export default function HandlerTicketsPage() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [overdue, setOverdue] = useState(false);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({ includeStats: "true" });
  const { tickets, total, stats, page, pageSize, loading, error, refresh, setPage, changePage } = usePagedTickets<Ticket>("/api/admin/tickets", filters);
  const applyFilters = (nextStatus: string | undefined, nextOverdue: boolean, nextKeyword = filters.keyword) => {
    setStatus(nextStatus);
    setOverdue(nextOverdue);
    setFilters({
      keyword: nextKeyword,
      status: nextStatus === todoFilter ? undefined : nextStatus,
      statusGroup: nextStatus === todoFilter ? "todo" : undefined,
      overdue: nextOverdue ? "true" : undefined,
      includeStats: "true"
    });
    setPage(1);
    refresh();
  };
  const load = () => applyFilters(status, overdue, keyword.trim());

  return (
    <EmployeeShell title="处理工单">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Card size="small">
          <div className="muted" style={{ marginBottom: 12 }}>当前搜索范围内的全部工单 · 点击筛选，再次点击取消</div>
          <Space size={10} wrap className="handler-quick-filters" role="group" aria-label="工单快捷筛选">
            <button type="button" className={`handler-stat-pill handler-stat-pill--todo${status === todoFilter ? " is-active" : ""}`} aria-pressed={status === todoFilter} onClick={() => applyFilters(status === todoFilter ? undefined : todoFilter, overdue)}>
              <ClockCircleOutlined className="handler-stat-icon" aria-hidden="true" />
              <span>待处理</span><Badge count={!stats ? "—" : stats.todo} showZero overflowCount={Number.MAX_SAFE_INTEGER} />
              <span className="handler-stat-check" aria-hidden="true"><CheckOutlined /></span>
            </button>
            <button type="button" className={`handler-stat-pill handler-stat-pill--returned${status === "RETURNED" ? " is-active" : ""}`} aria-pressed={status === "RETURNED"} onClick={() => applyFilters(status === "RETURNED" ? undefined : "RETURNED", overdue)}>
              <CommentOutlined className="handler-stat-icon" aria-hidden="true" />
              <span>待补充</span><Badge count={!stats ? "—" : stats.returned} showZero overflowCount={Number.MAX_SAFE_INTEGER} />
              <span className="handler-stat-check" aria-hidden="true"><CheckOutlined /></span>
            </button>
            <button type="button" className={`handler-stat-pill handler-stat-pill--overdue${overdue ? " is-active" : ""}`} aria-pressed={overdue} onClick={() => applyFilters(status, !overdue)}>
              <WarningOutlined className="handler-stat-icon" aria-hidden="true" />
              <span>已超时</span><Badge count={!stats ? "—" : stats.overdue} showZero overflowCount={Number.MAX_SAFE_INTEGER} />
              <span className="handler-stat-check" aria-hidden="true"><CheckOutlined /></span>
            </button>
          </Space>
          <div className="muted" style={{ marginTop: 12 }} aria-live="polite">{loading ? "正在查询…" : error ? "查询失败，请重试" : `共 ${total} 条工单符合当前筛选`}</div>
        </Card>

        <Card size="small">
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              aria-label="搜索工单编号、标题或描述" placeholder="搜索工单编号、标题或描述"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={load}
            />
            <Select
              allowClear
              aria-label="按状态筛选" placeholder="按状态筛选"
              value={status}
              onChange={(value) => applyFilters(value, overdue)}
              options={[{ value: todoFilter, label: "待处理（全部）" }, ...Object.entries(ticketStatusLabels).map(([value, label]) => ({ value, label }))]}
            />
            <Button block type="primary" icon={<SearchOutlined aria-hidden="true" />} loading={loading} onClick={load}>
              查询
            </Button>
          </Space>
        </Card>

        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {error && <Alert type="error" showIcon message={error} action={<Button onClick={refresh}>重试</Button>} />}
          {loading ? <Card><Skeleton active /></Card> : !error && tickets.length === 0 && <Empty description="没有符合筛选条件的工单" />}
          {!loading && tickets.map((ticket) => (
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
                    type={terminalStatuses.has(ticket.status) || ticket.status === "RETURNED" ? "default" : "primary"}
                    className={ticket.status === "COMPLETED" ? "handler-completed-ticket-button" : undefined}
                    icon={<EyeOutlined />}
                  >
                    {terminalStatuses.has(ticket.status) ? "查看工单" : ticket.status === "RETURNED" ? "等待发起人补充" : "进入处理"}
                  </Button>
                </Link>
              </Space>
            </Card>
          ))}
        </Space>
        <div className="list-pagination"><Pagination current={page} pageSize={pageSize} total={total} onChange={changePage} showSizeChanger={false} /></div>
      </Space>
    </EmployeeShell>
  );
}
