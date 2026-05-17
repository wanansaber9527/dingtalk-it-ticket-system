"use client";

// 中文注释：员工端工单页面，提供提交、查看和确认评价等移动端体验。

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Empty, List, Space, Typography, message } from "antd";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { apiGet } from "@/src/lib/clientApi";

type Ticket = {
  id: string;
  ticketNo: string;
  title: string;
  status: never;
  handlerName?: string;
  createdAt: string;
  updatedAt: string;
};

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    apiGet<Ticket[]>("/api/tickets/my").then(setTickets).catch((error) => message.error(error.message));
  }, []);

  return (
    <EmployeeShell title="我的工单">
      {tickets.length === 0 ? (
        <Empty description="暂无工单" />
      ) : (
        <List
          dataSource={tickets}
          renderItem={(ticket) => (
            <List.Item style={{ padding: "8px 0" }}>
              <Link href={`/tickets/${ticket.id}`} style={{ width: "100%" }}>
                <Card size="small">
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                      <Typography.Text strong>{ticket.ticketNo}</Typography.Text>
                      <TicketStatusTag status={ticket.status} />
                    </Space>
                    <Typography.Text>{ticket.title}</Typography.Text>
                    <div className="muted">
                      处理人：{ticket.handlerName || "待分派"} · 更新时间：{new Date(ticket.updatedAt).toLocaleString()}
                    </div>
                  </Space>
                </Card>
              </Link>
            </List.Item>
          )}
        />
      )}
    </EmployeeShell>
  );
}
