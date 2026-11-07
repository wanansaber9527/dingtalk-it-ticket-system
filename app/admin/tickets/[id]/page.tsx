"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, Checkbox, Collapse, Form, Input, Select, Space, App as AntApp } from "antd";
import {
  CheckCircleOutlined,
  CommentOutlined,
  ReloadOutlined,
  SendOutlined,
  SwapOutlined
} from "@ant-design/icons";
import { TicketAiContext } from "@/components/ai/TicketAiContext";
import { TicketOverview, type TicketOverviewData } from "@/components/tickets/TicketOverview";
import { ticketStatusLabels } from "@/src/lib/labels";
import { apiGet, apiPost } from "@/src/lib/clientApi";
import { hasUserRole } from "@/src/lib/userRoles";

type Ticket = TicketOverviewData & { permissions: { canOperate: boolean } };

type Handler = { dingtalkUserId: string; name: string };
type CurrentUser = {
  roleAssignments: { role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN" }[];
};
export default function AdminTicketDetailPage() {
  const { message } = AntApp.useApp();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const actionLock = useRef(false);
  const loadVersion = useRef(0);
  const [silentDelete, setSilentDelete] = useState(false);
  const [assignForm] = Form.useForm();
  const [statusForm] = Form.useForm();
  const [resolveForm] = Form.useForm();
  const [commentForm] = Form.useForm();

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiGet<Ticket>(`/api/admin/tickets/${params.id}`);
      if (version !== loadVersion.current) return;
      if (!data.permissions?.canOperate) {
        setTicket(null);
        router.replace(`/tickets/${params.id}`);
        return;
      }
      setTicket(data);
    } catch (error) {
      if (version === loadVersion.current) setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    if (!ticket) return;
    assignForm.setFieldsValue({ handlerUserId: ticket.handlerUserId });
    statusForm.setFieldsValue({ status: ticket.status });
  }, [ticket, assignForm, statusForm]);

  useEffect(() => {
    setTicket(null);
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    let active = true;
    apiGet<CurrentUser>("/api/me").then((value) => { if (active) setMe(value); }).catch(() => { if (active) setMe(null); });
    if (ticket?.permissions.canOperate) apiGet<Handler[]>("/api/admin/users?role=handlers").then((value) => { if (active) setHandlers(value); }).catch((error) => { if (active) message.error(error.message || "执行人员加载失败"); });
    return () => { active = false; };
  }, [message, ticket?.permissions.canOperate]);

  const isSuperAdmin = me ? hasUserRole(me, ["SUPER_ADMIN"]) : false;
  const busy = loading || Boolean(pendingAction) || Boolean(loadError);
  const terminal = ticket ? ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(ticket.status) : true;
  const transitions: Record<Ticket["status"], Ticket["status"][]> = {
    PENDING: ["ASSIGNED", "PROCESSING", "REJECTED", "CANCELLED", "CLOSED"],
    ASSIGNED: ["PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "CLOSED"],
    PROCESSING: ["COMPLETED", "ASSIGNED", "REJECTED", "CANCELLED", "CLOSED"],
    RETURNED: ["PROCESSING", "ASSIGNED", "CANCELLED", "CLOSED"], COMPLETED: ["CLOSED"], CLOSED: [], REJECTED: [], CANCELLED: []
  };

  async function run(url: string, body?: unknown) {
    if (actionLock.current) return;
    actionLock.current = true;
    setPendingAction(url);
    try {
      await apiPost(url, body || {});
      message.success("操作成功");
      assignForm.resetFields();
      statusForm.resetFields();
      resolveForm.resetFields();
      commentForm.resetFields();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      actionLock.current = false;
      setPendingAction("");
    }
  }

  async function transferTicket() {
    if (!ticket || actionLock.current) return;
    try {
      const values = await assignForm.validateFields();
      await run(`/api/tickets/${ticket.id}/transfer`, values);
    } catch { /* 表单展示字段错误，不发送不完整请求。 */ }
  }

  async function closeTicket() {
    if (!ticket || actionLock.current) return;
    actionLock.current = true;
    setPendingAction("close");
    try {
      await apiPost(`/api/admin/tickets/${ticket.id}/close`, {
        remark: "管理员关闭",
        silentDelete: isSuperAdmin && silentDelete
      });
      message.success(silentDelete ? "已静默删除" : "操作成功");
      if (silentDelete) {
        router.push("/admin/tickets");
        return;
      }
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      actionLock.current = false;
      setPendingAction("");
    }
  }


  return (
    <>
      {loadError && <Alert showIcon type="error" message="加载工单失败" description={loadError} action={<Button onClick={() => void load()}>重试</Button>} />}
      {loading && !ticket && <Card loading />}
      {ticket && (
        <TicketOverview ticket={ticket} loading={loading} backHref="/admin/tickets" backLabel="返回工单管理"
          actions={<Button icon={<ReloadOutlined />} loading={loading} disabled={Boolean(pendingAction)} onClick={() => void load()}>刷新工单</Button>}
          aside={
            <section className="detail-section">
              <h2 className="detail-section-title"><SwapOutlined />工单管理</h2>
              <Collapse ghost className="ticket-secondary-actions" defaultActiveKey={["assign"]} items={[
                { key: "assign", label: "分派 / 转交", forceRender: true, children: (
                  <Form name="admin_tickets_assignForm" form={assignForm} layout="vertical" disabled={busy || terminal} onFinish={(values) => run(`/api/admin/tickets/${ticket.id}/assign`, values)}>
                    <Form.Item name="handlerUserId" label="处理人" rules={[{ required: true, message: "请选择处理人" }]}>
                      <Select options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} placeholder="处理人" />
                    </Form.Item>
                    <Form.Item name="remark" label="分派说明">
                      <Input placeholder="备注" />
                    </Form.Item>
                    <Space>
                      {isSuperAdmin && (
                        <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={pendingAction.endsWith("/assign")}>
                          分派
                        </Button>
                      )}
                      <Button className="action-violet" icon={<SwapOutlined />} loading={pendingAction.endsWith("/transfer")} onClick={transferTicket}>
                        转交
                      </Button>
                    </Space>
                  </Form>
                ) },
                { key: "status", label: "状态处理", forceRender: true, children: (
                  <Form name="admin_tickets_statusForm" form={statusForm} layout="vertical" disabled={busy || !transitions[ticket.status].length} onFinish={(values) => run(`/api/tickets/${ticket.id}/status`, values)}>
                    <Form.Item name="status" label="目标状态" rules={[{ required: true }]}>
                      <Select options={[ticket.status, ...transitions[ticket.status]].map((value) => ({ value, label: ticketStatusLabels[value] }))} />
                    </Form.Item>
                    <Form.Item name="remark" label="处理说明">
                      <Input placeholder="备注" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />} loading={pendingAction.endsWith("/status")}>
                      更新
                    </Button>
                  </Form>
                ) }
              ]} />
            </section>
          }
        >
          <TicketAiContext ticketId={ticket.id} />
          <section className="detail-section">
            <h2 className="detail-section-title"><CheckCircleOutlined />标记处理完成</h2>
            <Form name="admin_tickets_resolveForm"
              form={resolveForm}
              disabled={busy || terminal}
              layout="vertical"
              onFinish={(values) => run(`/api/tickets/${ticket.id}/resolve`, values)}
            >
              <Form.Item name="resultSummary" label="处理结果" rules={[{ required: true, message: "请填写处理结果" }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
              <Button type="primary" className="action-success" htmlType="submit" icon={<CheckCircleOutlined />} loading={pendingAction.endsWith("/resolve")}>
                完成处理
              </Button>
            </Form>
          </section>
          <section className="detail-section">
            <h2 className="detail-section-title"><CommentOutlined />备注与关闭</h2>
            <Form name="admin_tickets_commentForm"
              form={commentForm}
              disabled={busy}
              layout="vertical"
              onFinish={(values) => run(`/api/tickets/${ticket.id}/comments`, values)}
            >
              <Form.Item name="remark" label="处理备注" rules={[{ required: true, message: "请填写备注" }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
              <Space wrap>
                <Button className="action-teal" htmlType="submit" icon={<CommentOutlined />} loading={pendingAction.endsWith("/comments")}>
                  添加备注
                </Button>
                {isSuperAdmin && (
                  <>
                    <Space size={8} wrap>
                      <Checkbox checked={silentDelete} onChange={(event) => setSilentDelete(event.target.checked)}>
                        静默删除
                      </Checkbox>
                      <Button danger icon={<ReloadOutlined />} onClick={closeTicket} loading={pendingAction === "close"} disabled={busy || (!silentDelete && ticket.status === "CLOSED")}>
                        关闭工单
                      </Button>
                    </Space>
                  </>
                )}
              </Space>
            </Form>
          </section>
        </TicketOverview>
      )}
    </>
  );
}
