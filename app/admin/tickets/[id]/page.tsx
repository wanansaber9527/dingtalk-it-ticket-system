"use client";

// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, Col, Descriptions, Form, Input, Row, Select, Space, Switch, Timeline, Typography, message } from "antd";
import {
  CheckCircleOutlined,
  CommentOutlined,
  ReloadOutlined,
  SendOutlined,
  SwapOutlined,
  SyncOutlined
} from "@ant-design/icons";
import { TicketStatusTag } from "@/components/tickets/TicketStatusTag";
import { actionTypeLabels, priorityLabels, ticketStatusLabels } from "@/src/lib/labels";
import { apiGet, apiPost } from "@/src/lib/clientApi";

type Handler = { dingtalkUserId: string; name: string };
type Log = {
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
  applicantPosition?: string;
  handlerUserId?: string;
  handlerName?: string;
  description: string;
  resultSummary?: string;
  satisfactionLevel?: string;
  satisfactionComment?: string;
  aiSyncStatus: string;
  aiSyncError?: string;
  createdAt: string;
  slaFirstResponseDeadline?: string;
  slaResolveDeadline?: string;
  logs: Log[];
};

export default function AdminTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignForm] = Form.useForm();
  const [statusForm] = Form.useForm();
  const [resolveForm] = Form.useForm();
  const [commentForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiGet<Ticket>(`/api/admin/tickets/${params.id}`);
      setTicket(data);
      assignForm.setFieldsValue({ handlerUserId: data.handlerUserId });
      statusForm.setFieldsValue({ status: data.status });
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

  async function run(url: string, body?: unknown) {
    try {
      await apiPost(url, body || {});
      message.success("操作成功");
      assignForm.resetFields();
      statusForm.resetFields();
      resolveForm.resetFields();
      commentForm.resetFields();
      load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          工单详情
        </Typography.Title>
        <div className="muted">{ticket?.ticketNo}</div>
      </div>

      {ticket && (
        <>
          <Card loading={loading}>
            <Descriptions column={{ xs: 1, md: 2, xl: 3 }} bordered size="small">
              <Descriptions.Item label="工单编号">{ticket.ticketNo}</Descriptions.Item>
              <Descriptions.Item label="当前状态">
                <TicketStatusTag status={ticket.status} />
              </Descriptions.Item>
              <Descriptions.Item label="AI同步">
                {ticket.aiSyncStatus}
                {ticket.aiSyncError ? `：${ticket.aiSyncError}` : ""}
              </Descriptions.Item>
              <Descriptions.Item label="标题">{ticket.title}</Descriptions.Item>
              <Descriptions.Item label="分类">{ticket.categoryName}</Descriptions.Item>
              <Descriptions.Item label="紧急程度">{priorityLabels[ticket.priority]}</Descriptions.Item>
              <Descriptions.Item label="申请人">{ticket.applicantName}</Descriptions.Item>
              <Descriptions.Item label="部门">{ticket.applicantDepartment || "-"}</Descriptions.Item>
              <Descriptions.Item label="岗位">{ticket.applicantPosition || "-"}</Descriptions.Item>
              <Descriptions.Item label="处理人">{ticket.handlerName || "待分派"}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{new Date(ticket.createdAt).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="首响截止">{ticket.slaFirstResponseDeadline ? new Date(ticket.slaFirstResponseDeadline).toLocaleString() : "-"}</Descriptions.Item>
              <Descriptions.Item label="完成截止">{ticket.slaResolveDeadline ? new Date(ticket.slaResolveDeadline).toLocaleString() : "-"}</Descriptions.Item>
              <Descriptions.Item label="问题描述" span={3}>
                <div className="timeline-note">{ticket.description}</div>
              </Descriptions.Item>
              <Descriptions.Item label="处理结果" span={3}>
                <div className="timeline-note">{ticket.resultSummary || "-"}</div>
              </Descriptions.Item>
              <Descriptions.Item label="满意度" span={3}>
                {ticket.satisfactionLevel || "-"} {ticket.satisfactionComment || ""}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card title="分派/转交">
                <Form form={assignForm} layout="inline" onFinish={(values) => run(`/api/admin/tickets/${ticket.id}/assign`, values)}>
                  <Form.Item name="handlerUserId" rules={[{ required: true, message: "请选择处理人" }]} style={{ minWidth: 220 }}>
                    <Select options={handlers.map((item) => ({ value: item.dingtalkUserId, label: item.name }))} placeholder="处理人" />
                  </Form.Item>
                  <Form.Item name="remark" style={{ minWidth: 220 }}>
                    <Input placeholder="备注" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" icon={<SendOutlined />}>
                      分派
                    </Button>
                    <Button icon={<SwapOutlined />} onClick={() => run(`/api/admin/tickets/${ticket.id}/transfer`, assignForm.getFieldsValue())}>
                      转交
                    </Button>
                  </Space>
                </Form>
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="状态处理">
                <Form form={statusForm} layout="inline" onFinish={(values) => run(`/api/admin/tickets/${ticket.id}/status`, values)}>
                  <Form.Item name="status" rules={[{ required: true }]} style={{ minWidth: 220 }}>
                    <Select options={Object.entries(ticketStatusLabels).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                  <Form.Item name="remark" style={{ minWidth: 220 }}>
                    <Input placeholder="备注" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />}>
                    更新
                  </Button>
                </Form>
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="标记处理完成">
                <Form
                  form={resolveForm}
                  layout="vertical"
                  onFinish={(values) => run(`/api/admin/tickets/${ticket.id}/resolve`, values)}
                >
                  <Form.Item name="resultSummary" label="处理结果" rules={[{ required: true, message: "请填写处理结果" }]}>
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Form.Item name="toKnowledgeBase" label="沉淀为知识库草稿" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />}>
                    完成处理
                  </Button>
                </Form>
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="备注与同步">
                <Form
                  form={commentForm}
                  layout="vertical"
                  onFinish={(values) => run(`/api/tickets/${ticket.id}/comments`, values)}
                >
                  <Form.Item name="remark" label="处理备注" rules={[{ required: true, message: "请填写备注" }]}>
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Space wrap>
                    <Button htmlType="submit" icon={<CommentOutlined />}>
                      添加备注
                    </Button>
                    <Button icon={<SyncOutlined />} onClick={() => run(`/api/admin/tickets/${ticket.id}/sync-ai-table`)}>
                      重新同步AI表格
                    </Button>
                    <Button danger icon={<ReloadOutlined />} onClick={() => run(`/api/admin/tickets/${ticket.id}/close`, { remark: "管理员关闭" })}>
                      关闭工单
                    </Button>
                  </Space>
                </Form>
              </Card>
            </Col>
          </Row>

          <Card title="流转日志">
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
  );
}
