"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Typography, App as AntApp } from "antd";
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
  ccUserIds: string[];
  ccRecipients: CcPerson[];
};

type Handler = { dingtalkUserId: string; name: string };
type CcPerson = { userId: string; name: string; departmentName?: string | null; status: "ACTIVE" | "DISABLED" };

import { useClientReady } from "@/src/hooks/useClientReady";

export default function CategoriesPage() {
  const clientReady = useClientReady();
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<Category[]>([]);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [ccPeople, setCcPeople] = useState<Record<string, CcPerson>>({});
  const [ccResults, setCcResults] = useState<CcPerson[]>([]);
  const [ccSearch, setCcSearch] = useState("");
  const [ccLoading, setCcLoading] = useState(false);
  const [ccError, setCcError] = useState("");
  const [ccRevision, setCcRevision] = useState(0);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const loadVersion = useRef(0);
  const [form] = Form.useForm();
  const selectedCcIds: string[] = Form.useWatch("ccUserIds", form) || [];

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCcLoading(true);
    setCcError("");
    setCcResults([]);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ keyword: ccSearch.trim() });
      fetch(`/api/admin/users/cc-options?${query}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const json = await response.json();
          if (!response.ok || !json.success) throw new Error(json.message || "人员列表加载失败");
          if (controller.signal.aborted) return;
          const people = json.data as CcPerson[];
          setCcResults(people);
          setCcPeople(previous => ({ ...previous, ...Object.fromEntries(people.map(person => [person.userId, person])) }));
        })
        .catch(error => {
          if (!controller.signal.aborted) setCcError(error instanceof Error ? error.message : "人员列表加载失败");
        })
        .finally(() => { if (!controller.signal.aborted) setCcLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, ccSearch, ccRevision]);

  // 保留已选人员的姓名；已停用人员移除后不会重新出现在可选列表中。
  const ccOptions = [...new Map([
    ...selectedCcIds.map(userId => ccPeople[userId]).filter((person): person is CcPerson => Boolean(person)),
    ...ccResults
  ].map(person => [person.userId, person])).values()].map(person => ({
    value: person.userId,
    label: `${person.name}${person.departmentName ? `（${person.departmentName}）` : ""}${person.status === "DISABLED" ? " · 已停用" : ""}`
  }));

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const [categoryResult, handlerResult] = await Promise.allSettled([
      apiGet<Category[]>("/api/admin/categories"),
      apiGet<Handler[]>("/api/admin/users?role=handlers")
    ]);
    if (version !== loadVersion.current) return;
    if (categoryResult.status === "fulfilled") setItems(categoryResult.value);
    else message.error(categoryResult.reason instanceof Error ? categoryResult.reason.message : "分类加载失败");
    if (handlerResult.status === "fulfilled") setHandlers(handlerResult.value);
    else message.warning("处理人列表加载失败，请刷新后重试");
    setLoading(false);
  }, [message]);

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  function showModal(record?: Category) {
    if (savingRef.current) return;
    form.resetFields();
    form.setFieldsValue(record ? { ...record, ccUserIds: record.ccUserIds || [] } : { enabled: true, needAdminConfirm: false, sortOrder: 0, ccUserIds: [] });
    setCcPeople(Object.fromEntries((record?.ccRecipients || []).map(person => [person.userId, person])));
    setCcResults([]);
    setCcSearch("");
    setCcError("");
    setEditing(record || null);
    setOpen(true);
  }

  async function submit(values: Record<string, unknown>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = { ...values, ccUserIds: values.ccUserIds || [] };
      if (editing) await apiPut(`/api/admin/categories/${editing.id}`, payload);
      else await apiPost("/api/admin/categories", payload);
      message.success("保存成功");
      setOpen(false);
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove(record: Category) {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingId(record.id);
    try {
      await apiDelete(`/api/admin/categories/${record.id}`);
      message.success("删除成功");
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          分类配置
        </Typography.Title>
        <div className="muted">设置默认处理人、抄送人、SLA 首响和完成时限</div>
      </div>

      <div className="content-band">
        <div className="toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>
            新增分类
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={items}
          loading={loading}
          scroll={{ x: 1180 }}
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
                    okButtonProps={{ danger: true, loading: deletingId === record.id }}
                    onConfirm={() => remove(record)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} disabled={deletingId !== null}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              )
            },
            { title: "默认处理人", dataIndex: "defaultHandlerName", width: 140, render: (value) => value || "-" },
            { title: "抄送人", width: 220, render: (_, record) => record.ccRecipients?.map(person => `${person.name}${person.status === "DISABLED" ? "（已停用）" : ""}`).join("、") || "未设置" },
            { title: "首响时限(分钟)", dataIndex: "firstResponseMinutes", width: 140 },
            { title: "完成时限(分钟)", dataIndex: "resolveMinutes", width: 140 },
            { title: "管理员确认", dataIndex: "needAdminConfirm", width: 120, render: (value) => (value ? "是" : "否") },
            { title: "启用", dataIndex: "enabled", width: 100, render: (value) => (value ? "启用" : "停用") },
            { title: "排序", dataIndex: "sortOrder", width: 90 }
          ]}
        />
      </div>

      <Modal forceRender={clientReady} title={editing ? "编辑分类" : "新增分类"} open={open}
        onCancel={() => { if (!savingRef.current) setOpen(false); }} onOk={() => form.submit()}
        confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
        <Form form={form} layout="vertical" onFinish={submit} disabled={saving}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请填写分类名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="defaultHandlerUserId" label="默认处理人">
            <Select allowClear options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} />
          </Form.Item>
          <Form.Item name="ccUserIds" label="抄送人（选填）" extra={<>
            <div>最多选择 50 人，留空则不抄送。保存后仅影响新工单，已有工单保留原抄送名单。</div>
            {ccError && <div role="alert"><Typography.Text type="danger">{ccError}</Typography.Text> <Button type="link" size="small" onClick={() => setCcRevision(value => value + 1)}>重新加载人员</Button></div>}
          </>}>
            <Select mode="multiple" maxCount={50} allowClear showSearch filterOption={false} options={ccOptions}
              placeholder="按姓名或部门搜索，可不选" searchValue={ccSearch} onSearch={setCcSearch}
              onChange={() => setCcSearch("")} loading={ccLoading}
              notFoundContent={ccLoading ? "正在加载人员…" : ccError ? "人员列表加载失败" : "未找到匹配人员"}
              style={{ width: "100%" }} />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12}>
            <Form.Item name="firstResponseMinutes" label="首响时限" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: "100%" }} suffix="分钟" />
            </Form.Item>
            <Form.Item name="resolveMinutes" label="完成时限" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: "100%" }} suffix="分钟" />
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
