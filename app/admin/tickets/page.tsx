"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Input, Select, Space, Table, Typography, App as AntApp } from "antd";
import { EyeOutlined, SearchOutlined } from "@ant-design/icons";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { apiGet } from "@/src/lib/clientApi";
import { usePagedTickets } from "@/src/hooks/usePagedTickets";
import { priorityLabels, ticketStatusLabels } from "@/src/lib/labels";

type Ticket = {
  id: string;
  ticketNo: string;
  title: string;
  categoryName: string;
  priority: keyof typeof priorityLabels;
  status: never;
  applicantName: string;
  applicantDepartment?: string;
  applicantPosition?: string;
  handlerName?: string;
  isFirstResponseOverdue: boolean;
  isResolveOverdue: boolean;
  createdAt: string;
};

type Category = { id: string; name: string };
type Handler = { dingtalkUserId: string; name: string };

export default function AdminTicketsPage() {
  const { message } = AntApp.useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [filters, setFilters] = useState<Record<string, string | boolean | undefined>>({});
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string | boolean | undefined>>({});
  const { tickets, total, page, pageSize, loading, error, refresh, setPage, changePage } = usePagedTickets<Ticket>("/api/admin/tickets", appliedFilters);
  const load = () => { setAppliedFilters({ ...filters }); setPage(1); refresh(); };
  useEffect(() => {
    Promise.allSettled([
      apiGet<Category[]>("/api/admin/categories").catch(() => apiGet<Category[]>("/api/categories")),
      apiGet<Handler[]>("/api/admin/users?role=handlers")
    ]).then(([categoryRows, handlerRows]) => {
      if (categoryRows.status === "fulfilled") setCategories(categoryRows.value);
      else message.error("分类筛选项加载失败，请刷新重试");
      if (handlerRows.status === "fulfilled") setHandlers(handlerRows.value);
      else message.error("处理人筛选项加载失败，请刷新重试");
    });
  }, [message]);

  const statusOptions = useMemo(
    () => Object.entries(ticketStatusLabels).map(([value, label]) => ({ value, label })),
    []
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          工单管理
        </Typography.Title>
        <div className="muted">查询、筛选、分派、处理与关闭工单</div>
      </div>

      <div className="content-band">
        <div className="toolbar">
          <Input
            aria-label="工单编号/标题/描述" placeholder="工单编号/标题/描述"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 220 }}
            onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
          />
          <Select
            aria-label="状态" placeholder="状态"
            allowClear
            style={{ width: 150 }}
            options={statusOptions}
            onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
          />
          <Select
            aria-label="分类" placeholder="分类"
            allowClear
            style={{ width: 170 }}
            options={categories.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => setFilters((current) => ({ ...current, categoryId: value }))}
          />
          <Input
            aria-label="申请部门" placeholder="申请部门"
            allowClear
            style={{ width: 160 }}
            onChange={(event) => setFilters((current) => ({ ...current, applicantDepartment: event.target.value }))}
          />
          <Select
            aria-label="处理人" placeholder="处理人"
            allowClear
            style={{ width: 150 }}
            options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))}
            onChange={(value) => setFilters((current) => ({ ...current, handlerUserId: value }))}
          />
          <Select
            aria-label="是否超时" placeholder="是否超时"
            allowClear
            style={{ width: 130 }}
            options={[{ value: "true", label: "已超时" }]}
            onChange={(value) => setFilters((current) => ({ ...current, overdue: value }))}
          />
          <Select
            aria-label="离职处理人工单" placeholder="全部经办状态"
            allowClear style={{ width: 170 }}
            options={[{ value: "true", label: "原处理人不可用（待转派）" }]}
            onChange={(value) => setFilters((current) => ({ ...current, needsReassignment: value }))}
          />
          <Button type="primary" icon={<SearchOutlined aria-hidden="true" />} onClick={load} loading={loading}>
            查询
          </Button>
        </div>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={refresh}>重试</Button>} />}
        <Table
          pagination={{ current: page, pageSize, total, onChange: changePage, showSizeChanger: true, showTotal: (count) => `共 ${count} 条工单` }}
          rowKey="id"
          loading={loading}
          dataSource={tickets}
          scroll={{ x: 1100 }}
          columns={[
            { title: "工单编号", dataIndex: "ticketNo", width: 150, fixed: "left" },
            { title: "标题", dataIndex: "title", width: 220 },
            { title: "状态", dataIndex: "status", render: (status) => <TicketStatusTag status={status} />, width: 130 },
            { title: "分类", dataIndex: "categoryName", width: 140 },
            { title: "紧急程度", dataIndex: "priority", render: (value) => priorityLabels[value as keyof typeof priorityLabels], width: 100 },
            { title: "申请人", dataIndex: "applicantName", width: 100 },
            { title: "部门", dataIndex: "applicantDepartment", width: 130 },
            { title: "岗位", dataIndex: "applicantPosition", width: 130, render: (value) => value || "-" },
            { title: "处理人", dataIndex: "handlerName", width: 100, render: (value) => value || "待分派" },
            {
              title: "SLA",
              width: 120,
              render: (_, row) => (row.isFirstResponseOverdue || row.isResolveOverdue ? "已超时" : "正常")
            },
            { title: "提交时间", dataIndex: "createdAt", width: 180, render: (value) => new Date(value).toLocaleString() },
            {
              title: "操作",
              width: 100,
              fixed: "right",
              render: (_, row) => (
                <Link href={`/admin/tickets/${row.id}`}>
                  <Button size="small" icon={<EyeOutlined />}>
                    查看
                  </Button>
                </Link>
              )
            }
          ]}
        />
      </div>
    </Space>
  );
}
