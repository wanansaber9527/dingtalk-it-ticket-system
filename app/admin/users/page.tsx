"use client";

// 中文注释：权限管理页面，维护管理员、执行人员和全部用户角色状态。

import { useEffect, useMemo, useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined, SyncOutlined, TeamOutlined } from "@ant-design/icons";
import { apiDelete, apiGet, apiPost, apiPut } from "@/src/lib/clientApi";
import { roleLabels, userStatusLabels } from "@/src/lib/labels";
import { hasUserRole, userRoles } from "@/src/lib/userRoles";

type User = {
  id: string;
  dingtalkUserId: string;
  name: string;
  mobile?: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
  roleAssignments: { role: keyof typeof roleLabels }[];
  status: keyof typeof userStatusLabels;
  createdAt: string;
};

type SyncResult = {
  total: number;
  createdCount: number;
  updatedCount: number;
  removedCount: number;
  failedCount: number;
  created: Pick<User, "dingtalkUserId" | "name" | "departmentName">[];
  updated: Pick<User, "dingtalkUserId" | "name" | "departmentName">[];
  removed: Pick<User, "dingtalkUserId" | "name" | "departmentName">[];
  failed: Array<Pick<User, "dingtalkUserId" | "name" | "departmentName"> & { reason: string }>;
};

type DingTalkPerson = {
  dingtalkUserId: string;
  name: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
  mobile?: string;
  avatar?: string;
};

