"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Descriptions, Form, InputNumber, Space, Switch, Tag, Typography } from "antd";
import { HistoryOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import { apiGet, apiPost, apiPut } from "@/src/lib/clientApi";

import { DIRECTORY_SYNC_DEFAULT_INTERVAL, DIRECTORY_SYNC_MIN_INTERVAL, DIRECTORY_SYNC_MAX_INTERVAL, type DirectorySyncRunDto, type DirectorySyncSettingsDto, type DirectorySyncResult } from "@/src/lib/directorySync";

export type DirectoryRun = DirectorySyncRunDto;
type SyncSettings = DirectorySyncSettingsDto;

export function directoryTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function DirectoryRunStatus({ status }: { status: string }) {
  const states: Record<string, [string, string]> = {
    RUNNING: ["运行中", "processing"], SUCCESS: ["成功", "success"],
    PARTIAL: ["部分成功", "warning"], FAILED: ["失败", "error"]
  };
  const [label, color] = states[status] || [status, "default"];
  return <Tag color={color}>{label}</Tag>;
}

export function DirectorySyncPanel({ onSynchronized, disabled = false }: { onSynchronized: () => Promise<void>; disabled?: boolean }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ enabled: boolean; intervalMinutes: number }>();
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const requestVersion = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const result = await apiGet<SyncSettings>("/api/admin/users/sync-settings");
      if (!alive.current || version !== requestVersion.current) return;
      setSettings(result);
      setError(null);
      if (!dirtyRef.current) form.setFieldsValue({ enabled: result.enabled, intervalMinutes: result.intervalMinutes });
    } catch (cause) {
      if (alive.current && version === requestVersion.current) setError(cause instanceof Error ? cause.message : "同步设置加载失败");
    } finally {
      if (alive.current && version === requestVersion.current) setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    // 此处只刷新显示；人员同步由服务器独立调度。
    const timer = window.setInterval(() => {
      if (!busyRef.current && document.visibilityState === "visible") void refresh(true);
    }, 15000);
    return () => { alive.current = false; requestVersion.current += 1; window.clearInterval(timer); };
  }, [refresh]);

  async function save(values: { enabled: boolean; intervalMinutes: number }) {
    if (disabled || busyRef.current || !settings) return;
    busyRef.current = true;
    setBusy("save");
    requestVersion.current += 1;
    try {
      await apiPut("/api/admin/users/sync-settings", values);
      dirtyRef.current = false;
      message.success("同步设置已保存");
      await refresh(true);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "设置保存失败");
    } finally { busyRef.current = false; if (alive.current) setBusy(null); }
  }

  async function synchronize() {
    if (disabled || busyRef.current || !settings || settings.running) return;
    busyRef.current = true;
    setBusy("sync");
    try {
      const result = await apiPost<DirectorySyncResult>("/api/admin/users/sync-dingtalk");
      if (result.status === "SUCCESS") message.success(`同步完成：新增 ${result.createdCount} 人，更新 ${result.updatedCount} 人`);
      else message.warning("本次同步有待核实或失败项目，请查看同步日志");
      await Promise.all([refresh(true), onSynchronized()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "同步失败，请查看日志后重试");
      await refresh(true);
    } finally { busyRef.current = false; if (alive.current) setBusy(null); }
  }

  const locked = disabled || loading || busy !== null;
  return <section className="content-band" aria-label="钉钉人员自动同步" aria-busy={loading || busy !== null}>
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <div><Typography.Title level={4} style={{ margin: 0 }}>人员自动同步</Typography.Title><Typography.Text type="secondary">服务器按设定间隔执行，无需打开本页面。时间均为北京时间。</Typography.Text></div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading} disabled={busy !== null}>刷新状态</Button>
          <Link href="/admin/users/sync-logs"><Button icon={<HistoryOutlined />}>查看日志</Button></Link>
        </Space>
      </Space>
      {error ? <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()} disabled={busy !== null}>重试</Button>} /> : null}
      <Form form={form} layout="inline" initialValues={{ enabled: true, intervalMinutes: DIRECTORY_SYNC_DEFAULT_INTERVAL }} onFinish={save} onValuesChange={() => { dirtyRef.current = true; }} disabled={locked || !settings} style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <Form.Item name="enabled" label="自动同步" valuePropName="checked" style={{ margin: 0 }}><Switch checkedChildren="开启" unCheckedChildren="关闭" aria-label="开启自动同步" /></Form.Item>
        <Form.Item name="intervalMinutes" label="同步间隔（分钟）" rules={[{ required: true, message: "请输入同步间隔" }, { type: "integer", min: DIRECTORY_SYNC_MIN_INTERVAL, max: DIRECTORY_SYNC_MAX_INTERVAL, message: "请输入 5 至 1440 的整数" }]} style={{ margin: 0 }}><InputNumber min={DIRECTORY_SYNC_MIN_INTERVAL} max={DIRECTORY_SYNC_MAX_INTERVAL} precision={0} style={{ width: 120 }} /></Form.Item>
        <Form.Item style={{ margin: 0 }}><Button htmlType="submit" loading={busy === "save"}>保存设置</Button></Form.Item>
        <Button type="primary" icon={<SyncOutlined />} loading={busy === "sync" || settings?.running} disabled={locked || !settings || settings.running} onClick={() => void synchronize()}>立即同步</Button>
      </Form>
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} items={[
        { key: "state", label: "当前状态", children: settings ? (settings.running || busy === "sync" ? <Tag color="processing">同步中</Tag> : <Tag>{settings.enabled ? "已开启" : "已暂停"}</Tag>) : "—" },
        { key: "success", label: "最近成功", children: settings?.lastSuccessAt ? directoryTime(settings.lastSuccessAt) : "暂无成功记录" },
        { key: "next", label: "下次执行", children: settings?.enabled ? directoryTime(settings.nextRunAt) : "自动同步已暂停" }
      ]} />
      {settings?.lastRun ? <Space wrap><Typography.Text type="secondary">最近一轮：</Typography.Text><DirectoryRunStatus status={settings.lastRun.status} /><Typography.Text>{directoryTime(settings.lastRun.startedAt)}</Typography.Text><Link href={`/admin/users/sync-logs?runId=${encodeURIComponent(settings.lastRun.id)}`}>查看明细</Link></Space> : null}
      {busy === "sync" || settings?.running ? <Typography.Text role="status" type="secondary">正在读取通讯录并核对人员变化，请勿重复执行。任务结果会保存在同步日志中。</Typography.Text> : null}
    </Space>
  </section>;
}
