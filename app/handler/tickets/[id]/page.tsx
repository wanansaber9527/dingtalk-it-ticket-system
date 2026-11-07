"use client";

// 中文注释：处理人工单详情页，提供接单、备注、转交和完成处理能力。

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, Button, Card, Collapse, DatePicker, Form, Input, Select, App as AntApp } from "antd";
import { CalendarOutlined, CheckCircleOutlined, CommentOutlined, PlayCircleOutlined, RollbackOutlined, SwapOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketAiContext } from "@/components/ai/TicketAiContext";
import { TicketOverview, type TicketOverviewData } from "@/components/tickets/TicketOverview";
import { apiGet, apiPost } from "@/src/lib/clientApi";

type Ticket = TicketOverviewData & { permissions: { canOperate: boolean } };

type Handler = {
  dingtalkUserId: string;
  name: string;
};

function canAccept(status: Ticket["status"]) {
  return status === "ASSIGNED" || status === "PENDING";
}

function canResolve(status: Ticket["status"]) {
  return status === "ASSIGNED" || status === "PROCESSING";
}

function canAdjustDeadline(status: Ticket["status"]) {
  return status === "PENDING" || status === "ASSIGNED" || status === "PROCESSING";
}

function canReturnToApplicant(status: Ticket["status"]) {
  return status === "PENDING" || status === "ASSIGNED" || status === "PROCESSING";
}

