"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Form, Input, Select, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { apiGet } from "@/src/lib/clientApi";
import { directorySyncActionLabels as actionLabels, type DirectorySyncItemDto, type DirectorySyncDetailDto, type DirectorySyncLogPageDto } from "@/src/lib/directorySync";
import { DirectoryRunStatus, directoryTime, type DirectoryRun } from "./DirectorySyncPanel";

type Filters = { keyword?: string; status?: string; from?: string; to?: string };
type SyncItem = DirectorySyncItemDto;
type RunDetail = DirectorySyncDetailDto;
type RunList = DirectorySyncLogPageDto;

const fieldLabels: Record<string, string> = { name: "姓名", mobile: "手机号", departmentId: "部门编号", departmentName: "部门", position: "职位", avatar: "头像", dingtalkUserId: "钉钉账号", employmentStatus: "在职状态", status: "账号状态" };

function changesText(item: SyncItem) {
  if (item.changes) return item.changes.map((field) => fieldLabels[field] || field).join("、") || "—";
  try {
    const fields: unknown = item.changesJson ? JSON.parse(item.changesJson) : null;
    return Array.isArray(fields) ? fields.filter((field) => typeof field === "string").map((field) => fieldLabels[field] || field).join("、") || "—" : "—";
  } catch { return "—"; }
}

