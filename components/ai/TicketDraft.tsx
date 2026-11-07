"use client";

import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Alert, App, Button, Form, Image, Input, Select, Space, Tag } from "antd";
import { CheckCircleOutlined, FileTextOutlined, SendOutlined } from "@ant-design/icons";
import type { AiCategory, AiConversationDto, AiDraftDto } from "@/src/lib/ai";
import { apiGet, apiPost, apiPut } from "@/src/lib/clientApi";

export function TicketDraft({ draft, conversationId, categories, onChange, onBusyChange, confirmRef, disabled = false }: {
  draft: AiDraftDto; conversationId: string; categories: AiCategory[]; onChange: (draft: AiDraftDto) => void; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void; confirmRef?: Ref<{ submit: () => Promise<boolean> }>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState(draft.attachments);
  const busy = useRef(false);
  useEffect(() => { if (!draft.ticketId) { form.setFieldsValue(draft); setAttachments(draft.attachments); } }, [draft, form]);

  async function submit() {
    if (busy.current || disabled || draft.ticketId) return false;
    busy.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError("");
    try {
      const values = await form.validateFields().catch(() => null);
      if (!values) return false;
      const saved = await apiPut<AiDraftDto>(`/api/ai/conversations/${conversationId}/draft`, { ...values, attachments, version: draft.version });
      // Keep the latest optimistic version locally if the subsequent submit fails.
      onChange(saved);
      const result = await apiPost<{ ticket: { id: string; ticketNo: string }; draft: AiDraftDto }>(`/api/ai/conversations/${conversationId}/submit`, { draftId: saved.id, version: saved.version });
      onChange({ ...result.draft, ticketId: result.ticket.id, ticketNo: result.ticket.ticketNo });
      message.success(`工单已提交：${result.ticket.ticketNo}`);
      return true;
    } catch (cause) {
      // A lost submit response is ambiguous: check the saved draft before allowing a retry.
      const latest = await apiGet<AiConversationDto>(`/api/ai/conversations/${conversationId}`).catch(() => null);
      if (latest?.draft?.ticketId) {
        onChange(latest.draft);
        message.success(`工单已提交${latest.draft.ticketNo ? `：${latest.draft.ticketNo}` : "，可查看处理进度"}`);
        return true;
      }
      if (latest?.draft) onChange({ ...latest.draft, ...form.getFieldsValue(), attachments });
      setError(cause instanceof Error ? cause.message : "提交失败，请稍后重试");
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  useImperativeHandle(confirmRef, () => ({ submit }));

  if (draft.ticketId) return <section className="ai-ticket-card ai-ticket-success" aria-label="已提交的工单">
    <div className="ai-ticket-heading"><CheckCircleOutlined /><div><strong>工单已提交</strong><p>{draft.ticketNo || "已创建工单，可查看详情"}</p></div></div>
    <p>{draft.title}</p>
    <Link className="ai-text-link" href={`/tickets/${draft.ticketId}`}>查看工单与处理进度 →</Link>
  </section>;

  return <section className="ai-ticket-card" aria-label="待确认的工单">
    <div className="ai-ticket-heading"><FileTextOutlined /><div><strong>已为你整理报修内容</strong><p>核对后提交给 IT 处理，可直接修改下方信息。</p></div><Tag color="warning">待确认</Tag></div>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Form name={`ai-ticket-${draft.id}`} form={form} layout="vertical" initialValues={draft} disabled={saving || disabled}>
      <Form.Item name="title" label="问题标题" rules={[{ required: true, whitespace: true, message: "请填写问题标题" }, { max: 180 }]}><Input maxLength={180} /></Form.Item>
      <div className="ai-draft-fields">
        <Form.Item name="categoryId" label="问题分类" rules={[{ required: true }]}><Select options={categories.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>
        <Form.Item name="priority" label="紧急程度"><Select options={[{ value: "LOW", label: "低" }, { value: "NORMAL", label: "普通" }, { value: "HIGH", label: "高" }, { value: "URGENT", label: "紧急" }]} /></Form.Item>
      </div>
      <Form.Item name="description" label="故障现象与排查记录" rules={[{ required: true, whitespace: true, message: "请填写问题描述" }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 14 }} maxLength={20000} /></Form.Item>
      {attachments.length > 0 && <div className="ai-draft-attachments"><span>随工单提交的图片</span><div className="ai-image-strip">{attachments.map((file) => <div key={file.url}><Image width={72} height={64} style={{ objectFit: "cover" }} src={file.url} alt={file.name} /><Button type="text" size="small" danger disabled={saving || disabled} onClick={() => setAttachments((items) => items.filter((item) => item.url !== file.url))}>移除</Button></div>)}</div></div>}
      <p className="ai-note">提交后会将本次对话和所选图片提供给工单处理人员。</p>
      <Space wrap><Button type="primary" icon={<SendOutlined />} loading={saving} disabled={disabled} onClick={() => void submit()}>确认提交工单</Button><span className="ai-note">提交后开始工单处理流程</span></Space>
    </Form>
  </section>;
}
