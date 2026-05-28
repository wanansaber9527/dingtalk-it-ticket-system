"use client";

// 中文注释：处理人工单详情页，提供接单、备注、转交和完成处理能力。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Form, Image, Input, Select, Space, Switch, Timeline, Typography, message } from "antd";
import { CheckCircleOutlined, CommentOutlined, PlayCircleOutlined, RollbackOutlined, SwapOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { actionTypeLabels, priorityLabels } from "@/src/lib/labels";
import { apiGet, apiPost } from "@/src/lib/clientApi";
import { attachmentDisplayUrl, parseTicketAttachments } from "@/src/lib/attachments";

type Handler = {
  dingtalkUserId: string;
  name: string;
};

type TicketLog = {
  id: string;
  operatorName: string;
  actionType: keyof typeof actionTypeLabels;
  remark?: string;
  createdAt: string;
};

type Ticket = {
  id: string;
  ticketNo: string;
  title: string;
  categoryName: string;
  priority: keyof typeof priorityLabels;
  status: "PENDING" | "ASSIGNED" | "PROCESSING" | "COMPLETED" | "CLOSED" | "REJECTED" | "CANCELLED";
  applicantName: string;
  applicantDepartment?: string;
  applicantPosition?: string;
  handlerUserId?: string;
  handlerName?: string;
  description: string;
  attachments?: string;
  resultSummary?: string;
  createdAt: string;
  slaFirstResponseDeadline?: string;
  slaResolveDeadline?: string;
  logs: TicketLog[];
};

function canAccept(status: Ticket["status"]) {
  return status === "ASSIGNED" || status === "PENDING";
}

function canResolve(status: Ticket["status"]) {
  return status === "ASSIGNED" || status === "PROCESSING";
}

export default function HandlerTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [loading, setLoading] = useState(false);
  const [commentForm] = Form.useForm();
  const [resolveForm] = Form.useForm();
  const [transferForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiGet<Ticket>(`/api/tickets/${params.id}`);
      setTicket(data);
      transferForm.setFieldsValue({ handlerUserId: data.handlerUserId });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    apiGet<Handler[]>("/api/admin/users?role=handlers").then(setHandlers).catch(() => null);
  }, [params.id]);

  const attachments = useMemo(() => parseTicketAttachments(ticket?.attachments), [ticket?.attachments]);

  async function run(url: string, body?: unknown) {
    try {
      await apiPost(url, body || {});
      message.success("操作成功");
      commentForm.resetFields();
      resolveForm.resetFields();
      if (url.endsWith("/transfer")) {
        router.push("/handler/tickets");
        return;
      }
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <EmployeeShell title="处理详情">
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Link href="/handler/tickets">
          <Button icon={<RollbackOutlined />}>返回列表</Button>
        </Link>

        {ticket && (
          <>
            <Card size="small" loading={loading}>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space align="center" style={{ justifyContent: "space-between", width: "100%" }}>
                  <Typography.Text strong>{ticket.ticketNo}</Typography.Text>
                  <TicketStatusTag status={ticket.status as never} />
                </Space>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {ticket.title}
                </Typography.Title>
                <div className="muted">
                  {ticket.categoryName} · {priorityLabels[ticket.priority]} · 申请人：{ticket.applicantName}
                </div>
                <div className="muted">
                  {ticket.applicantDepartment || "-"} · 岗位：{ticket.applicantPosition || "-"}
                </div>
                <div className="muted">处理人：{ticket.handlerName || "待分派"}</div>
                <div className="muted">提交时间：{new Date(ticket.createdAt).toLocaleString()}</div>
                <div className="muted">首响截止：{ticket.slaFirstResponseDeadline ? new Date(ticket.slaFirstResponseDeadline).toLocaleString() : "-"}</div>
                <div className="muted">完成截止：{ticket.slaResolveDeadline ? new Date(ticket.slaResolveDeadline).toLocaleString() : "-"}</div>
              </Space>
            </Card>

            <Card size="small" title="问题描述">
              <div className="timeline-note">{ticket.description}</div>
            </Card>

            {attachments.length > 0 && (
              <Card size="small" title="问题截图">
                <Image.PreviewGroup>
                  <Space wrap className="attachment-preview-grid">
                    {attachments.map((item) => (
                      <Image
                        key={item.url}
                        src={attachmentDisplayUrl(item.url)}
                        alt={item.name}
                        width={104}
                        height={104}
                        style={{ objectFit: "cover", borderRadius: 10 }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </Card>
            )}

            <Card size="small" title="快捷处理">
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Button
                  block
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  disabled={!canAccept(ticket.status)}
                  onClick={() => run(`/api/tickets/${ticket.id}/status`, { status: "PROCESSING", remark: "处理人接单" })}
                >
                  接单并开始处理
                </Button>
                <Form form={resolveForm} layout="vertical" onFinish={(values) => run(`/api/tickets/${ticket.id}/resolve`, values)}>
                  <Form.Item name="resultSummary" label="处理结果" rules={[{ required: true, message: "请填写处理结果" }]}>
                    <Input.TextArea rows={4} placeholder="填写处理过程、解决方式和结果" />
                  </Form.Item>
                  <Form.Item name="toKnowledgeBase" label="沉淀为知识库草稿" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Button block type="primary" htmlType="submit" icon={<CheckCircleOutlined />} disabled={!canResolve(ticket.status)}>
                    标记处理完成
                  </Button>
                </Form>
              </Space>
            </Card>

            <Card size="small" title="备注与转交">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Form form={commentForm} layout="vertical" onFinish={(values) => run(`/api/tickets/${ticket.id}/comments`, values)}>
                  <Form.Item name="remark" label="处理备注" rules={[{ required: true, message: "请填写处理备注" }]}>
                    <Input.TextArea rows={3} placeholder="补充处理进展或需要申请人配合的信息" />
                  </Form.Item>
                  <Button block htmlType="submit" icon={<CommentOutlined />}>
                    添加备注
                  </Button>
                </Form>

                <Form form={transferForm} layout="vertical" onFinish={(values) => run(`/api/tickets/${ticket.id}/transfer`, values)}>
                  <Form.Item name="handlerUserId" label="转交给" rules={[{ required: true, message: "请选择处理人" }]}>
                    <Select placeholder="选择处理人" options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} />
                  </Form.Item>
                  <Form.Item name="remark" label="转交说明">
                    <Input placeholder="可填写转交原因" />
                  </Form.Item>
                  <Button block htmlType="submit" icon={<SwapOutlined />}>
                    转交工单
                  </Button>
                </Form>
              </Space>
            </Card>

            {ticket.resultSummary && (
              <Card size="small" title="处理结果">
                <div className="timeline-note">{ticket.resultSummary}</div>
              </Card>
            )}

            <Card size="small" title="流转记录">
              <Timeline
                items={ticket.logs.map((log) => ({
                  children: (
                    <div>
                      <Typography.Text strong>{actionTypeLabels[log.actionType]}</Typography.Text>
                      <div className="muted">
                        {log.operatorName} · {new Date(log.createdAt).toLocaleString()}
                      </div>
                      {log.remark && <div className="timeline-note">{log.remark}</div>}
                    </div>
                  )
                }))}
              />
            </Card>
          </>
        )}
      </Space>
    </EmployeeShell>
  );
}