export default function HandlerTicketDetailPage() {
  const { message } = AntApp.useApp();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const actionLock = useRef(false);
  const loadVersion = useRef(0);
  const [commentForm] = Form.useForm();
  const [resolveForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [deadlineForm] = Form.useForm();
  const [returnForm] = Form.useForm();

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiGet<Ticket>(`/api/tickets/${params.id}`);
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
    transferForm.setFieldsValue({ handlerUserId: ticket.handlerUserId });
    deadlineForm.setFieldsValue({
      slaResolveDeadline: ticket.slaResolveDeadline ? dayjs(ticket.slaResolveDeadline) : undefined
    });
  }, [ticket, transferForm, deadlineForm]);

  useEffect(() => {
    setTicket(null);
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    let active = true;
    if (ticket?.permissions.canOperate) apiGet<Handler[]>("/api/admin/users?role=handlers").then((value) => { if (active) setHandlers(value); }).catch((error) => { if (active) message.error(error.message || "执行人员加载失败"); });
    return () => { active = false; };
  }, [message, ticket?.permissions.canOperate]);

  const busy = loading || Boolean(pendingAction) || Boolean(loadError);
  const terminal = ticket ? ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"].includes(ticket.status) : true;

  async function run(url: string, body?: unknown) {
    if (actionLock.current) return;
    actionLock.current = true;
    setPendingAction(url);
    try {
      await apiPost(url, body || {});
      message.success("操作成功");
      commentForm.resetFields();
      resolveForm.resetFields();
      deadlineForm.resetFields();
      returnForm.resetFields();
      if (url.endsWith("/transfer")) {
        router.push("/handler/tickets");
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

  async function adjustDeadline(values: { slaResolveDeadline?: Dayjs; remark?: string }) {
    if (!ticket) return;
    if (!values.slaResolveDeadline) {
      message.error("请选择新的预计处理时间");
      return;
    }
    await run(`/api/tickets/${ticket.id}/resolve-deadline`, {
      slaResolveDeadline: values.slaResolveDeadline.toISOString(),
      remark: values.remark
    });
  }


  return (
    <EmployeeShell title="处理详情" hideHeading>
      {loadError && <Alert showIcon type="error" message="加载工单失败" description={loadError} action={<Button onClick={() => void load()}>重试</Button>} />}
      {loading && !ticket && <Card loading />}
      {ticket && (
        <TicketOverview ticket={ticket} loading={loading} backHref="/handler/tickets" backLabel="返回列表"
          actions={<Button type="primary" icon={<PlayCircleOutlined />} disabled={busy || !canAccept(ticket.status)}
            loading={pendingAction.endsWith("/status")} onClick={() => run(`/api/tickets/${ticket.id}/status`, { status: "PROCESSING", remark: "处理人接单" })}>
            接单并开始处理
          </Button>}
          aside={
            <section className="detail-section">
              <h2 className="detail-section-title"><SwapOutlined />更多操作</h2>
              <Collapse ghost className="ticket-secondary-actions" items={[
                { key: "deadline", label: "调整预计处理时间", forceRender: true, children: (
                  <Form name="handler_tickets_deadlineForm" form={deadlineForm} layout="vertical" disabled={busy || !canAdjustDeadline(ticket.status)} onFinish={adjustDeadline}>
                    <Form.Item
                      name="slaResolveDeadline"
                      label="新的预计处理时间"
                      rules={[{ required: true, message: "请选择新的预计处理时间" }]}
                    >
                      <DatePicker showTime style={{ width: "100%" }} placeholder="选择新的预计处理时间" />
                    </Form.Item>
                    <Form.Item name="remark" label="调整说明">
                      <Input.TextArea rows={3} placeholder="例如：正在处理其他紧急项目，预计稍后处理该工单" />
                    </Form.Item>
                    <Button
                      block
                      htmlType="submit"
                      icon={<CalendarOutlined />}
                      disabled={busy || !canAdjustDeadline(ticket.status)}
                      loading={pendingAction.endsWith("/resolve-deadline")}
                    >
                      保存预计处理时间
                    </Button>
                  </Form>
                ) },
                { key: "return", label: "退回发起人", forceRender: true, children: (
                  <Form name="handler_tickets_returnForm" form={returnForm} layout="vertical" disabled={busy || !canReturnToApplicant(ticket.status)} onFinish={(values) => run(`/api/tickets/${ticket.id}/return`, values)}>
                    <Form.Item name="remark" label="退回原因" rules={[{ required: true, message: "请填写退回原因" }]}>
                      <Input.TextArea rows={3} placeholder="请说明需要发起人补充的内容，例如截图、账号、报错时间或现场信息" />
                    </Form.Item>
                    <Button block className="action-warning" htmlType="submit" icon={<RollbackOutlined />} disabled={busy || !canReturnToApplicant(ticket.status)} loading={pendingAction.endsWith("/return")}>
                      退回发起人补充
                    </Button>
                  </Form>
                ) },
                { key: "transfer", label: "转交工单", forceRender: true, children: (
                  <Form name="handler_tickets_transferForm" form={transferForm} layout="vertical" disabled={busy || terminal} onFinish={(values) => run(`/api/tickets/${ticket.id}/transfer`, values)}>
                    <Form.Item name="handlerUserId" label="转交给" rules={[{ required: true, message: "请选择处理人" }]}>
                      <Select placeholder="选择处理人" options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} />
                    </Form.Item>
                    <Form.Item name="remark" label="转交说明">
                      <Input placeholder="可填写转交原因" />
                    </Form.Item>
                    <Button block className="action-violet" htmlType="submit" icon={<SwapOutlined />} loading={pendingAction.endsWith("/transfer")}>
                      转交工单
                    </Button>
                  </Form>
                ) }
              ]} />
            </section>
          }
        >
          <TicketAiContext ticketId={ticket.id} />
          <section className="detail-section">
            <h2 className="detail-section-title"><CheckCircleOutlined />处理工单</h2>
            <Form name="handler_tickets_resolveForm" form={resolveForm} layout="vertical" disabled={busy || !canResolve(ticket.status)} onFinish={(values) => run(`/api/tickets/${ticket.id}/resolve`, values)}>
              <Form.Item name="resultSummary" label="处理结果" rules={[{ required: true, message: "请填写处理结果" }]}>
                <Input.TextArea rows={4} placeholder="填写处理过程、解决方式和结果" />
              </Form.Item>
              <Button block type="primary" className="action-success" htmlType="submit" icon={<CheckCircleOutlined />} disabled={busy || !canResolve(ticket.status)} loading={pendingAction.endsWith("/resolve")}>
                标记处理完成
              </Button>
            </Form>
          </section>
          <section className="detail-section">
            <h2 className="detail-section-title"><CommentOutlined />处理备注</h2>
            <Form name="handler_tickets_commentForm" form={commentForm} layout="vertical" disabled={busy} onFinish={(values) => run(`/api/tickets/${ticket.id}/comments`, values)}>
              <Form.Item name="remark" label="处理备注" rules={[{ required: true, message: "请填写处理备注" }]}>
                <Input.TextArea rows={3} placeholder="补充处理进展或需要申请人配合的信息" />
              </Form.Item>
              <Button block className="action-teal" htmlType="submit" icon={<CommentOutlined />} loading={pendingAction.endsWith("/comments")}>
                添加备注
              </Button>
            </Form>
          </section>
        </TicketOverview>
      )}
    </EmployeeShell>
  );
}
