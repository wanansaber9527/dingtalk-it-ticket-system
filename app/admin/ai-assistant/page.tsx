"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, AutoComplete, Button, Form, Input, InputNumber, Skeleton, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { CheckCircleOutlined, ExperimentOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { apiGet, apiPost, apiPut } from "@/src/lib/clientApi";
import { AI_ASSISTANT_NAME, type AiCategoryConfigDto, type AiPublicSettings } from "@/src/lib/ai";
import "@/app/ai-assistant/ai-assistant.css";

type AiStats = {
  conversations: number; messages: number; solved: number; converted: number; failed: number;
  inputTokens: number; outputTokens: number; recentErrors: { createdAt: string; message: string }[];
  dailyUsage: { date: string; count: number }[];
};
const explain = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";

function CategoryEditor({ item, onSaved }: { item: AiCategoryConfigDto; onSaved: (item: AiCategoryConfigDto) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(values: Record<string, unknown>) {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const next = await apiPut<AiCategoryConfigDto>(`/api/admin/ai/categories/${item.categoryId}`, { ...values, examples: String(values.examplesText || "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean), version: item.version });
      onSaved(next); message.success("分类提示词已保存");
    } catch (error) { message.error(explain(error)); }
    finally { busy.current = false; setSaving(false); }
  }
  return <Form name={`ai-category-${item.categoryId}`} form={form} layout="vertical" initialValues={{ ...item, examplesText: item.examples.join("\n") }} onFinish={save} disabled={saving}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><Typography.Title level={4} style={{ margin: "0 0 20px" }}>{item.categoryName}</Typography.Title><Tag className="ai-version-tag" color="purple">{item.version === 0 ? "内置规则" : `版本 ${item.version}`}</Tag></div>
    <Form.Item name="enabled" label="启用此分类的 AI 问答" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="关闭" /></Form.Item>
    <Form.Item name="prompt" label="分类前置提示词" extra="完整排障指南包括信息收集、分步排查、结果验证和转人工条件。助手按回合询问，根据用户反馈继续；固定身份和权限由系统维护。" rules={[{ required: true, whitespace: true, message: "请填写排查提示词" }]}><Input.TextArea rows={10} maxLength={12000} showCount /></Form.Item>
    <Form.Item name="environment" label="企业环境说明" extra="仅填写已确认的软件、设备及内部流程，不要放入账号密码或 API 密钥。"><Input.TextArea rows={5} maxLength={20000} /></Form.Item>
    <Form.Item name="examplesText" label="常见提问示例" extra="每行一条，最多 8 条、每条不超过 200 字。" rules={[{ validator: (_, value: string) => { const lines = String(value || "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean); return lines.length <= 8 && lines.every((v) => v.length <= 200) ? Promise.resolve() : Promise.reject(new Error("最多填写 8 条示例，每条不超过 200 字")); } }]}><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
    <Button htmlType="submit" type="primary" icon={<SaveOutlined />} loading={saving}>保存分类规则</Button>
  </Form>;
}

export default function AiAdminPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [settings, setSettings] = useState<AiPublicSettings | null>(null);
  const [categories, setCategories] = useState<AiCategoryConfigDto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [stats, setStats] = useState<AiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const busy = useRef(false);
  const loadVersion = useRef(0);
  const clearApiKey = Form.useWatch("clearApiKey", form);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    const results = await Promise.allSettled([
      apiGet<AiPublicSettings>("/api/admin/ai/settings"),
      apiGet<AiCategoryConfigDto[]>("/api/admin/ai/categories"),
      apiGet<AiStats>("/api/admin/ai/stats")
    ]);
    if (version !== loadVersion.current) return;
    if (results[0].status === "fulfilled") setSettings(results[0].value);
    else setError(explain(results[0].reason));
    if (results[1].status === "fulfilled") { const items = results[1].value; setCategories(items); setSelectedCategory((old) => items.some((item) => item.categoryId === old) ? old : items[0]?.categoryId || ""); }
    else message.error(`分类规则：${explain(results[1].reason)}`);
    if (results[2].status === "fulfilled") setStats(results[2].value);
    else message.error(`使用统计：${explain(results[2].reason)}`);
    setLoading(false);
  }, [message]);

  const invalidateLoad = useCallback(() => { loadVersion.current += 1; }, []);
  useEffect(() => { void load(); return invalidateLoad; }, [load, invalidateLoad]);
  useEffect(() => { if (settings) form.setFieldsValue({ ...settings, apiKey: "", clearApiKey: false }); }, [settings, form]);

  async function save(values: Record<string, unknown>) {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(""); setTestResult(null);
    try {
      const next = await apiPut<AiPublicSettings>("/api/admin/ai/settings", { ...values, apiKey: values.apiKey || undefined });
      setSettings(next); message.success("大模型配置已保存");
    } catch (cause) { setError(explain(cause)); }
    finally { busy.current = false; setSaving(false); }
  }

  async function testConnection() {
    if (busy.current) return;
    busy.current = true; setTesting(true); setTestResult(null);
    try { setTestResult(await apiPost<{ ok: boolean; message: string }>("/api/admin/ai/test")); }
    catch (cause) { setTestResult({ ok: false, message: explain(cause) }); }
    finally { busy.current = false; setTesting(false); }
  }

  const category = categories.find((item) => item.categoryId === selectedCategory);
  const connection = <div className="ai-admin-form">
    <Alert type={settings?.configured ? "success" : "info"} showIcon message={settings?.configured ? "已保存模型连接" : "填写模型连接后，员工即可使用 AI 问答"} description={`助手身份固定为“${AI_ASSISTANT_NAME}”。API 密钥只保存在服务端，不会返回到员工页面。`} style={{ marginBottom: 24 }} />
    <Form name="ai-model-settings" form={form} layout="vertical" onFinish={save} disabled={saving || testing}>
      <h2 className="ai-admin-section-title">模型连接</h2>
      <Form.Item name="enabled" label="启用 AI 助手问答" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="关闭" /></Form.Item>
      <Form.Item name="baseUrl" label="API 地址" extra="填写 OpenAI 兼容接口的基础地址，例如 https://api.deepseek.com。" rules={[{ required: true, message: "请填写 API 地址" }, { type: "url", message: "请填写完整的 URL" }]}><Input placeholder="https://api.deepseek.com" autoComplete="off" maxLength={2048} /></Form.Item>
      <Form.Item name="model" label="模型名称" rules={[{ required: true, whitespace: true, message: "请填写模型名称" }]}><AutoComplete options={[{ value: "deepseek-flash", label: "deepseek-flash" }, { value: "deepseek-v4-pro", label: "deepseek-v4-pro" }]} placeholder="选择或填写模型名称" filterOption={(input, option) => String(option?.value).toLowerCase().includes(input.toLowerCase())} /></Form.Item>
      <Form.Item name="apiKey" label="API Key" extra={settings?.hasApiKey ? "已保存密钥。留空保持原密钥；填写新值可替换。" : "密钥将加密保存。"}><Input.Password autoComplete="new-password" placeholder={settings?.hasApiKey ? "已配置 · 不显示原值" : "输入 API Key"} disabled={saving || testing || clearApiKey} maxLength={4096} /></Form.Item>
      {settings?.hasApiKey && <Form.Item name="clearApiKey" valuePropName="checked" label="移除已保存的密钥"><Switch checkedChildren="移除" unCheckedChildren="保留" /></Form.Item>}
      <Form.Item name="supportsVision" valuePropName="checked" label="模型支持图片理解" extra="请以当前模型的实际能力为准；启用后会将有权限的相关图片提供给模型。"><Switch checkedChildren="支持" unCheckedChildren="关闭" /></Form.Item>
      <h2 className="ai-admin-section-title">上下文与使用额度</h2>
      <div className="ai-admin-form-grid">
        <Form.Item name="contextMessages" label="保留的近期消息数" rules={[{ required: true }]}><InputNumber min={4} max={80} step={2} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="maxOutputTokens" label="单次回答最大 Token" rules={[{ required: true }]}><InputNumber min={128} max={16384} step={256} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="dailyMessageLimit" label="每人每日最大提问次数" rules={[{ required: true }]}><InputNumber min={1} max={10000} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="timeoutSeconds" label="回答超时（秒）" rules={[{ required: true }]}><InputNumber min={5} max={180} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="temperature" label="回答随机程度" rules={[{ required: true }]}><InputNumber min={0} max={2} step={0.1} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="retentionDays" label="历史记录保留期限（天）" rules={[{ required: true }]}><InputNumber min={7} max={365} style={{ width: "100%" }} /></Form.Item>
      </div>
      <h2 className="ai-admin-section-title">通用回答要求</h2>
      <Form.Item name="systemPrompt" label="补充提示词" extra="这里补充语气、排查方法和企业服务要求。固定助手身份、数据权限和提单确认规则仍由系统执行。"><Input.TextArea rows={6} maxLength={12000} /></Form.Item>
      <Space wrap><Button type="primary" htmlType="submit" loading={saving} disabled={testing} icon={<SaveOutlined />}>保存配置</Button><Button className="action-violet" loading={testing} disabled={saving || !settings?.configured} icon={<ExperimentOutlined />} onClick={() => void testConnection()}>测试已保存连接</Button><Link className="ai-text-link" href="/ai-assistant">打开 AI 助手 →</Link></Space>
      {testResult && <Alert type={testResult.ok ? "success" : "error"} showIcon message={testResult.ok ? "连接测试通过" : "连接测试未通过"} description={testResult.message} style={{ marginTop: 18 }} />}
    </Form>
  </div>;

  const categoryContent = <><Alert showIcon type="info" message="每个分类都有完整排障指南，助手按回合询问；可补充公司实际环境和处理流程。" style={{ marginBottom: 24 }} /><div className="ai-category-editor"><nav className="ai-category-editor-list" aria-label="问题分类提示词">{categories.map((item) => <button type="button" className={item.categoryId === selectedCategory ? "is-active" : ""} key={item.categoryId} onClick={() => setSelectedCategory(item.categoryId)} aria-current={item.categoryId === selectedCategory ? "true" : undefined}><span>{item.categoryName}</span><span className="ai-category-choice-state">{item.categoryId === selectedCategory ? <><CheckCircleOutlined />当前</> : item.enabled ? "已启用" : "未启用"}</span></button>)}</nav><div>{category ? <CategoryEditor key={`${category.categoryId}:${category.version}`} item={category} onSaved={(next) => setCategories((items) => items.map((item) => item.categoryId === next.categoryId ? next : item))} /> : <Alert type="info" message="请先在“分类配置”中创建问题分类。" />}</div></div></>;
  const metrics = stats ? <>
    <div className="ai-stats-grid">{[{ label: "历史会话", value: stats.conversations, tone: "brand" }, { label: "用户反馈已解决", value: stats.solved, tone: "success" }, { label: "已转工单", value: stats.converted, tone: "violet" }, { label: "调用失败", value: stats.failed, tone: "danger" }].map((item) => <div key={item.label} className={`ai-stat-${item.tone}`}><span>{item.label}</span><strong>{item.value.toLocaleString()}</strong></div>)}</div>
    <Alert type="info" showIcon message={`消息数量 ${stats.messages.toLocaleString()} · 输入 Token ${stats.inputTokens.toLocaleString()} · 输出 Token ${stats.outputTokens.toLocaleString()}`} description="用户反馈已解决属于 AI 咨询反馈，不计入人工工单完成量。Token 用量以模型接口实际返回为准。" style={{ marginBottom: 24 }} />
    <Typography.Title level={5}>近期使用情况</Typography.Title><Table size="small" rowKey="date" dataSource={stats.dailyUsage} pagination={false} locale={{ emptyText: "暂无调用记录" }} columns={[{ title: "日期", dataIndex: "date" }, { title: "调用次数", dataIndex: "count" }]} />
    <Typography.Title level={5} style={{ marginTop: 28 }}>近期失败记录</Typography.Title><Table size="small" rowKey="key" dataSource={stats.recentErrors.map((item, index) => ({ ...item, key: `${item.createdAt}-${index}` }))} pagination={{ pageSize: 5 }} locale={{ emptyText: "暂无失败记录" }} columns={[{ title: "时间", dataIndex: "createdAt", width: 190, render: (value: string) => new Date(value).toLocaleString("zh-CN") }, { title: "原因", dataIndex: "message" }]} />
  </> : <Alert message="暂无使用统计" type="info" />;

  return <>
    <div className="ai-admin-heading"><div><h1>大模型配置</h1><p>配置趣然IT工单智能助手的模型连接、分类规则与上下文。</p></div><Button icon={<ReloadOutlined />} loading={loading} disabled={saving || testing} onClick={() => void load()}>刷新</Button></div>
    {error && <Alert showIcon type="error" message={error} style={{ marginBottom: 20 }} />}
    <div className="content-band">{loading && !settings ? <Skeleton active paragraph={{ rows: 10 }} /> : <Tabs items={[{ key: "connection", label: "大模型配置", children: connection, forceRender: true }, { key: "categories", label: "分类提示词", children: categoryContent }, { key: "usage", label: "使用统计", children: metrics }]} />}</div>
  </>;
}
