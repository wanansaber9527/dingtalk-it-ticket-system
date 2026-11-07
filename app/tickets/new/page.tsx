"use client";

// 中文注释：员工端工单页面，提供提交、查看和确认评价等移动端体验。

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload,
  Alert,
  App as AntApp } from "antd";
import type { UploadFile, UploadProps } from "antd";
import { InboxOutlined, SendOutlined } from "@ant-design/icons";
import { UserAvatar } from "@/components/UserAvatar";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { apiGet, apiPost } from "@/src/lib/clientApi";
import type { TicketAttachment } from "@/src/lib/attachments";

type User = {
  name: string;
  avatar?: string | null;
  departmentName?: string;
  position?: string;
};

type Category = {
  id: string;
  name: string;
};

const imageUploadTip = "仅支持 JPG、PNG、GIF、WebP、BMP、HEIC 图片";
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/heic", "image/heif"]);
const allowedImageExtensions = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i;

function isSupportedImageFile(file: File) {
  const type = file.type.toLowerCase();
  return allowedImageTypes.has(type) || (!type && allowedImageExtensions.test(file.name));
}

function uploadResponseData(response: unknown, file: UploadFile): TicketAttachment | null {
  const value = (response && typeof response === "object" && "data" in response ? (response as { data?: unknown }).data : response) as Partial<TicketAttachment> | null;
  if (!value?.url && !file.url) return null;
  return {
    name: value?.name || file.name || "附件图片",
    url: value?.url || file.url || "",
    size: value?.size,
    type: value?.type
  };
}

