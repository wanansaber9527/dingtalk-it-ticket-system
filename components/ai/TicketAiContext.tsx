"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Collapse, Image, Space, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import { AI_ASSISTANT_NAME, type AiConversationDto } from "@/src/lib/ai";
import { MessageContent } from "./MessageContent";

// 这里只读取提单时的服务端快照，不读取员工随后继续的私人对话。
export function TicketAiContext({ ticketId }: { ticketId: string }) {
  const [conversation, setConversation] = useState<AiConversationDto | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setConversation(null);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/ai/ticket-context?ticketId=${encodeURIComponent(ticketId)}`, {
          cache: "no-store", signal: controller.signal
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) throw new Error(json.message || "AI 排查记录暂时无法加载");
        if (!controller.signal.aborted) setConversation(json.data.conversation);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "AI 排查记录暂时无法加载");
      }
    })();
    return () => controller.abort();
  }, [ticketId, revision]);

  if (error) return <Alert style={{ marginBottom: 16 }} type="warning" showIcon
    message="AI 排查记录未加载" description={error} action={<Button onClick={retry}>重试</Button>} />;
  if (!conversation) return null;

  return <section className="detail-section" aria-label="提交工单时的 AI 排查记录">
    <h2 className="detail-section-title"><RobotOutlined />AI 排查记录</h2>
    <Typography.Paragraph type="secondary">保留提交工单时的问题、排查过程和图片，供处理人继续跟进。</Typography.Paragraph>
    <Collapse items={[{
      key: "context",
      label: `${conversation.categoryName} · ${conversation.title}`,
      children: <div style={{ maxHeight: 560, overflowY: "auto", overflowWrap: "anywhere" }}>
        {(conversation.messages || []).filter(item => item.role === "user" || item.role === "assistant").map((item) => <article key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <Typography.Text strong>{item.role === "user" ? "申请人" : item.role === "assistant" ? AI_ASSISTANT_NAME : "系统记录"}</Typography.Text>
            <Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</Typography.Text>
          </div>
          {item.role === "assistant" ? <MessageContent content={item.content} /> : <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{item.content}</div>}
          {item.status === "FAILED" && <Typography.Text type="secondary">此条回答未完成</Typography.Text>}
          {item.attachments?.length > 0 && <Space wrap style={{ marginTop: 8 }}>
            {item.attachments.filter((attachment) => /^\/api\/uploads\/[a-zA-Z0-9._%-]+$/.test(attachment.url)).map((attachment, index) =>
              <Image key={`${attachment.url}-${index}`} src={attachment.url} alt={attachment.name || "问题截图"}
                width={120} style={{ maxHeight: 120, objectFit: "contain", borderRadius: 6 }} />)}
          </Space>}
        </article>)}
      </div>
    }]} />
  </section>;
}
