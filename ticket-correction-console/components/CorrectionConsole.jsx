"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import {
  PRIORITY_LABELS,
  SATISFACTION_LABELS,
  SATISFACTION_LEVELS,
  STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES
} from "@/lib/constants";
import {
  formatShanghai,
  toShanghaiInputValue
} from "@/lib/time";
import { withBasePath } from "@/lib/public-config";

import { DATE_FIELDS, draftPayloadFields, previewTicketCorrection } from "@/lib/ticket-preview";

function ticketToDraft(ticket) {
  return {
    title: ticket.title || "",
    categoryName: ticket.categoryName || "",
    priority: ticket.priority,
    status: ticket.status,
    applicantName: ticket.applicantName || "",
    applicantDepartment: ticket.applicantDepartment || "",
    applicantPosition: ticket.applicantPosition || "",
    handlerUserId: ticket.handlerUserId || "",
    handlerName: ticket.handlerName || "",
    description: ticket.description || "",
    createdAt: toShanghaiInputValue(ticket.createdAt),
    expectedResolveTime: toShanghaiInputValue(ticket.expectedResolveTime),
    firstResponseAt: toShanghaiInputValue(ticket.firstResponseAt),
    slaFirstResponseDeadline: toShanghaiInputValue(ticket.slaFirstResponseDeadline),
    resolvedAt: toShanghaiInputValue(ticket.resolvedAt),
    slaResolveDeadline: toShanghaiInputValue(ticket.slaResolveDeadline),
    closedAt: toShanghaiInputValue(ticket.closedAt),
    resultSummary: ticket.resultSummary || "",
    satisfactionLevel: ticket.satisfactionLevel || "",
    satisfactionComment: ticket.satisfactionComment || ""
  };
}

function formatDiffValue(field, value) {
  if (DATE_FIELDS.includes(field)) {
    return value ? formatShanghai(value) : "未设置";
  }
  if (field === "status") return STATUS_LABELS[value] || value || "未设置";
  if (field === "priority") return PRIORITY_LABELS[value] || value || "未设置";
  if (field === "satisfactionLevel") {
    return SATISFACTION_LABELS[value] || "未设置";
  }
  if (field === "isFirstResponseOverdue" || field === "isResolveOverdue") {
    return value ? "超时" : "正常";
  }
  return value || "未设置";
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{STATUS_LABELS[status] || status}</span>;
}

function OverdueBadge({ overdue, label }) {
  return (
    <span className={`metric-badge ${overdue ? "metric-badge-danger" : "metric-badge-ok"}`}>
      {label}：{overdue ? "超时" : "正常"}
    </span>
  );
}

function DateField({ label, name, value, onChange, required = false, help }) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b className="required-mark">必填</b>}
      </span>
      <input
        type="datetime-local"
        step="0.001"
        name={name}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        required={required}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

