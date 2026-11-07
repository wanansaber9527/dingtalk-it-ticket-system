"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Image, Space, Tag, Timeline } from "antd";
import { ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, FileTextOutlined, PictureOutlined, StarOutlined, UserOutlined } from "@ant-design/icons";
import { UserAvatar } from "@/components/UserAvatar";
import { TicketStatusTag } from "./TicketStatusTag";
import { actionTypeLabels, priorityLabels, satisfactionLabels, ticketStatusLabels } from "@/src/lib/labels";
import { attachmentDisplayUrl, parseTicketAttachments } from "@/src/lib/attachments";
import styles from "./TicketOverview.module.css";

export type TicketActivityLog = {
  id: string;
  operatorName: string;
  actionType: keyof typeof actionTypeLabels;
  remark?: string | null;
  attachments?: string | null;
  createdAt: string;
};

export type TicketOverviewData = {
  id: string;
  ticketNo: string;
  title: string;
  categoryName: string;
  priority: keyof typeof priorityLabels;
  status: keyof typeof ticketStatusLabels;
  applicantName: string;
  applicant?: { avatar?: string | null } | null;
  applicantDepartment?: string | null;
  applicantPosition?: string | null;
  handlerUserId?: string | null;
  handlerName?: string | null;
  description: string;
  attachments?: string | null;
  resultSummary?: string | null;
  satisfactionLevel?: string | null;
  satisfactionComment?: string | null;
  createdAt: string;
  expectedResolveTime?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  slaFirstResponseDeadline?: string | null;
  slaResolveDeadline?: string | null;
  logs: TicketActivityLog[];
};

function dateTime(value?: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
}

function AttachmentImages({ value, compact = false }: { value?: string | null; compact?: boolean }) {
  const attachments = parseTicketAttachments(value || undefined);
  if (!attachments.length) return null;
  return (
    <Image.PreviewGroup>
      <Space wrap className="attachment-preview-grid ticket-attachments">
        {attachments.map((item) => (
          <figure key={item.url}>
            <Image src={attachmentDisplayUrl(item.url)} alt={item.name} width={compact ? 88 : 144} height={compact ? 88 : 112} style={{ objectFit: "cover", borderRadius: 6 }} />
            {!compact && <figcaption title={item.name}>{item.name}</figcaption>}
          </figure>
        ))}
      </Space>
    </Image.PreviewGroup>
  );
}

