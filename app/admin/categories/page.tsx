"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Typography, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { apiDelete, apiGet, apiPost, apiPut } from "@/src/lib/clientApi";

type Category = {
  id: string;
  name: string;
  description?: string;
  defaultHandlerUserId?: string;
  defaultHandlerName?: string;
  firstResponseMinutes?: number;
  resolveMinutes?: number;
  needAdminConfirm: boolean;
  enabled: boolean;
  sortOrder: number;
};

type Handler = { dingtalkUserId: string; name: string };

export default function CategoriesPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    apiGet<Category[]>("/api/admin/categories").then(setItems).catch((error) => message.error(error.message));
    apiGet<Handler[]>("/api/admin/users?role=handlers").then(setHandlers).catch(() => null);
  };

  useEffect(load, []);

  function showModal(record?: Category) {
    setEditing(record || null);
    setOpen(true);
    form.setFieldsValue(record || { enabled: true, needAdminConfirm: false, sortOrder: 0 });
  }

  async function submit(values: Record<string, unknown>) {
    try {
      if (editing) {
        await apiPut(`/api/admin/categories/${editing.id}`, values);
      } else {
        await apiPost("/api/admin/categories", values);
      }
      message.success("保存成功");
      setOpen(false);
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function remove(record: Category) {
    try {
      await apiDelete(`/api/admin/categories/${record.id}`);
      message.success("删除成功");
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          分类配置
        </Typography.Title>
        <div className="muted">设置默认处理人、SLA 首响和完成时限</div>
      </div>

      <div className="content-band">
        <div className="toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>
            新增分类
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={items}
          scroll={{ x: 960 }}
          columns={[
            { title: "分类名称", dataIndex: "name", fixed: "left", width: 170 },
            {
              title: "操作",
              fixed: "left",
              width: 160,
              render: (_, record) => (
                <Space size={8}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => showModal(record)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除分类"
                    description="确认删除该分类？已有工单或知识库引用时系统会阻止删除。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove(record)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              )
            },
            { title: "默认处理人", dataIndex: "defaultHandlerName", width: 140, render: (value) => value || "-" },
            { title: "首响时限(分钟)", dataIndex: "firstResponseMinutes", width: 140 },
            { title: "完成时限(分钟)", dataIndex: "resolveMinutes", width: 140 },
            { title: "管理员确认", dataIndex: "needAdminConfirm", width: 120, render: (value) => (value ? "是" : "否") },
            { title: "启用", dataIndex: "enabled", width: 100, render: (value) => (value ? "启用" : "停用") },
            { title: "排序", dataIndex: "sortOrder", width: 90 }
          ]}
        />
      </div>

      <Modal title={editing ? "编辑分类" : "新增分类"} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请填写分类名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="defaultHandlerUserId" label="默认处理人">
            <Select allowClear options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12}>
            <Form.Item name="firstResponseMinutes" label="首响时限" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: "100%" }} addonAfter="分钟" />
            </Form.Item>
            <Form.Item name="resolveMinutes" label="完成时限" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: "100%" }} addonAfter="分钟" />
            </Form.Item>
          </Space>
          <Space size={24}>
            <Form.Item name="needAdminConfirm" label="需管理员确认" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
