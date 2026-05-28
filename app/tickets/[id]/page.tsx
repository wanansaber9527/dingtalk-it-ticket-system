"use client";

// 中文注释：员工端工单页面，提供提交、查看和确认评价等移动端体验。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Form, Image, Input, Modal, Radio, Space, Timeline, Typography, message } from "antd";
import { CommentOutlined, StarOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { actionTypeLabels, priorityLabels } from "@/src/lib/labels";
import { apiGet, apiPost } from "@/src/lib/clientApi";
import { attachmentDisplayUrl, parseTicketAttachments } from "@/src/lib/attachments";

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
  status: never;
  applicantName: string;
  applicantDepartment?: string;
  handlerName?: string;
  description: string;
  attachments?: string;
  resultSummary?: string;
  satisfactionLevel?: string;
  satisfactionComment?: string;
  logs: TicketLog[];
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [satisfactionOpen, setSatisfactionOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    apiGet<Ticket>(`/api/tickets/${params.id}`).then(setTicket).catch((error) => message.error(error.message));
  };

  useEffect(() => {
    load();
  }, [params.id]);

  async function submitAction(url: string, values?: unknown) {
    try {
      await apiPost(url, values || {});
      message.success("操作成功");
      setCommentOpen(false);
      setSatisfactionOpen(false);
      form.resetFields();
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <EmployeeShell title="工单详情">
      {ticket && (
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          {(() => {
            const attachments = parseTicketAttachments(ticket.attachments);
            return (
              <>
          <Card size="small">
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Space style={{ justifyContent: "space-between", width: "100%" }}>
                <Typography.Text strong>{ticket.ticketNo}</Typography.Text>
                <TicketStatusTag status={ticket.status} />
              </Space>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {ticket.title}
              </Typography.Title>
              <div className="muted">
                {ticket.categoryName} · {priorityLabels[ticket.priority]} · 处理人：{ticket.handlerName || "待分派"}
              </div>
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
                      width={112}
                      height={112}
                      style={{ objectFit: "cover", borderRadius: 10 }}
                    />
                  ))}
                </Space>
              </Image.PreviewGroup>
            </Card>
          )}

          {ticket.resultSummary && (
            <Card size="small" title="处理结果">
              <div className="timeline-note">{ticket.resultSummary}</div>
            </Card>
          )}

          <Space wrap>
            <Button icon={<CommentOutlined />} onClick={() => setCommentOpen(true)}>
              补充说明
            </Button>
            <Button icon={<StarOutlined />} disabled={!["COMPLETED", "CLOSED"].includes(ticket.status as string)} onClick={() => setSatisfactionOpen(true)}>
              满意度
            </Button>
          </Space>

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
            );
          })()}
        </Space>
      )}

      <Modal title="补充说明" open={commentOpen} onCancel={() => setCommentOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={(values) => submitAction(`/api/tickets/${params.id}/comments`, values)}>
          <Form.Item name="remark" label="说明" rules={[{ required: true, message: "请填写说明" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="满意度评价" open={satisfactionOpen} onCancel={() => setSatisfactionOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={(values) => submitAction(`/api/tickets/${params.id}/satisfaction`, values)}>
          <Form.Item name="level" label="满意度" rules={[{ required: true, message: "请选择满意度" }]}>
            <Radio.Group
              options={[
                { value: "SATISFIED", label: "满意" },
                { value: "NORMAL", label: "一般" },
                { value: "UNSATISFIED", label: "不满意" }
              ]}
            />
          </Form.Item>
          <Form.Item name="comment" label="评价原因">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </EmployeeShell>
  );
}
