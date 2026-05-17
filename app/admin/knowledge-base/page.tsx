"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Typography, message } from "antd";
import { EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { apiGet, apiPost, apiPut } from "@/src/lib/clientApi";

type Category = { id: string; name: string };
type Knowledge = {
  id: string;
  kbNo: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  problemDescription: string;
  solutionSteps: string;
  applicableDepartments?: string;
  sourceTicketNo?: string;
  maintainerName?: string;
  enabled: boolean;
  updatedAt: string;
};

export default function AdminKnowledgeBasePage() {
  const [items, setItems] = useState<Knowledge[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [form] = Form.useForm();

  const load = async () => {
    const query = new URLSearchParams();
    if (keyword) query.set("keyword", keyword);
    try {
      setItems(await apiGet<Knowledge[]>(`/api/admin/knowledge-base?${query.toString()}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    }
  };

  useEffect(() => {
    apiGet<Category[]>("/api/admin/categories").then(setCategories).catch(() => null);
    load();
  }, []);

  function showModal(record?: Knowledge) {
    setEditing(record || null);
    setOpen(true);
    form.setFieldsValue(record || { enabled: false });
  }

  async function submit(values: Record<string, unknown>) {
    try {
      if (editing) {
        await apiPut(`/api/admin/knowledge-base/${editing.id}`, values);
      } else {
        await apiPost("/api/admin/knowledge-base", values);
      }
      message.success("保存成功");
      setOpen(false);
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          知识库管理
        </Typography.Title>
        <div className="muted">结构化沉淀常见问题和解决步骤</div>
      </div>

      <div className="content-band">
        <div className="toolbar">
          <Input placeholder="关键词" allowClear prefix={<SearchOutlined />} style={{ width: 240 }} onChange={(event) => setKeyword(event.target.value)} />
          <Button icon={<SearchOutlined />} onClick={load}>
            查询
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>
            新增知识
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={items}
          scroll={{ x: 1000 }}
          columns={[
            { title: "知识编号", dataIndex: "kbNo", width: 150, fixed: "left" },
            { title: "标题", dataIndex: "title", width: 220 },
            { title: "分类", dataIndex: "categoryName", width: 140 },
            { title: "来源工单", dataIndex: "sourceTicketNo", width: 150, render: (value) => value || "-" },
            { title: "维护人", dataIndex: "maintainerName", width: 120 },
            { title: "启用", dataIndex: "enabled", width: 90, render: (value) => (value ? "启用" : "草稿") },
            { title: "更新时间", dataIndex: "updatedAt", width: 180, render: (value) => new Date(value).toLocaleString() },
            {
              title: "操作",
              width: 100,
              fixed: "right",
              render: (_, record) => (
                <Button size="small" icon={<EditOutlined />} onClick={() => showModal(record)}>
                  编辑
                </Button>
              )
            }
          ]}
        />
      </div>

      <Modal width={720} title={editing ? "编辑知识" : "新增知识"} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="categoryId" label="问题分类">
            <Select allowClear options={categories.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <Form.Item name="applicableDepartments" label="适用部门">
            <Input placeholder="多个部门可用逗号分隔" />
          </Form.Item>
          <Form.Item name="problemDescription" label="问题描述" rules={[{ required: true, message: "请填写问题描述" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="solutionSteps" label="解决步骤" rules={[{ required: true, message: "请填写解决步骤" }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item name="enabled" label="发布启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