export function CorrectionConsole({ session }) {
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [ticket, setTicket] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reason, setReason] = useState("");
  const [searching, setSearching] = useState(true);
  const [loadingTicket, setLoadingTicket] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [health, setHealth] = useState(null);
  const dialogRef = useRef(null);
  const detailRequestRef = useRef(0);
  const searchRequestRef = useRef(0);

  const previewState = useMemo(() => {
    if (!ticket || !draft) return { plan: null, error: "" };
    try {
      return { plan: previewTicketCorrection(ticket, draft), error: "" };
    } catch {
      return { plan: null, error: "时间格式无效，请检查后重新选择" };
    }
  }, [ticket, draft]);
  const preview = {
    firstResponse: previewState.plan?.next.isFirstResponseOverdue ?? Boolean(ticket?.isFirstResponseOverdue),
    resolve: previewState.plan?.next.isResolveOverdue ?? Boolean(ticket?.isResolveOverdue)
  };
  const changes = (previewState.plan?.changes || []).map((change) => ({
    ...change,
    before: formatDiffValue(change.field, change.before),
    after: formatDiffValue(change.field, change.after)
  }));

  const availableStatuses =
    health?.supportedStatuses?.length > 0
      ? TICKET_STATUSES.filter((status) => health.supportedStatuses.includes(status))
      : TICKET_STATUSES;

  async function loadHealth() {
    try {
      const result = await apiRequest("/api/health");
      setHealth(result);
      return result;
    } catch (requestError) {
      const unavailable = {
        ready: false,
        message: requestError instanceof Error ? requestError.message : "数据库核对失败"
      };
      setHealth(unavailable);
      return unavailable;
    }
  }

  async function search(nextQuery = query, options = {}) {
    const requestNumber = ++searchRequestRef.current;
    setSearching(true);
    if (!options.keepMessages) {
      setError("");
      setNotice("");
    }
    try {
      const result = await apiRequest(`/api/tickets?q=${encodeURIComponent(nextQuery.trim())}`);
      if (requestNumber !== searchRequestRef.current) return;
      setTickets(result);
      if (options.selectId) {
        await selectTicket(options.selectId, { quiet: true });
      }
    } catch (requestError) {
      if (requestNumber === searchRequestRef.current) handleRequestError(requestError, "工单查询失败");
    } finally {
      if (requestNumber === searchRequestRef.current) setSearching(false);
    }
  }

  async function selectTicket(id, options = {}) {
    const requestNumber = ++detailRequestRef.current;
    setSelectedId(id);
    setLoadingTicket(true);
    if (!options.quiet) {
      setError("");
      setNotice("");
    }
    try {
      const result = await apiRequest(`/api/tickets/${encodeURIComponent(id)}`);
      if (requestNumber !== detailRequestRef.current) return;
      setTicket(result);
      setDraft(ticketToDraft(result));
      setReason("");
      setConfirming(false);
    } catch (requestError) {
      if (requestNumber === detailRequestRef.current) handleRequestError(requestError, "工单加载失败");
    } finally {
      if (requestNumber === detailRequestRef.current) setLoadingTicket(false);
    }
  }

  function handleRequestError(requestError, fallback) {
    if (requestError?.status === 401) {
      window.location.assign(withBasePath("/login"));
      return;
    }
    setError(requestError instanceof Error ? requestError.message : fallback);
  }

  useEffect(() => {
    async function initialize() {
      const result = await loadHealth();
      if (result.ready) {
        await search("", { keepMessages: true });
      } else {
        setSearching(false);
      }
    }
    initialize();
  }, []);

  useEffect(() => {
    if (!confirming) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [confirming]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice("");
  }

  function requestSave(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!health?.ready) {
      setError("数据库核查尚未通过，暂时无法保存");
      return;
    }
    if (reason.trim().length < 4) {
      setError("请填写至少 4 个字的更正原因");
      return;
    }
    if (previewState.error) {
      setError(previewState.error);
      return;
    }
    if (!changes.length) {
      setError("没有检测到需要保存的更正");
      return;
    }
    setConfirming(true);
  }

  async function commitSave() {
    if (!ticket || !draft) return;
    setSaving(true);
    setError("");
    try {
      const fields = draftPayloadFields(draft);

      const result = await apiRequest(`/api/tickets/${encodeURIComponent(ticket.id)}`, {
        method: "PATCH",
        headers: {
          "x-correction-csrf": session.csrf,
          "x-request-id": crypto.randomUUID()
        },
        body: JSON.stringify({
          expectedUpdatedAt: ticket.updatedAt,
          expectedFingerprint: ticket.fingerprint,
          reason: reason.trim(),
          fields
        })
      });
      setTicket(result.ticket);
      setDraft(ticketToDraft(result.ticket));
      setReason("");
      setConfirming(false);
      setNotice(
        result.auditPending
          ? `数据已保存 ${result.changes.length} 项；独立更正记录待自动核对，后续写入将暂停`
          : `已静默更正 ${result.changes.length} 项数据，主工单时间线和通知记录均未写入`
      );
      await Promise.all([loadHealth(), search(query, { keepMessages: true })]);
    } catch (requestError) {
      setConfirming(false);
      handleRequestError(requestError, "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", {
        method: "POST",
        headers: { "x-correction-csrf": session.csrf },
        body: JSON.stringify({})
      });
    } finally {
      window.location.assign(withBasePath("/login"));
    }
  }

  return (
    <div className="console-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">IT</span>
          <div>
            <strong>趣然 · IT 工作台</strong>
            <span>数据维护</span>
          </div>
        </div>
        <div className="topbar-actions">
          {process.env.NEXT_PUBLIC_LOCAL_PREVIEW === "true" && <span className="local-preview-badge">本地预览 · 示例数据</span>}
          <span className={`readiness ${health?.ready ? "readiness-ok" : "readiness-blocked"}`}>
            {health === null ? "正在核对数据库" : health.ready ? "可以保存" : "保存已暂停"}
          </span>
          <span className="signed-user">账号：{session.username}</span>
          <button className="button button-quiet" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      <main className="console-main" id="main-content">
        <div className="console-heading">
          <div>
            <p className="section-kicker">数据维护 / 工单</p>
            <h1>工单更正</h1>
            <p>查找工单，核对信息，保存有据可查的更正。</p>
          </div>
          <span className="timezone-label">北京时间 UTC+8</span>
        </div>
        <section className="scope-notice">
          <div>
            <strong>静默更正范围</strong>
            <span>更正不会发送通知，也不会加入普通工单时间线。保存前请核对字段差异。</span>
          </div>
        </section>

        {health && !health.ready && (
          <div className="inline-alert inline-alert-error" role="alert">
            {health.message ||
              (health.triggerCount
                ? "Ticket 表存在数据库触发器，无法保证静默写入"
                : `数据库结构未通过核对${health.missingColumns?.length ? `，缺少：${health.missingColumns.join("、")}` : ""}`)}
          </div>
        )}
        {error && (
          <div className="inline-alert inline-alert-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="inline-alert inline-alert-success" role="status">
            {notice}
          </div>
        )}

        <div className="correction-workspace">
          <aside className="ticket-browser" aria-label="工单查询结果">
            <form
              className="search-form"
              onSubmit={(event) => {
                event.preventDefault();
                search();
              }}
            >
              <label htmlFor="ticket-search">查找工单</label>
              <div className="search-row">
                <input
                  id="ticket-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="工单号、标题、申请人"
                />
                <button
                  className="button button-secondary"
                  type="submit"
                  disabled={searching || !health?.ready}
                >
                  查询
                </button>
              </div>
            </form>

            <div className="result-summary">
              <span>{searching ? "正在查询" : `共 ${tickets.length} 条`}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => search()}
                disabled={searching || !health?.ready}
              >
                刷新
              </button>
            </div>

            <div className="ticket-list" aria-busy={searching}>
              {searching && !tickets.length ? (
                Array.from({ length: 6 }, (_, index) => (
                  <div className="ticket-skeleton" key={index}>
                    <span />
                    <span />
                    <span />
                  </div>
                ))
              ) : tickets.length ? (
                tickets.map((item) => (
                  <button
                    type="button"
                    className={`ticket-row ${selectedId === item.id ? "ticket-row-selected" : ""}`}
                    key={item.id}
                    onClick={() => selectTicket(item.id)}
                    disabled={saving || confirming}
                    aria-current={selectedId === item.id ? "true" : undefined}
                  >
                    <span className="ticket-row-top">
                      <b>{item.ticketNo}</b>
                      <StatusBadge status={item.status} />
                    </span>
                    <span className="ticket-row-title">{item.title}</span>
                    <span className="ticket-row-meta">
                      {item.applicantName} · {item.handlerName || "未分派"}
                    </span>
                    <span className="ticket-row-meta">
                      更新于 {formatShanghai(item.updatedAt)}
                    </span>
                  </button>
                ))
              ) : health && !health.ready ? (
                <div className="empty-list">
                  <strong>数据库暂不可读取</strong>
                  <span>完成正式数据库配置并通过结构核对后，可在这里查询工单。</span>
                </div>
              ) : (
                <div className="empty-list">
                  <strong>没有找到工单</strong>
                  <span>更换关键词后重新查询。</span>
                </div>
              )}
            </div>
          </aside>

          <section className="ticket-editor" aria-label="工单更正表单">
            {loadingTicket ? (
              <div className="editor-loading" aria-busy="true">
                <div />
                <div />
                <div />
                <div />
              </div>
            ) : ticket && draft ? (
              <form onSubmit={requestSave}>
                <div className="editor-heading">
                  <div>
                    <div className="heading-line">
                      <h1>{ticket.ticketNo}</h1>
                      <StatusBadge status={draft.status} />
                    </div>
                    <p>{ticket.title}</p>
                  </div>
                  <div className="metric-badges">
                    <OverdueBadge overdue={preview.firstResponse} label="首响" />
                    <OverdueBadge overdue={preview.resolve} label="处理" />
                    <span className={`metric-badge ${preview.firstResponse || preview.resolve ? "metric-badge-danger" : "metric-badge-ok"}`}>
                      总 SLA：{preview.firstResponse || preview.resolve ? "超时" : "正常"}
                    </span>
                  </div>
                </div>

                <section className="form-section">
                  <div className="form-section-heading">
                    <h2>基础信息</h2>
                    <p>工单编号和技术主键保持只读。</p>
                  </div>
                  <div className="form-grid form-grid-3">
                    <label className="field field-span-2">
                      <span>工单标题</span>
                      <input value={draft.title} onChange={(event) => updateField("title", event.target.value)} required />
                    </label>
                    <label className="field">
                      <span>工单分类</span>
                      <input value={draft.categoryName} onChange={(event) => updateField("categoryName", event.target.value)} required />
                    </label>
                    <label className="field">
                      <span>紧急程度</span>
                      <select value={draft.priority} onChange={(event) => updateField("priority", event.target.value)}>
                        {TICKET_PRIORITIES.map((priority) => (
                          <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>工单状态</span>
                      <select value={draft.status} onChange={(event) => updateField("status", event.target.value)}>
                        {availableStatuses.map((status) => (
                          <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>申请人</span>
                      <input value={draft.applicantName} onChange={(event) => updateField("applicantName", event.target.value)} required />
                    </label>
                    <label className="field">
                      <span>申请部门</span>
                      <input value={draft.applicantDepartment} onChange={(event) => updateField("applicantDepartment", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>申请岗位</span>
                      <input value={draft.applicantPosition} onChange={(event) => updateField("applicantPosition", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>处理人姓名</span>
                      <input value={draft.handlerName} onChange={(event) => updateField("handlerName", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>处理人用户 ID</span>
                      <input value={draft.handlerUserId} onChange={(event) => updateField("handlerUserId", event.target.value)} spellCheck="false" />
                    </label>
                    <div className="field read-only-field">
                      <span>申请人用户 ID</span>
                      <output>{ticket.applicantUserId}</output>
                    </div>
                  </div>
                </section>

                <section className="form-section">
                  <div className="form-section-heading">
                    <h2>时间与 SLA</h2>
                    <p>修改完成时间或 SLA 截止时间后，处理超时会自动双向重算。</p>
                  </div>
                  <div className="form-grid form-grid-3">
                    <DateField label="提交时间" name="createdAt" value={draft.createdAt} onChange={updateField} required />
                    <DateField label="期望完成时间" name="expectedResolveTime" value={draft.expectedResolveTime} onChange={updateField} />
                    <div className="field read-only-field">
                      <span>最后更新时间</span>
                      <output>{formatShanghai(ticket.updatedAt)}</output>
                    </div>
                    <DateField label="首次响应时间" name="firstResponseAt" value={draft.firstResponseAt} onChange={updateField} />
                    <DateField label="首响 SLA 截止" name="slaFirstResponseDeadline" value={draft.slaFirstResponseDeadline} onChange={updateField} />
                    <div className="calculated-field">
                      <span>首响超时自动结果</span>
                      <strong className={preview.firstResponse ? "text-danger" : "text-success"}>
                        {preview.firstResponse ? "超时" : "正常"}
                      </strong>
                    </div>
                    <DateField label="完成时间" name="resolvedAt" value={draft.resolvedAt} onChange={updateField} help="等于截止时间时按正常计算。" />
                    <DateField label="完成 SLA 截止" name="slaResolveDeadline" value={draft.slaResolveDeadline} onChange={updateField} />
                    <div className="calculated-field">
                      <span>处理超时自动结果</span>
                      <strong className={preview.resolve ? "text-danger" : "text-success"}>
                        {preview.resolve ? "超时" : "正常"}
                      </strong>
                    </div>
                    <DateField label="关闭时间" name="closedAt" value={draft.closedAt} onChange={updateField} />
                  </div>
                </section>

                <section className="form-section">
                  <div className="form-section-heading">
                    <h2>内容与结果</h2>
                    <p>更正内容不会生成普通工单备注或时间线记录。</p>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      <span>问题描述</span>
                      <textarea rows="5" value={draft.description} onChange={(event) => updateField("description", event.target.value)} required />
                    </label>
                    <label className="field">
                      <span>处理结果</span>
                      <textarea rows="5" value={draft.resultSummary} onChange={(event) => updateField("resultSummary", event.target.value)} />
                    </label>
                    <div className="form-grid form-grid-2">
                      <label className="field">
                        <span>满意度</span>
                        <select value={draft.satisfactionLevel} onChange={(event) => updateField("satisfactionLevel", event.target.value)}>
                          <option value="">未设置</option>
                          {SATISFACTION_LEVELS.map((level) => (
                            <option key={level} value={level}>{SATISFACTION_LABELS[level]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>满意度说明</span>
                        <input value={draft.satisfactionComment} onChange={(event) => updateField("satisfactionComment", event.target.value)} />
                      </label>
                    </div>
                  </div>
                </section>

                <section className="save-panel">
                  <label className="field">
                    <span>
                      更正原因
                      <b className="required-mark">必填</b>
                    </span>
                    <textarea
                      rows="3"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="说明数据错误原因和本次更正依据，至少 4 个字"
                      required
                    />
                  </label>
                  <div className="save-panel-actions">
                    <span>{changes.length ? `检测到 ${changes.length} 项变化` : "尚未修改数据"}</span>
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving || !changes.length || !health?.ready}
                    >
                      核对并保存
                    </button>
                  </div>
                </section>
              </form>
            ) : (
              <div className="editor-empty">
                <div className="empty-glyph" aria-hidden="true">IT</div>
                <h1>选择需要更正的工单</h1>
                <p>从左侧查询结果中选择一条工单，系统会载入当前数据库快照。</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {confirming && (
          <dialog
            className="confirm-dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            ref={dialogRef}
            tabIndex="-1"
            onCancel={(event) => {
              event.preventDefault();
              if (!saving) setConfirming(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const controls = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (!first) {
                event.preventDefault();
              } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="confirm-heading">
              <div>
                <p className="section-kicker">保存前核对</p>
                <h2 id="confirm-title">确认静默更正 {ticket.ticketNo}</h2>
              </div>
              <button className="button button-quiet" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                取消
              </button>
            </div>
            <div className="confirm-reason">
              <span>更正原因</span>
              <strong>{reason.trim()}</strong>
            </div>
            <div className="diff-table-wrap">
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>原值</th>
                    <th>新值</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.field}>
                      <th>{change.label}</th>
                      <td>{change.before}</td>
                      <td>{change.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="confirm-note">
              请确认以上变化与更正原因。保存后会留存独立记录，进行中工单的超时结果以保存时为准。
            </div>
            <div className="confirm-actions">
              <button className="button button-secondary" type="button" onClick={() => setConfirming(false)} disabled={saving}>
                返回修改
              </button>
              <button className="button button-primary" type="button" onClick={commitSave} disabled={saving}>
                {saving ? "正在保存" : "确认保存"}
              </button>
            </div>
          </dialog>
      )}
    </div>
  );
}
