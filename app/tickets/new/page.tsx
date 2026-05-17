"use client";

// 中文注释：员工端工单页面，提供提交、查看和确认评价等移动端体验。

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload,
  message,
  Alert,
  List
} from "antd";
import type { UploadFile, UploadProps } from "antd";
import { InboxOutlined, SendOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { apiGet, apiPost } from "@/src/lib/clientApi";

type User = {
  name: string;
  departmentName?: string;
  position?: string;
};

type Category = {
  id: string;
  name: string;
};

type Knowledge = {
  id: string;
  title: string;
  solutionSteps: string;
};

export default function NewTicketPage() {
  const [form] = Form.useForm();
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [suggestions, setSuggestions] = useState<Knowledge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<User>("/api/me").then(setMe).catch((error) => message.error(error.message));
    apiGet<Category[]>("/api/categories").then(setCategories).catch((error) => message.error(error.message));
  }, []);

  const uploadProps: UploadProps = {
    fileList,
    multiple: true,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        const formData = new FormData();
        formData.append("file", file as File);
        const response = await fetch("/api/uploads", { method: "POST", body: formData });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.message || "上传失败");
        onSuccess?.(json.data);
      } catch (error) {
        onError?.(error as Error);
      }
    },
    onChange: ({ fileList: next }) => setFileList(next)
  };

  const categoryOptions = useMemo(() => categories.map((item) => ({ value: item.id, label: item.name })), [categories]);

  async function refreshSuggestions() {
    const title = form.getFieldValue("title");
    const categoryId = form.getFieldValue("categoryId");
    if (!title && !categoryId) return;
    const query = new URLSearchParams();
    if (title) query.set("keyword", title);
    if (categoryId) query.set("categoryId", categoryId);
    const data = await apiGet<Knowledge[]>(`/api/knowledge-base/search?${query.toString()}`);
    setSuggestions(data);
  }

  async function submit(values: Record<string, unknown>) {
    setLoading(true);
    try {
      const attachments = fileList
        .filter((file) => file.status === "done" && file.response)
        .map((file) => file.response);
      const data = await apiPost<{ ticket: { id: string; ticketNo: string }; duplicateWarning: boolean }>("/api/tickets", {
        ...values,
        expectedResolveTime: values.expectedResolveTime ? (values.expectedResolveTime as { toISOString: () => string }).toISOString() : null,
        attachments
      });
      if (data.duplicateWarning) {
        message.warning("检测到你最近提交过相似问题，系统已保留本次工单。");
      }
      message.success(`工单已提交：${data.ticket.ticketNo}`);
      router.push(`/tickets/${data.ticket.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <EmployeeShell title="提交IT工单">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Card size="small">
          <Typography.Text strong>{me?.name || "当前用户"}</Typography.Text>
          <div className="muted" style={{ marginTop: 4 }}>
            {me?.departmentName || "部门信息将从钉钉自动带出"}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {me?.position ? `岗位：${me.position}` : "岗位信息将从钉钉自动带出"}
          </div>
        </Card>

        {suggestions.length > 0 && (
          <Alert
            type="info"
            showIcon
            message="你可能想查看以下解决方案"
            description={
              <List
                size="small"
                dataSource={suggestions.slice(0, 3)}
                renderItem={(item) => (
                  <List.Item>
                    <Typography.Link href={`/knowledge-base?keyword=${encodeURIComponent(item.title)}`}>
                      {item.title}
                    </Typography.Link>
                  </List.Item>
                )}
              />
            }
          />
        )}

        <Form layout="vertical" form={form} onFinish={submit} onValuesChange={refreshSuggestions}>
          <Form.Item name="title" label="问题标题" rules={[{ required: true, message: "请填写问题标题" }]}>
            <Input placeholder="例如：电脑无法连接公司 Wi-Fi" maxLength={80} showCount />
          </Form.Item>
          <Form.Item name="categoryId" label="问题分类" rules={[{ required: true, message: "请选择问题分类" }]}>
            <Select options={categoryOptions} placeholder="选择分类" />
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
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: "请描述问题现象" }]}>
            <Input.TextArea rows={5} placeholder="请写清楚出现时间、影响范围、错误提示或你已经尝试过的操作" maxLength={1200} showCount />
          </Form.Item>
          <Form.Item name="expectedResolveTime" label="期望解决时间">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="截图或附件">
            <Upload.Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽上传</p>
            </Upload.Dragger>
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" icon={<SendOutlined />} loading={loading}>
            提交工单
          </Button>
        </Form>
      </Space>
    </EmployeeShell>
  );
}
