"use client";

// 中文注释：员工端工单通用组件，复用移动端布局和状态展示。

import { Tag } from "antd";
import type { TicketStatus } from "@prisma/client";
import { ticketStatusLabels } from "@/src/lib/labels";

const colors: Record<TicketStatus, string> = {
  PENDING: "geekblue",
  ASSIGNED: "blue",
  PROCESSING: "blue",
  COMPLETED: "success",
  CLOSED: "default",
  REJECTED: "error",
  CANCELLED: "default"
};

export function TicketStatusTag({ status }: { status: TicketStatus }) {
  return <Tag color={colors[status]}>{ticketStatusLabels[status]}</Tag>;
}
