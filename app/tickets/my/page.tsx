"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Empty, List, Pagination, Skeleton, Space, Tabs } from "antd";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { usePagedTickets } from "@/src/hooks/usePagedTickets";
import type { ticketStatusLabels } from "@/src/lib/labels";
type Ticket = { id: string; ticketNo: string; title: string; status: keyof typeof ticketStatusLabels; handlerName?: string; updatedAt: string };
type TicketScope = "mine" | "cc";

export default function MyTicketsPage() {
  const [scope, setScope] = useState<TicketScope>("mine");
  return <EmployeeShell title="我的工单">
    <Tabs activeKey={scope} onChange={value => setScope(value as TicketScope)} items={[
      { key: "mine", label: "我发起的" },
      { key: "cc", label: "抄送我的" }
    ]} />
    <TicketList key={scope} scope={scope} />
  </EmployeeShell>;
}

function TicketList({ scope }: { scope: TicketScope }) {
  // 切换标签时重新挂载列表，清空旧页及旧请求，避免跨标签显示上一页工单。
  const { tickets, total, page, pageSize, loading, error, refresh, changePage } = usePagedTickets<Ticket>("/api/tickets/my", { scope });
  return <>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={refresh}>重试</Button>} />}
    {loading ? <Card><Skeleton active paragraph={{ rows: 5 }} /></Card> : !error && !tickets.length ? <Empty description={scope === "cc" ? "暂无抄送给你的工单" : "暂无你发起的工单"} /> : <List dataSource={tickets} renderItem={ticket => <List.Item style={{ padding: "8px 0" }}>
      <Link href={`/tickets/${ticket.id}`} className="ticket-card-link"><Card>
        <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}><span className="ticket-number">{ticket.ticketNo}</span><TicketStatusTag status={ticket.status} /></Space>
        <div className="ticket-title">{ticket.title}</div>
        <div className="muted">处理人：{ticket.handlerName || "待分派"}</div>
        <div className="muted">更新于 {new Date(ticket.updatedAt).toLocaleString("zh-CN")}</div>
      </Card></Link>
    </List.Item>} />}
    <div className="list-pagination"><Pagination current={page} pageSize={pageSize} total={total} onChange={changePage} showSizeChanger={false} showTotal={count => `共 ${count} 条`} /></div>
  </>;
}