type AddMode = "admin" | "handler";

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [executors, setExecutors] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>("admin");
  const [people, setPeople] = useState<DingTalkPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allKeyword, setAllKeyword] = useState("");
  const [form] = Form.useForm();

  const load = () => {
    Promise.all([
      apiGet<User>("/api/me"),
      apiGet<User[]>("/api/admin/users"),
      apiGet<User[]>("/api/admin/users?role=admins"),
      apiGet<User[]>("/api/admin/users?role=executors")
    ])
      .then(([me, allUsers, adminUsers, executorUsers]) => {
        setCurrentUser(me);
        setItems(allUsers);
        setAdmins(adminUsers);
        setExecutors(executorUsers);
      })
      .catch((error) => message.error(error.message));
  };

  useEffect(load, []);

  // 中文注释：角色和人员维护属于超级管理员能力，普通管理员可以查看但不能修改。
  const canManagePersonnel = currentUser ? hasUserRole(currentUser, ["SUPER_ADMIN"]) : false;

  const filteredItems = useMemo(() => {
    const keyword = allKeyword.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.dingtalkUserId, item.departmentName, item.position, item.mobile]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [allKeyword, items]);

  function showAdd(nextMode: AddMode) {
    if (!canManagePersonnel) {
      message.warning("仅超级管理员可以维护超级管理员和执行人员");
      return;
    }
    setMode(nextMode);
    setOpen(true);
    form.resetFields();
  }

  async function update(user: User, patch: Partial<Pick<User, "status">>) {
    try {
      await apiPut(`/api/admin/users/${user.id}/role`, { status: patch.status || user.status });
      message.success("已更新");
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function submit(values: DingTalkPerson) {
    try {
      await apiPost(mode === "admin" ? "/api/admin/users/admins" : "/api/admin/users/handlers", values);
      message.success(mode === "admin" ? "超级管理员已添加" : "执行人员已添加");
      setOpen(false);
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function removeUser(user: User, nextMode: AddMode) {
    try {
      await apiDelete(nextMode === "admin" ? `/api/admin/users/admins/${user.id}` : `/api/admin/users/handlers/${user.id}`);
      message.success("已删除");
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function searchPeople(keyword?: string) {
    setPeopleLoading(true);
    try {
      const query = new URLSearchParams();
      if (keyword?.trim()) query.set("keyword", keyword.trim());
      setPeople(await apiGet<DingTalkPerson[]>(`/api/admin/dingtalk/users?${query.toString()}`));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "钉钉人员列表获取失败，请手动输入 userId");
    } finally {
      setPeopleLoading(false);
    }
  }

  async function syncDirectory() {
    setSyncLoading(true);
    try {
      const result = await apiPost<SyncResult>("/api/admin/users/sync-dingtalk");
      const renderPeople = (people: Pick<User, "dingtalkUserId" | "name" | "departmentName">[]) =>
        people.length
          ? people.map((item) => `${item.name}（${item.departmentName || "-"} / ${item.dingtalkUserId}）`).join("、")
          : "无";
      Modal.success({
        title: "同步完成",
        width: 760,
        content: (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Typography.Text>
              钉钉成员 {result.total} 人，新增 {result.createdCount} 人，更新 {result.updatedCount} 人，停用 {result.removedCount} 人，失败{" "}
              {result.failedCount} 人。
            </Typography.Text>
            <div className="sync-result-block">
              <Typography.Text strong>本次新增</Typography.Text>
              <div className="muted" style={{ marginTop: 4 }}>
                {renderPeople(result.created)}
              </div>
            </div>
            <div className="sync-result-block">
              <Typography.Text strong>本次更新</Typography.Text>
              <div className="muted" style={{ marginTop: 4 }}>
                {renderPeople(result.updated)}
              </div>
            </div>
            <div className="sync-result-block">
              <Typography.Text strong>本次删除/停用</Typography.Text>
              <div className="muted" style={{ marginTop: 4 }}>
                {renderPeople(result.removed)}
              </div>
            </div>
            <div className="sync-result-block">
              <Typography.Text strong type={result.failedCount ? "danger" : undefined}>
                同步失败
              </Typography.Text>
              <div className="muted" style={{ marginTop: 4 }}>
                {result.failed.length
                  ? result.failed.map((item) => `${item.name}（${item.dingtalkUserId}）：${item.reason}`).join("；")
                  : "无"}
              </div>
            </div>
          </Space>
        )
      });
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "同步钉钉成员目录失败");
    } finally {
      setSyncLoading(false);
    }
  }

  function choosePerson(person: DingTalkPerson) {
    form.setFieldsValue(person);
    setPickerOpen(false);
  }

  const peopleColumns = [
    { title: "姓名", dataIndex: "name", width: 120 },
    { title: "钉钉UserId", dataIndex: "dingtalkUserId", width: 190 },
    { title: "部门", dataIndex: "departmentName", width: 140, render: (value: string) => value || "-" },
    { title: "岗位", dataIndex: "position", width: 140, render: (value: string) => value || "-" },
    {
      title: "操作",
      width: 90,
      render: (_: unknown, record: DingTalkPerson) => (
        <Button size="small" type="primary" onClick={() => choosePerson(record)}>
          选择
        </Button>
      )
    }
  ];

  const roleTableColumns = (nextMode: AddMode) => [
    { title: "姓名", dataIndex: "name", width: 120, fixed: "left" as const },
    { title: "钉钉UserId", dataIndex: "dingtalkUserId", width: 190 },
    { title: "部门", dataIndex: "departmentName", width: 150, render: (value: string) => value || "-" },
    { title: "岗位", dataIndex: "position", width: 140, render: (value: string) => value || "-" },
    {
      title: "身份",
      width: 180,
      render: (_: unknown, record: User) => (
        <Space size={4} wrap>
          {userRoles(record).map((role) => (
            <Tag key={role}>{roleLabels[role]}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, record: User) => {
        if (!canManagePersonnel) return <Typography.Text type="secondary">仅超级管理员可维护</Typography.Text>;
        return (
          <Popconfirm title="确认删除？" description="删除后仅取消对应身份，不会影响其他已有身份。" onConfirm={() => removeUser(record, nextMode)}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        );
      }
    }
  ];

  const allColumns = [
    { title: "序号", width: 78, render: (_: unknown, __: User, index: number) => index + 1 },
    { title: "姓名", dataIndex: "name", width: 120, fixed: "left" as const },
    { title: "钉钉UserId", dataIndex: "dingtalkUserId", width: 190 },
    { title: "部门", dataIndex: "departmentName", width: 150 },
    { title: "岗位", dataIndex: "position", width: 140 },
    {
      title: "身份",
      width: 210,
      render: (_: unknown, record: User) => (
        <Space size={4} wrap>
          {userRoles(record).map((role) => (
            <Tag key={role}>{roleLabels[role]}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value: User["status"], record: User) => (
        <Select
          value={value}
          style={{ width: 110 }}
          disabled={!canManagePersonnel}
          options={Object.entries(userStatusLabels).map(([status, label]) => ({ value: status, label }))}
          onChange={(status) => update(record, { status })}
        />
      )
    },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: (value: string) => new Date(value).toLocaleString() }
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          权限管理
        </Typography.Title>
        <div className="muted">维护超级管理员、执行人员和用户身份，人员信息来自钉钉 userId</div>
      </div>

      <div className="content-band">
        <Tabs
          items={[
            {
              key: "admins",
              label: "超级管理员",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {canManagePersonnel ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => showAdd("admin")}>
                      新增超级管理员
                    </Button>
                  ) : null}
                  <Table rowKey="id" dataSource={admins} columns={roleTableColumns("admin")} scroll={{ x: 900 }} />
                </Space>
              )
            },
            {
              key: "executors",
              label: "执行人员管理",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {canManagePersonnel ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => showAdd("handler")}>
                      新增执行人员
                    </Button>
                  ) : null}
                  <Table rowKey="id" dataSource={executors} columns={roleTableColumns("handler")} scroll={{ x: 900 }} />
                </Space>
              )
            },
            {
              key: "all",
              label: "全部用户",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space wrap>
                    <Input.Search
                      allowClear
                      placeholder="搜索姓名、userId、部门、岗位或手机号"
                      style={{ width: 320 }}
                      onSearch={setAllKeyword}
                      onChange={(event) => setAllKeyword(event.target.value)}
                    />
                    <Button icon={<SyncOutlined />} loading={syncLoading} onClick={syncDirectory}>
                      同步钉钉成员目录
                    </Button>
                    <Typography.Text type="secondary">当前显示 {filteredItems.length} 人 / 总人数 {items.length} 人。</Typography.Text>
                  </Space>
                  <Table rowKey="id" dataSource={filteredItems} columns={allColumns} scroll={{ x: 1180 }} />
                </Space>
              )
            }
          ]}
        />
      </div>

      <Modal title={mode === "admin" ? "新增超级管理员" : "新增执行人员"} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="dingtalkUserId" label="钉钉 userId" rules={[{ required: true, message: "请填写钉钉 userId" }]}>
            <Input placeholder="手动输入钉钉 userId，或从钉钉选择人员后自动回填" />
          </Form.Item>
          <Button icon={<TeamOutlined />} onClick={() => { setPickerOpen(true); searchPeople(); }} style={{ marginBottom: 16 }}>
            从钉钉选择人员
          </Button>
          <Form.Item name="name" label="姓名">
            <Input placeholder="从钉钉选择后自动回填；手动 userId 会由后端获取" />
          </Form.Item>
          <Form.Item name="departmentName" label="部门">
            <Input placeholder="从钉钉选择后自动回填" />
          </Form.Item>
          <Form.Item name="position" label="岗位">
            <Input placeholder="从钉钉选择后自动回填" />
          </Form.Item>
          <Form.Item name="departmentId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="mobile" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="avatar" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="从钉钉选择人员" open={pickerOpen} onCancel={() => setPickerOpen(false)} footer={null} width={820} destroyOnClose>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Input.Search
            placeholder="搜索姓名、userId、部门或岗位"
            enterButton={<SearchOutlined />}
            onSearch={searchPeople}
            allowClear
          />
          <Table
            rowKey="dingtalkUserId"
            loading={peopleLoading}
            dataSource={people}
            columns={peopleColumns}
            scroll={{ x: 740, y: 360 }}
            size="small"
          />
        </Space>
      </Modal>
    </Space>
  );
}