export function TicketOverview({ ticket, backHref, backLabel, actions, notice, children, aside, loading = false }: {
  ticket: TicketOverviewData;
  backHref: string;
  backLabel: string;
  actions?: ReactNode;
  notice?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  loading?: boolean;
}) {
  const attachments = parseTicketAttachments(ticket.attachments || undefined);
  const satisfaction = ticket.satisfactionLevel
    ? satisfactionLabels[ticket.satisfactionLevel as keyof typeof satisfactionLabels] || ticket.satisfactionLevel
    : "未评价";
  return (
    <article className="ticket-detail" aria-busy={loading}>
      <Link href={backHref} className="ticket-detail-back"><ArrowLeftOutlined />{backLabel}</Link>
      <header className="ticket-detail-hero">
        <div>
          <div className="ticket-detail-meta">
            <span>{ticket.ticketNo}</span>
            <TicketStatusTag status={ticket.status} />
            <Tag color={ticket.priority === "URGENT" ? "error" : ticket.priority === "HIGH" ? "warning" : undefined}>紧急程度 · {priorityLabels[ticket.priority]}</Tag>
          </div>
          <h1>{ticket.title}</h1>
          <p className="muted">{ticket.applicantName} 提交于 <time dateTime={ticket.createdAt}>{dateTime(ticket.createdAt)}</time></p>
        </div>
        {actions && <div className="ticket-actions">{actions}</div>}
      </header>
      {notice}
      <div className="ticket-detail-grid">
        <div className="ticket-detail-main">
          <section className="detail-section">
            <h2 className="detail-section-title"><FileTextOutlined />问题描述</h2>
            <div className={styles.category}>
              <span className={styles.categoryLabel}>问题分类</span>
              <Tag className={styles.categoryTag}>{ticket.categoryName}</Tag>
            </div>
            <div className="timeline-note ticket-description">{ticket.description}</div>
            <div className="ticket-screenshots">
              <h3 className="detail-section-title"><PictureOutlined />问题截图 <span className="muted">{attachments.length ? `${attachments.length} 张` : "未添加图片"}</span></h3>
              <AttachmentImages value={ticket.attachments} />
            </div>
          </section>
          {ticket.resultSummary && (
            <section className="detail-section ticket-result">
              <h2 className="detail-section-title"><CheckCircleOutlined />处理结果</h2>
              <div className="timeline-note">{ticket.resultSummary}</div>
            </section>
          )}
          {(ticket.satisfactionLevel || ticket.satisfactionComment) && (
            <section className="detail-section ticket-feedback">
              <h2 className="detail-section-title"><StarOutlined />满意度评价</h2>
              <strong>{satisfaction}</strong>
              {ticket.satisfactionComment && <p className="timeline-note">{ticket.satisfactionComment}</p>}
            </section>
          )}
          {children}
          <section className="detail-section ticket-activity">
            <h2 className="detail-section-title"><ClockCircleOutlined />流转记录 <span className="muted">{ticket.logs.length} 条</span></h2>
            {ticket.logs.length ? <Timeline items={ticket.logs.map((log) => ({
              key: log.id,
              children: (
                <div>
                  <div className="ticket-activity-heading"><strong>{actionTypeLabels[log.actionType] || log.actionType}</strong><time dateTime={log.createdAt}>{dateTime(log.createdAt)}</time></div>
                  <div className="muted">{log.operatorName}</div>
                  {log.remark && <div className="timeline-note">{log.remark}</div>}
                  <AttachmentImages value={log.attachments} compact />
                </div>
              )
            }))} /> : <p className="muted">暂无流转记录</p>}
          </section>
        </div>
        <aside className="ticket-detail-aside">
          <section className="detail-section">
            <h2 className="detail-section-title"><UserOutlined />提交人信息</h2>
            <div className={styles.applicantProfile}>
              <UserAvatar user={{ name: ticket.applicantName, avatar: ticket.applicant?.avatar }} size={48} />
              <strong className={styles.applicantName}>{ticket.applicantName}</strong>
            </div>
            <dl className="detail-facts">
              <div><dt>所属部门</dt><dd>{ticket.applicantDepartment || "未填写"}</dd></div>
              <div><dt>岗位</dt><dd>{ticket.applicantPosition || "未填写"}</dd></div>
            </dl>
          </section>
          <section className="detail-section">
            <h2 className="detail-section-title"><ClockCircleOutlined />处理信息</h2>
            <dl className="detail-facts">
              <div><dt>处理人</dt><dd>{ticket.handlerName || "待分派"}</dd></div>
              <div><dt>首响截止</dt><dd>{dateTime(ticket.slaFirstResponseDeadline)}</dd></div>
              <div><dt>完成截止</dt><dd>{dateTime(ticket.slaResolveDeadline)}</dd></div>
              {ticket.expectedResolveTime && <div><dt>期望解决时间</dt><dd>{dateTime(ticket.expectedResolveTime)}</dd></div>}
              {ticket.firstResponseAt && <div><dt>首次响应</dt><dd>{dateTime(ticket.firstResponseAt)}</dd></div>}
              {ticket.resolvedAt && <div><dt>完成时间</dt><dd>{dateTime(ticket.resolvedAt)}</dd></div>}
              {ticket.closedAt && <div><dt>关闭时间</dt><dd>{dateTime(ticket.closedAt)}</dd></div>}
            </dl>
          </section>
          {aside}
        </aside>
      </div>
    </article>
  );
}
