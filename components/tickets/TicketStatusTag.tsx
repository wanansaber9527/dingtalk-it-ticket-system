"use client";

// 中文注释：员工端工单通用组件，复用移动端布局和状态展示。

import { Tag } from "antd";
import type { CSSProperties } from "react";
import type { TicketStatus } from "@prisma/client";
import { ticketStatusLabels } from "@/src/lib/labels";

const styles: Record<TicketStatus, CSSProperties> = {
  PENDING: { color: "#15803d", background: "#ecfdf3", borderColor: "#86efac" },
  ASSIGNED: { color: "#0e7490", background: "#ecfeff", borderColor: "#a5f3fc" },
  PROCESSING: { color: "#2563eb", background: "#eff6ff", borderColor: "#bfdbfe" },
  RETURNED: { color: "#b45309", background: "#fffbeb", borderColor: "#fde68a" },
  COMPLETED: { color: "#15803d", background: "#f0fdf4", borderColor: "#bbf7d0" },
  CLOSED: { color: "#64748b", background: "#f8fafc", borderColor: "#e2e8f0" },
  REJECTED: { color: "#b91c1c", background: "#fef2f2", borderColor: "#fecaca" },
  CANCELLED: { color: "#64748b", background: "#f8fafc", borderColor: "#e2e8f0" }
};

export function TicketStatusTag({ status }: { status: TicketStatus }) {
  return <Tag style={{ borderRadius: 999, fontWeight: 500, ...styles[status] }}>{ticketStatusLabels[status]}</Tag>;
}