export default function NewTicketPage() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const submittingRef = useRef(false);
  const prefillApplied = useRef(false);
  const fileListRef = useRef<UploadFile[]>([]);
  const uploadControllers = useRef(new Set<AbortController>());
  const title = Form.useWatch("title", form) as string | undefined;
  const categoryId = Form.useWatch("categoryId", form) as string | undefined;
  const description = Form.useWatch("description", form) as string | undefined;
  const aiQuery = new URLSearchParams();
  if (categoryId) aiQuery.set("categoryId", categoryId);
  const question = [title?.trim(), description?.trim()].filter(Boolean).join("\n\n");
  if (question) aiQuery.set("question", question);
  const aiHref = `/ai-assistant${aiQuery.size ? `?${aiQuery.toString()}` : ""}`;

  useEffect(() => {
    if (prefillApplied.current) return;
    prefillApplied.current = true;
    const query = new URLSearchParams(window.location.search);
    const initial: { categoryId?: string; title?: string; description?: string } = {};
    const category = query.get("categoryId");
    const title = query.get("title");
    const description = query.get("description") || query.get("question");
    if (category) initial.categoryId = category.slice(0, 80);
    if (title) initial.title = title.slice(0, 180);
    if (description) initial.description = description.slice(0, 20000);
    if (Object.keys(initial).length) form.setFieldsValue(initial);
  }, [form]);

  useEffect(() => {
    let active = true;
    const controllers = uploadControllers.current;
    void Promise.allSettled([apiGet<User>("/api/me"), apiGet<Category[]>("/api/categories")]).then(([userResult, categoryResult]) => {
      if (!active) return;
      if (userResult.status === "fulfilled") setMe(userResult.value);
      else message.error(userResult.reason instanceof Error ? userResult.reason.message : "身份信息加载失败，请刷新重试");
      if (categoryResult.status === "fulfilled") setCategories(categoryResult.value);
      else message.error(categoryResult.reason instanceof Error ? categoryResult.reason.message : "分类加载失败，请刷新重试");
      setInitialLoading(false);
    });
    return () => { active = false; controllers.forEach((controller) => controller.abort()); controllers.clear(); };
  }, [message]);

  const uploadProps: UploadProps = {
    fileList,
    multiple: true,
    maxCount: 10,
    disabled: loading,
    accept: ".jpg,.jpeg,.png,.gif,.webp,.bmp,.heic,.heif",
    beforeUpload: (file, selectedFiles) => {
      if (submittingRef.current) return Upload.LIST_IGNORE;
      if (fileListRef.current.length + selectedFiles.length > 10) {
        message.error({ content: "最多上传 10 张图片，请减少选择数量", key: "ticket-upload-limit" });
        return Upload.LIST_IGNORE;
      }
      if (!isSupportedImageFile(file)) {
        message.error(imageUploadTip);
        return Upload.LIST_IGNORE;
      }
      if (!file.size || file.size > 10 * 1024 * 1024) {
        message.error("请选择不超过 10MB 的有效图片");
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    customRequest: ({ file, onSuccess, onError }) => {
      const controller = new AbortController();
      uploadControllers.current.add(controller);
      void (async () => {
        try {
          const formData = new FormData();
          formData.append("file", file as File);
          const response = await fetch("/api/uploads", { method: "POST", body: formData, signal: controller.signal });
          const json = await response.json().catch(() => ({}));
          if (!response.ok || !json.success || !json.data?.url) throw new Error(json.message || "上传失败");
          if (!controller.signal.aborted) onSuccess?.(json.data);
        } catch (error) {
          if (!controller.signal.aborted) {
            const failure = error instanceof Error ? error : new Error("上传失败");
            onError?.(failure);
            message.error(failure.message);
          }
        } finally {
          uploadControllers.current.delete(controller);
        }
      })();
      return { abort: () => controller.abort() };
    },
    onChange: ({ fileList: next }) => {
      const normalized = next.map((file) => {
        const attachment = uploadResponseData(file.response, file);
        return attachment?.url ? { ...file, url: attachment.url, thumbUrl: attachment.url } : file;
      });
      fileListRef.current = normalized;
      setFileList(normalized);
    },
    listType: "picture"
  };

  const categoryOptions = useMemo(() => categories.map((item) => ({ value: item.id, label: item.name })), [categories]);
  const uploading = fileList.some((file) => file.status === "uploading" || !file.status);
  const failedUpload = fileList.some((file) => file.status === "error" || (file.status === "done" && !uploadResponseData(file.response, file)));

  async function submit(values: Record<string, unknown>) {
    if (submittingRef.current) return;
    if (!me || initialLoading) {
      message.warning("身份和分类信息尚未加载完成，请稍后重试");
      return;
    }
    const files = fileListRef.current;
    if (files.some((file) => file.status === "uploading" || !file.status)) {
      message.warning("图片正在上传，请等待上传完成后提交");
      return;
    }
    if (files.some((file) => file.status !== "done" || !uploadResponseData(file.response, file))) {
      message.error("有图片上传失败，请移除后重新上传再提交");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    let submitted = false;
    try {
      const attachments = files.map((file) => uploadResponseData(file.response, file) as TicketAttachment);
      const data = await apiPost<{ ticket: { id: string; ticketNo: string }; duplicateWarning: boolean }>("/api/tickets", {
        ...values,
        expectedResolveTime: values.expectedResolveTime ? (values.expectedResolveTime as { toISOString: () => string }).toISOString() : null,
        attachments
      });
      if (data.duplicateWarning) message.warning("检测到你最近提交过相似问题，系统已保留本次工单。");
      message.success(`工单已提交：${data.ticket.ticketNo}`);
      router.push(`/tickets/${data.ticket.id}`);
      submitted = true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      if (!submitted) {
        submittingRef.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <EmployeeShell title="提交工单">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <div className="ticket-applicant">
          <UserAvatar user={me} size={42} />
          <div><Typography.Text strong>{me?.name || "正在加载申请人"}</Typography.Text><div className="muted">{[me?.departmentName, me?.position].filter(Boolean).join(" · ") || "身份信息将从钉钉自动带出"}</div></div>
          <span className="applicant-caption">工单申请人</span>
        </div>

        <Alert type="info" showIcon message="也可以先让 AI 助手协助排查"
          description="将带入已填写的分类和问题描述；你也可以继续直接提交工单。"
          action={<Button href={aiHref} disabled={loading}>先问 AI</Button>} />
        {!initialLoading && (!me || categories.length === 0) && <Alert type="warning" showIcon message={!me ? "身份信息加载失败，请刷新页面重试" : "暂无可用问题分类，请联系管理员"} />}

        <Form className="ticket-form-panel" layout="vertical" form={form} onFinish={submit} disabled={loading}>
          <Form.Item name="title" label="问题标题" rules={[{ required: true, message: "请填写问题标题" }]}>
            <Input placeholder="例如：电脑无法连接公司 Wi-Fi" maxLength={180} showCount />
          </Form.Item>
          <div className="ticket-form-row">
          <Form.Item name="categoryId" label="问题分类" rules={[{ required: true, message: "请选择问题分类" }]}>
            <Select options={categoryOptions} placeholder="选择分类" loading={initialLoading} />
          </Form.Item>
          <Form.Item name="priority" label="紧急程度" initialValue="NORMAL" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "LOW", label: "低" },
                { value: "NORMAL", label: "普通" },
                { value: "HIGH", label: "高" },
                { value: "URGENT", label: "紧急" }
              ]}
            />
          </Form.Item>
          </div>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: "请描述问题现象" }]}>
            <Input.TextArea rows={5} placeholder="请写清楚出现时间、影响范围、错误提示或你已经尝试过的操作" maxLength={20000} showCount />
          </Form.Item>
          <Form.Item name="expectedResolveTime" label="期望解决时间">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="问题截图" extra="最多 10 张，每张不超过 10MB；上传完成后可提交工单。">
            <Upload.Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽上传图片</p>
            </Upload.Dragger>
          </Form.Item>
          {uploading && <Alert type="info" showIcon message="图片正在上传，请等待上传完成" style={{ marginBottom: 16 }} />}
          {failedUpload && <Alert type="error" showIcon message="有图片上传失败，请移除后重新上传" style={{ marginBottom: 16 }} />}
          <div className="ticket-form-footer"><p>提交后，可在“我的工单”查看处理进度。</p>
          <Button type="primary" htmlType="submit" size="large" icon={<SendOutlined />} loading={loading}
            disabled={initialLoading || !me || categories.length === 0 || uploading || failedUpload}>
            提交工单
          </Button></div>
        </Form>
      </Space>
    </EmployeeShell>
  );
}
