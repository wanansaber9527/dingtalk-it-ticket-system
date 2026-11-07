"use client";

// 中文注释：权限管理页面，维护管理员、执行人员和全部用户角色状态。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Descriptions, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, App as AntApp } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import { apiDelete, apiGet, apiPost, apiPut } from "@/src/lib/clientApi";
import { roleLabels, userStatusLabels } from "@/src/lib/labels";
import { hasUserRole, userRoles } from "@/src/lib/userRoles";
import { DirectorySyncPanel, directoryTime } from "@/components/admin/DirectorySyncPanel";

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
  employmentStatus: "ACTIVE" | "DEPARTED";
  departedAt?: string | null;
  manuallyDisabled?: boolean;
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

import { useClientReady } from "@/src/hooks/useClientReady";

export default function UsersPage() {
  const clientReady = useClientReady();
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<User[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [departed, setDeparted] = useState<User[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<User | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<User | null>(null);
  const [restoreForm] = Form.useForm<{ reason: string }>();
  const [activeTab, setActiveTab] = useState("all");
  const [rehireTarget, setRehireTarget] = useState<User | null>(null);
  const [rehirePreview, setRehirePreview] = useState<{ currentUserId: string; reason: string } | null>(null);
  const [archiveForm] = Form.useForm<{ reason: string }>();
  const [rehireForm] = Form.useForm<{ currentUserId: string; reason: string }>();
  const [executors, setExecutors] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>("admin");
  const [people, setPeople] = useState<DingTalkPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allKeyword, setAllKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const mutationRef = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const peopleRequest = useRef<AbortController | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [me, allUsers, adminUsers, executorUsers, departedUsers] = await Promise.all([
        apiGet<User>("/api/me"), apiGet<User[]>("/api/admin/users?employment=ACTIVE"),
        apiGet<User[]>("/api/admin/users?role=admins"), apiGet<User[]>("/api/admin/users?role=executors"),
        apiGet<User[]>("/api/admin/users?employment=DEPARTED")
      ]);
      if (version !== loadVersion.current) return;
      setCurrentUser(me);
      setItems(allUsers);
      setAdmins(adminUsers);
      setExecutors(executorUsers);
      setDeparted(departedUsers);
      setLoadError(null);
    } catch (error) {
      if (version === loadVersion.current) setLoadError(error instanceof Error ? error.message : "用户列表加载失败");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyword")) setAllKeyword(params.get("keyword") || "");
    if (params.get("tab") === "departed") setActiveTab("departed");
    void load();
    return () => { loadVersion.current += 1; peopleRequest.current?.abort(); };
  }, [load]);

  function beginMutation(key: string) {
    if (mutationRef.current) return false;
    mutationRef.current = key;
    setMutation(key);
    return true;
  }

  function endMutation() {
    mutationRef.current = null;
    setMutation(null);
  }

  // 中文注释：角色和人员维护属于超级管理员能力，普通管理员可以查看但不能修改。
  const canManagePersonnel = currentUser ? hasUserRole(currentUser, ["SUPER_ADMIN"]) : false;

  const matchesKeyword = useCallback((item: User) => {
    const keyword = allKeyword.trim().toLowerCase();
    return !keyword || [item.name, item.dingtalkUserId, item.departmentName, item.position, item.mobile].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
  }, [allKeyword]);

  const filteredDeparted = useMemo(() => departed.filter(matchesKeyword), [departed, matchesKeyword]);

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
    if (mutationRef.current) return;
    if (!canManagePersonnel) {
      message.warning("仅超级管理员可以维护超级管理员和执行人员");
      return;
    }
    setMode(nextMode);
    setOpen(true);
    form.resetFields();
  }

  async function update(user: User, patch: Partial<Pick<User, "status">>) {
    if (!canManagePersonnel || !beginMutation(`status:${user.id}`)) return;
    try {
      await apiPut(`/api/admin/users/${user.id}/role`, { status: patch.status || user.status });
      message.success("已更新");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新失败");
    } finally {
      endMutation();
    }
  }

  async function submit(values: DingTalkPerson) {
    if (!canManagePersonnel || !beginMutation("save")) return;
    try {
      await apiPost(mode === "admin" ? "/api/admin/users/admins" : "/api/admin/users/handlers", values);
      message.success(mode === "admin" ? "超级管理员已添加" : "执行人员已添加");
      setOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      endMutation();
    }
  }

  async function removeUser(user: User, nextMode: AddMode) {
    if (!canManagePersonnel || !beginMutation(`delete:${user.id}`)) return;
    try {
      await apiDelete(nextMode === "admin" ? `/api/admin/users/admins/${user.id}` : `/api/admin/users/handlers/${user.id}`);
      message.success("已删除");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      endMutation();
    }
  }

  async function searchPeople(keyword?: string) {
    peopleRequest.current?.abort();
    const controller = new AbortController();
    peopleRequest.current = controller;
    setPeopleLoading(true);
    try {
      const query = new URLSearchParams();
      if (keyword?.trim()) query.set("keyword", keyword.trim());
      const response = await fetch(`/api/admin/dingtalk/users?${query.toString()}`, { signal: controller.signal, cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw new Error(json.message || "钉钉人员列表获取失败，请手动输入 userId");
      if (!controller.signal.aborted) setPeople(json.data);
    } catch (error) {
      if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "钉钉人员列表获取失败，请手动输入 userId");
    } finally {
      if (!controller.signal.aborted) setPeopleLoading(false);
    }
  }

  async function archive(values: { reason: string }) {
    if (!archiveTarget || !canManagePersonnel || !beginMutation("archive")) return;
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(archiveTarget.id)}/archive`, { reason: values.reason.trim() });
      message.success("已归档为离职人员，历史工单保留");
      setArchiveTarget(null);
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : "离职归档失败"); }
    finally { endMutation(); }
  }

  async function restore(values: { reason: string }) {
    if (!restoreTarget || !canManagePersonnel || !beginMutation("restore")) return;
    try {
      await apiPost(`/api/admin/users/${encodeURIComponent(restoreTarget.id)}/restore`, { reason: values.reason.trim() });
      message.success("返聘身份核验通过，已恢复在职档案");
      setRestoreTarget(null);
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : "返聘核验失败"); }
    finally { endMutation(); }
  }

  async function linkRehire() {
    if (!rehireTarget || !rehirePreview || !canManagePersonnel || !beginMutation("rehire")) return;
    try {
      await apiPost("/api/admin/users/rehire-link", { ...rehirePreview, archivedUserId: rehireTarget.id });
      message.success("返聘身份已关联，历史工单已恢复");
      setRehireTarget(null);
      setRehirePreview(null);
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : "返聘关联失败"); }
    finally { endMutation(); }
  }

  function choosePerson(person: DingTalkPerson) {
    if (mutationRef.current) return;
    form.setFieldsValue({
      dingtalkUserId: person.dingtalkUserId, name: person.name,
      departmentId: person.departmentId, departmentName: person.departmentName,
      position: person.position, mobile: person.mobile, avatar: person.avatar
    });
    peopleRequest.current?.abort();
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
        <Button size="small" type="primary" disabled={mutation !== null} onClick={() => choosePerson(record)}>
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
          <Popconfirm title="确认删除？" description="删除后仅取消对应身份，不会影响其他已有身份。" onConfirm={() => removeUser(record, nextMode)}
            okButtonProps={{ loading: mutation === `delete:${record.id}` }} disabled={mutation !== null}>
            <Button danger size="small" icon={<DeleteOutlined />} disabled={mutation !== null}>
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
          aria-label={`${record.name}的账号状态`}
          style={{ width: 110 }}
          disabled={!canManagePersonnel || mutation !== null || loading}
          loading={mutation === `status:${record.id}`}
          options={Object.entries(userStatusLabels).map(([status, label]) => ({ value: status, label }))}
          onChange={(status) => update(record, { status })}
        />
      )
    },
    { title: "创建时间", dataIndex: "createdAt", width: 180, render: directoryTime },
    { title: "操作", key: "actions", width: 110, fixed: "right" as const, render: (_: unknown, record: User) => <Button size="small" danger disabled={!canManagePersonnel || mutation !== null || loading || record.id === currentUser?.id} onClick={() => { archiveForm.resetFields(); setArchiveTarget(record); }}>确认离职</Button> }

  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          人员与权限管理
        </Typography.Title>
        <div className="muted">管理在职人员、离职档案及角色权限，人员资料由钉钉同步</div>
      </div>

      {loadError ? <Alert type="error" showIcon message={loadError} action={<Button size="small" onClick={() => void load()} loading={loading}>重新加载</Button>} /> : null}
      {canManagePersonnel ? <DirectorySyncPanel onSynchronized={load} disabled={mutation !== null} /> : null}

      <div className="content-band">
        <Tabs activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: "admins",
              label: "超级管理员",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {canManagePersonnel ? (
                    <Button type="primary" icon={<PlusOutlined />} disabled={mutation !== null || loading} onClick={() => showAdd("admin")}>
                      新增超级管理员
                    </Button>
                  ) : null}
                  <Table rowKey="id" loading={loading} dataSource={admins} columns={roleTableColumns("admin")} scroll={{ x: 900 }} />
                </Space>
              )
            },
            {
              key: "executors",
              label: "执行人员管理",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  {canManagePersonnel ? (
                    <Button type="primary" icon={<PlusOutlined />} disabled={mutation !== null || loading} onClick={() => showAdd("handler")}>
                      新增执行人员
                    </Button>
                  ) : null}
                  <Table rowKey="id" loading={loading} dataSource={executors} columns={roleTableColumns("handler")} scroll={{ x: 900 }} />
                </Space>
              )
            },
            {
              key: "all",
              label: "在职人员",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Space wrap>
                    <Input.Search
                      allowClear
                      aria-label="搜索在职人员"
                      value={allKeyword}
                      placeholder="搜索姓名、userId、部门、岗位或手机号"
                      style={{ width: "min(320px, 100%)" }}
                      onSearch={setAllKeyword}
                      onChange={(event) => setAllKeyword(event.target.value)}
                    />
                    <Typography.Text type="secondary">当前显示 {filteredItems.length} 人 / 总人数 {items.length} 人。</Typography.Text>
                  </Space>
                  <Table rowKey="id" loading={loading} dataSource={filteredItems} columns={allColumns} scroll={{ x: 1290 }} />
                </Space>
              )
            },
            {
              key: "departed",
              label: "离职人员",
              children: <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Text type="secondary">离职人员已关闭系统访问，历史工单与附件保留。返聘人员可在核验身份后关联原档案。</Typography.Text>
                <Input.Search aria-label="搜索离职人员" allowClear placeholder="搜索姓名、userId、部门或岗位" value={allKeyword} style={{ width: "min(320px, 100%)" }} onSearch={setAllKeyword} onChange={(event) => setAllKeyword(event.target.value)} />
                <Table<User> rowKey="id" loading={loading} dataSource={filteredDeparted} scroll={{ x: 1140 }} locale={{ emptyText: "暂无离职人员" }} columns={[
                  { title: "姓名", dataIndex: "name", width: 120, fixed: "left" },
                  { title: "原钉钉 userId", dataIndex: "dingtalkUserId", width: 190 },
                  { title: "部门", dataIndex: "departmentName", width: 150 },
                  { title: "岗位", dataIndex: "position", width: 140 },
                  { title: "离职时间", dataIndex: "departedAt", width: 190, render: directoryTime },
                  { title: "状态", key: "state", width: 110, render: (_, record) => <Space direction="vertical" size={0}><Tag>已离职</Tag>{record.manuallyDisabled ? <Tag color="warning">人工禁用</Tag> : null}</Space> },
                  { title: "操作", key: "action", width: 240, fixed: "right", render: (_, record) => <Space wrap size={8}><Button size="small" disabled={!canManagePersonnel || mutation !== null || loading} onClick={() => { restoreForm.resetFields(); setRestoreTarget(record); }}>核验并恢复</Button><Button size="small" disabled={!canManagePersonnel || mutation !== null || loading} onClick={() => { rehireForm.resetFields(); setRehirePreview(null); setRehireTarget(record); }}>关联新账号</Button></Space> }
                ]} />
              </Space>

            }
          ]}
        />
      </div>

      <Modal title="确认人员离职" open={archiveTarget !== null} onCancel={() => { if (!mutationRef.current) setArchiveTarget(null); }} onOk={() => archiveForm.submit()} okText="确认离职并归档" confirmLoading={mutation === "archive"} cancelButtonProps={{ disabled: mutation !== null }} closable={mutation === null} maskClosable={mutation === null} keyboard={mutation === null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="warning" showIcon message={`确认 ${archiveTarget?.name || "该人员"} 已离职`} description="归档后会关闭系统访问、撤销管理员和处理人权限，并从在职人员及处理人列表移除。工单、附件和操作记录保留，未完成的经办工单需要重新分派。" />
          <Descriptions column={1} size="small" items={[{ key: "id", label: "钉钉 userId", children: archiveTarget?.dingtalkUserId }, { key: "department", label: "部门", children: archiveTarget?.departmentName || "—" }]} />
          <Form form={archiveForm} layout="vertical" onFinish={archive} disabled={mutation !== null} preserve={false}>
            <Form.Item name="reason" label="确认依据" rules={[{ required: true, whitespace: true, message: "请填写已核实的离职依据" }, { max: 500, message: "请控制在 500 字以内" }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="填写离职记录、核实结果或交接说明" /></Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal title="核验返聘并恢复" open={restoreTarget !== null} onCancel={() => { if (!mutationRef.current) setRestoreTarget(null); }} onOk={() => restoreForm.submit()} okText="核验并恢复" confirmLoading={mutation === "restore"} cancelButtonProps={{ disabled: mutation !== null }} closable={mutation === null} maskClosable={mutation === null} keyboard={mutation === null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon message="适用于返聘后仍使用原钉钉账号的人员" description="提交后系统会向钉钉重新核验人员身份，通过后恢复原档案及本人历史工单。管理员和处理人权限不自动恢复，人工禁用继续保留。更换了钉钉账号的人员请使用“关联新账号”。" />
          <Descriptions column={1} size="small" items={[{ key: "name", label: "姓名", children: restoreTarget?.name }, { key: "id", label: "钉钉 userId", children: restoreTarget?.dingtalkUserId }, { key: "department", label: "原部门", children: restoreTarget?.departmentName || "—" }]} />
          <Form form={restoreForm} layout="vertical" onFinish={restore} disabled={mutation !== null} preserve={false}>
            <Form.Item name="reason" label="返聘核实依据" rules={[{ required: true, whitespace: true, message: "请填写已核实的返聘依据" }, { max: 500, message: "请控制在 500 字以内" }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="填写已核实的返聘记录或身份确认结果" /></Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal title={rehirePreview ? "确认返聘身份关联" : "关联返聘账号"} open={rehireTarget !== null} onCancel={() => { if (!mutationRef.current) { setRehireTarget(null); setRehirePreview(null); } }} onOk={() => { if (rehirePreview) void linkRehire(); else rehireForm.submit(); }} okText={rehirePreview ? "确认关联" : "核对关联信息"} confirmLoading={mutation === "rehire"} cancelButtonProps={{ disabled: mutation !== null }} closable={mutation === null} maskClosable={mutation === null} keyboard={mutation === null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon message="请核实新旧账号属于同一人" description="关联后可以查看本人原来的工单。管理员和处理人权限需要重新授予，人工禁用不会自动解除。姓名或手机号相同不能作为唯一关联依据。" />
          <Descriptions column={1} size="small" title="历史离职档案" items={[
            { key: "name", label: "姓名", children: rehireTarget?.name }, { key: "id", label: "原钉钉 userId", children: rehireTarget?.dingtalkUserId }, { key: "department", label: "原部门", children: rehireTarget?.departmentName || "—" }
          ]} />
          {rehirePreview ? <>
            <Descriptions column={1} size="small" title="返聘后的在职账号" items={[
              { key: "name", label: "姓名", children: items.find((user) => user.id === rehirePreview.currentUserId)?.name || "账号信息已变化，请返回重新选择" },
              { key: "id", label: "钉钉 userId", children: items.find((user) => user.id === rehirePreview.currentUserId)?.dingtalkUserId },
              { key: "reason", label: "核实依据", children: rehirePreview.reason }
            ]} />
            <Button disabled={mutation !== null} onClick={() => setRehirePreview(null)}>返回修改</Button>
          </> : <Form form={rehireForm} layout="vertical" disabled={mutation !== null} onFinish={(values) => setRehirePreview({ currentUserId: values.currentUserId, reason: values.reason.trim() })}>
            <Form.Item name="currentUserId" label="返聘后的在职账号" rules={[{ required: true, message: "请选择已同步的在职账号" }]}><Select showSearch optionFilterProp="label" placeholder="按姓名、部门或钉钉 userId 搜索" options={items.filter((user) => user.id !== rehireTarget?.id).map((user) => ({ value: user.id, disabled: userRoles(user).some((role) => role !== "EMPLOYEE"), label: `${user.name} · ${user.departmentName || "未填写部门"} · ${user.dingtalkUserId}${userRoles(user).some((role) => role !== "EMPLOYEE") ? "（请先移除管理或处理权限）" : user.manuallyDisabled ? "（人工禁用）" : ""}` }))} /></Form.Item>
            <Form.Item name="reason" label="身份核实依据" rules={[{ required: true, whitespace: true, message: "请填写新旧账号属于同一人的核实依据" }, { max: 500, message: "请控制在 500 字以内" }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="填写已核实的返聘记录或身份关联依据" /></Form.Item>
          </Form>}
        </Space>
      </Modal>

      <Modal forceRender={clientReady} title={mode === "admin" ? "新增超级管理员" : "新增执行人员"} open={open}
        onCancel={() => { if (!mutationRef.current) { setOpen(false); setPickerOpen(false); peopleRequest.current?.abort(); } }} onOk={() => form.submit()}
        confirmLoading={mutation === "save"} cancelButtonProps={{ disabled: mutation !== null }} closable={mutation === null} maskClosable={mutation === null} keyboard={mutation === null}>
        <Form form={form} layout="vertical" onFinish={submit} preserve={false} disabled={mutation !== null}>
          <Form.Item name="dingtalkUserId" label="钉钉 userId" rules={[{ required: true, message: "请填写钉钉 userId" }]}>
            <Input placeholder="手动输入钉钉 userId，或从钉钉选择人员后自动回填" />
          </Form.Item>
          <Button icon={<TeamOutlined />} disabled={mutation !== null} onClick={() => { setPeople([]); setPickerOpen(true); void searchPeople(); }} style={{ marginBottom: 16 }}>
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

      <Modal forceRender={clientReady} title="从钉钉选择人员" open={pickerOpen} onCancel={() => { setPickerOpen(false); peopleRequest.current?.abort(); }} footer={null} width={820} destroyOnHidden>
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
