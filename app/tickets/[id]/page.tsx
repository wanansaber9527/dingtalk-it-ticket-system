"use client";

// 中文注释：员工端工单页面，提供提交、查看和确认评价等移动端体验。

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Button, Card, Form, Input, Modal, Radio, App as AntApp } from "antd";
import { CommentOutlined, StarOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketAiContext } from "@/components/ai/TicketAiContext";
import { TicketOverview, type TicketOverviewData } from "@/components/tickets/TicketOverview";
import { apiGet, apiPost } from "@/src/lib/clientApi";

import { useClientReady } from "@/src/hooks/useClientReady";

type Ticket = TicketOverviewData & {
  permissions: { canComment: boolean; canSupplement: boolean; canRate: boolean; canOperate: boolean; isCcOnly: boolean };
};

export default function TicketDetailPage() {
  const clientReady = useClientReady();
  const { message } = AntApp.useApp();
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const actionLock = useRef(false);
  const loadVersion = useRef(0);
  const [commentOpen, setCommentOpen] = useState(false);
  const [supplementOpen, setSupplementOpen] = useState(false);
  const [satisfactionOpen, setSatisfactionOpen] = useState(false);
  const [commentForm] = Form.useForm();
  const [satisfactionForm] = Form.useForm();
  const [supplementForm] = Form.useForm();

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiGet<Ticket>(`/api/tickets/${params.id}`);
      if (version === loadVersion.current) setTicket(data);
    } catch (error) {
      if (version === loadVersion.current) setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    setTicket(null);
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  const busy = loading || Boolean(pendingAction) || Boolean(loadError);

  async function submitAction(url: string, values?: unknown) {
    if (actionLock.current) return;
    actionLock.current = true;
    setPendingAction(url);
    try {
      await apiPost(url, values || {});
      message.success("操作成功");
      setCommentOpen(false);
      setSupplementOpen(false);
      setSatisfactionOpen(false);
      if (url.endsWith("/comments")) commentForm.resetFields();
      if (url.endsWith("/supplement")) supplementForm.resetFields();
      if (url.endsWith("/satisfaction")) satisfactionForm.resetFields();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      actionLock.current = false;
      setPendingAction("");
    }
  }


  return (
    <EmployeeShell title="工单详情" hideHeading>
      {loadError && <Alert showIcon type="error" message="加载工单失败" description={loadError} action={<Button onClick={() => void load()}>重试</Button>} />}
      {loading && !ticket && <Card loading />}
      {ticket && (
        <TicketOverview ticket={ticket} loading={loading} backHref="/tickets/my" backLabel="返回我的工单"
          notice={ticket.permissions?.isCcOnly
            ? <Alert showIcon type="info" message="你是本工单的抄送人，仅可查看工单内容和处理进度。" />
            : ticket.permissions?.canSupplement && ticket.status === "RETURNED" ? <Alert showIcon type="warning" message="该工单已退回，请补充说明后重新提交给处理人。" /> : undefined}
          actions={ticket.permissions?.canComment || ticket.permissions?.canSupplement || ticket.permissions?.canRate ? <>
            {ticket.permissions?.canSupplement && ticket.status === "RETURNED" && (
              <Button type="primary" icon={<CommentOutlined />} disabled={busy} onClick={() => setSupplementOpen(true)}>补充后提交处理人</Button>
            )}
            {ticket.permissions?.canComment && <Button className="action-teal" icon={<CommentOutlined />} disabled={busy} onClick={() => setCommentOpen(true)}>补充说明</Button>}
            {ticket.permissions?.canRate && <Button icon={<StarOutlined />} disabled={busy || !["COMPLETED", "CLOSED"].includes(ticket.status)} onClick={() => {
              satisfactionForm.setFieldsValue({ level: ticket.satisfactionLevel, comment: ticket.satisfactionComment });
              setSatisfactionOpen(true);
            }}>满意度</Button>}
          </> : undefined}
        >
          <TicketAiContext ticketId={ticket.id} />
        </TicketOverview>
      )}

      <Modal forceRender={clientReady} title="补充说明" open={commentOpen} onCancel={() => { if (!pendingAction) setCommentOpen(false); }} onOk={() => commentForm.submit()} confirmLoading={pendingAction.endsWith("/comments")} okButtonProps={{ disabled: busy, className: "action-teal" }} cancelButtonProps={{ disabled: Boolean(pendingAction) }} destroyOnHidden>
        <Form name="tickets_commentForm" form={commentForm} layout="vertical" disabled={busy} onFinish={(values) => submitAction(`/api/tickets/${params.id}/comments`, values)}>
          <Form.Item name="remark" label="说明" rules={[{ required: true, message: "请填写说明" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal forceRender={clientReady} title="补充后提交处理人" open={supplementOpen} onCancel={() => { if (!pendingAction) setSupplementOpen(false); }} onOk={() => supplementForm.submit()} confirmLoading={pendingAction.endsWith("/supplement")} okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: Boolean(pendingAction) }} destroyOnHidden>
        <Form name="tickets_supplementForm" form={supplementForm} layout="vertical" disabled={busy} onFinish={(values) => submitAction(`/api/tickets/${params.id}/supplement`, values)}>
          <Form.Item name="remark" label="补充说明" rules={[{ required: true, message: "请填写补充说明" }]}>
            <Input.TextArea rows={4} placeholder="请补充处理人要求的信息，提交后工单会重新交回处理人继续处理" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal forceRender={clientReady} title="满意度评价" open={satisfactionOpen} onCancel={() => { if (!pendingAction) setSatisfactionOpen(false); }} onOk={() => satisfactionForm.submit()} confirmLoading={pendingAction.endsWith("/satisfaction")} okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: Boolean(pendingAction) }} destroyOnHidden>
        <Form name="tickets_satisfactionForm" form={satisfactionForm} layout="vertical" disabled={busy} onFinish={(values) => submitAction(`/api/tickets/${params.id}/satisfaction`, values)}>
          <Form.Item name="level" label="满意度" rules={[{ required: true, message: "请选择满意度" }]}>
            <Radio.Group
              options={[
                { value: "SATISFIED", label: "满意" },
                { value: "NORMAL", label: "一般" },
                { value: "UNSATISFIED", label: "不满意" }
              ]}
            />
          </Form.Item>
          <Form.Item name="comment" label="评价原因" dependencies={["level"]} rules={[({ getFieldValue }) => ({ validator(_, value) { return ["NORMAL", "UNSATISFIED"].includes(getFieldValue("level")) && !value?.trim() ? Promise.reject(new Error("一般或不满意时请填写原因")) : Promise.resolve(); } })]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </EmployeeShell>
  );
}