export function DirectorySyncLogs() {
  const [form] = Form.useForm<Filters>();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<RunList>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++listVersion.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(filters)) if (value?.trim()) params.set(key, value.trim());
    try {
      const result = await apiGet<RunList>(`/api/admin/users/sync-logs?${params}`);
      if (version !== listVersion.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (version === listVersion.current) { setData({ items: [], total: 0, page, pageSize }); setError(cause instanceof Error ? cause.message : "同步日志加载失败"); }
    } finally { if (version === listVersion.current) setLoading(false); }
  }, [filters, page, pageSize]);

  const loadDetail = useCallback(async (id: string) => {
    const version = ++detailVersion.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await apiGet<RunDetail>(`/api/admin/users/sync-logs/${encodeURIComponent(id)}`);
      if (version === detailVersion.current) setDetail(result);
    } catch (cause) {
      if (version === detailVersion.current) { setDetail(null); setDetailError(cause instanceof Error ? cause.message : "同步明细加载失败"); }
    } finally { if (version === detailVersion.current) setDetailLoading(false); }
  }, []);

  useEffect(() => { void load(); return () => { listVersion.current += 1; }; }, [load]);
  useEffect(() => { const runId = new URLSearchParams(window.location.search).get("runId"); if (runId) setSelected(runId); }, []);
  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    void loadDetail(selected);
    return () => { detailVersion.current += 1; };
  }, [selected, loadDetail]);
  useEffect(() => {
    if (!selected || detail?.status !== "RUNNING") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadDetail(selected); }, 10000);
    return () => window.clearInterval(timer);
  }, [selected, detail?.status, loadDetail]);

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <div><Typography.Title level={3} style={{ margin: 0 }}>人员同步日志</Typography.Title><Typography.Text type="secondary">查看每次自动或手动同步的结果及人员变化。时间均为北京时间。</Typography.Text></div>
    <div className="content-band">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space wrap><Link href="/admin/users"><Button>返回人员管理</Button></Link><Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新日志</Button></Space>
        <Form form={form} layout="vertical" onFinish={(values) => { setPage(1); setFilters({ ...values }); }} style={{ display: "flex", flexWrap: "wrap", gap: "0 12px", alignItems: "flex-start" }}>
          <Form.Item name="keyword" label="人员" style={{ marginBottom: 12, flex: "1 1 200px", maxWidth: 300 }}><Input allowClear placeholder="姓名或钉钉 userId" /></Form.Item>
          <Form.Item name="status" label="执行结果" style={{ marginBottom: 12, width: 160 }}><Select allowClear placeholder="全部结果" options={[{ value: "RUNNING", label: "运行中" }, { value: "SUCCESS", label: "成功" }, { value: "PARTIAL", label: "部分成功" }, { value: "FAILED", label: "失败" }]} /></Form.Item>
          <Form.Item name="from" label="开始日期" style={{ marginBottom: 12 }}><Input type="date" /></Form.Item>
          <Form.Item name="to" label="结束日期" dependencies={["from"]} rules={[({ getFieldValue }) => ({ validator: (_, value) => !value || !getFieldValue("from") || value >= getFieldValue("from") ? Promise.resolve() : Promise.reject(new Error("结束日期不能早于开始日期")) })]} style={{ marginBottom: 12 }}><Input type="date" /></Form.Item>
          <Form.Item label=" " style={{ marginBottom: 12 }}><Space><Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>查询</Button><Button onClick={() => { form.resetFields(); setPage(1); setFilters({}); }}>重置</Button></Space></Form.Item>
        </Form>
        {error ? <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
        <Table<DirectoryRun> rowKey="id" loading={loading} dataSource={data.items} scroll={{ x: 1240 }} locale={{ emptyText: error ? "日志加载失败" : "暂无符合条件的同步记录" }} pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 条`, onChange: (next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); } }} columns={[
          { title: "开始时间", dataIndex: "startedAt", width: 190, render: directoryTime },
          { title: "触发方式", dataIndex: "trigger", width: 100, render: (value: string) => value === "MANUAL" ? "手动同步" : value === "AUTO" || value === "SCHEDULED" ? "自动同步" : value },
          { title: "结果", dataIndex: "status", width: 110, render: (status: string) => <DirectoryRunStatus status={status} /> },
          { title: "读取人数", dataIndex: "total", width: 90 },
          { title: "新增", dataIndex: "createdCount", width: 70 }, { title: "更新", dataIndex: "updatedCount", width: 70 },
          { title: "离职归档", dataIndex: "departedCount", width: 90 }, { title: "返聘恢复", dataIndex: "restoredCount", width: 90 },
          { title: "待核实", dataIndex: "pendingCount", width: 90, render: (count: number) => count ? <Tag color="warning">{count}</Tag> : 0 },
          { title: "失败", dataIndex: "failedCount", width: 70, render: (count: number) => count ? <Tag color="error">{count}</Tag> : 0 },
          { title: "结束时间", dataIndex: "finishedAt", width: 190, render: directoryTime },
          { title: "操作", key: "actions", width: 100, fixed: "right", render: (_, run) => <Button size="small" onClick={() => setSelected(run.id)}>查看明细</Button> }
        ]} />
      </Space>
    </div>
    <Drawer title="同步明细" open={selected !== null} onClose={() => { setSelected(null); setDetail(null); detailVersion.current += 1; }} width={960} extra={<Button onClick={() => { if (selected) void loadDetail(selected); }} loading={detailLoading}>刷新</Button>}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {detailError ? <Alert type="error" showIcon message={detailError} action={<Button size="small" onClick={() => { if (selected) void loadDetail(selected); }}>重试</Button>} /> : null}
        {detail ? <>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
            { key: "status", label: "结果", children: <DirectoryRunStatus status={detail.status} /> }, { key: "started", label: "开始时间", children: directoryTime(detail.startedAt) },
            { key: "finished", label: "结束时间", children: directoryTime(detail.finishedAt) }, { key: "total", label: "读取人数", children: detail.total },
            { key: "unchanged", label: "资料无变化", children: detail.unchangedCount }, { key: "failed", label: "失败人数", children: detail.failedCount }
          ]} />
          {detail.errorMessage ? <Alert type={detail.status === "FAILED" ? "error" : "warning"} showIcon message={detail.errorMessage} /> : null}
        </> : null}
        <Table<SyncItem> size="small" rowKey="id" loading={detailLoading} dataSource={detail?.items || []} scroll={{ x: 860 }} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: detailError ? "明细加载失败" : "暂无人员变化记录" }} columns={[
          { title: "姓名", dataIndex: "name", width: 110, render: (value: string) => value || "—" },
          { title: "钉钉 userId", dataIndex: "externalUserId", width: 180, render: (value: string) => value || "—" },
          { title: "操作", dataIndex: "action", width: 100, render: (value: string) => <Tag color={value === "FAILED" ? "error" : value === "PENDING" ? "warning" : "default"}>{actionLabels[value] || value}</Tag> },
          { title: "变更字段", key: "changes", width: 180, render: (_, item) => changesText(item) },
          { title: "说明 / 失败原因", dataIndex: "errorMessage", width: 260, render: (value: string) => value || "—" },
          { title: "核实人员", key: "person", width: 110, render: (_, item) => item.externalUserId && item.action === "PENDING" ? <Link href={`/admin/users?keyword=${encodeURIComponent(item.externalUserId)}`}>前往核实</Link> : "—" }
        ]} />
      </Space>
    </Drawer>
  </Space>;
}
