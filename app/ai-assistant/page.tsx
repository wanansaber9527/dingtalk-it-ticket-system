"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Alert, App, Button, Drawer, Empty, Image, Input, Modal, Popconfirm, Select, Skeleton, Space, Switch, Tag, Tooltip, Upload } from "antd";
import { CheckCircleOutlined, DeleteOutlined, FileAddOutlined, HistoryOutlined, MessageOutlined, PaperClipOutlined, PictureOutlined, PlusOutlined, RobotOutlined, SendOutlined, StopOutlined, UserOutlined } from "@ant-design/icons";
import { EmployeeShell } from "@/components/tickets/EmployeeShell";
import { TicketDraft } from "@/components/ai/TicketDraft";
import { MessageContent } from "@/components/ai/MessageContent";
import { FollowupSuggestions, appendFollowupSuggestion } from "@/components/ai/FollowupSuggestions";
import { readAiStream } from "@/components/ai/stream";
import { aiRequestSignature, pendingAiRequest, type PendingAiRequest } from "@/components/ai/requestIdentity";
import { apiDelete, apiGet, apiPost } from "@/src/lib/clientApi";
import { AI_ASSISTANT_NAME, type AiAttachment, type AiBootstrap, type AiConversationDto, type AiDraftDto } from "@/src/lib/ai";
import "./ai-assistant.css";

const failure = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
const dateLabel = (date: string) => new Date(date).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

export default function AiAssistantPage() {
  const { message } = App.useApp();
  const [bootstrap, setBootstrap] = useState<AiBootstrap | null>(null);
  const [initialError, setInitialError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [conversations, setConversations] = useState<AiConversationDto[]>([]);
  const [conversation, setConversation] = useState<AiConversationDto | null>(null);
  const [query, setQuery] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [submittingDraft, setSubmittingDraft] = useState(false);
  const [recoveryState, setRecoveryState] = useState<"idle" | "polling" | "unavailable">("idle");
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceDetail, setReferenceDetail] = useState<AiConversationDto | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [references, setReferences] = useState<Pick<AiConversationDto, "id" | "title" | "createdAt">[]>([]);
  const operation = useRef(false);
  const draftAction = useRef<{ submit: () => Promise<boolean> }>(null);
  const pendingRequest = useRef<PendingAiRequest | null>(null);
  const viewVersion = useRef(0);
  const listVersion = useRef(0);
  const referenceVersion = useRef(0);
  const streamController = useRef<AbortController | null>(null);
  const uploadControllers = useRef(new Set<AbortController>());
  const filesRef = useRef<AiAttachment[]>([]);
  const uploadCount = useRef(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const messagesScroll = useRef<HTMLDivElement>(null);
  const composerInput = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const followScroll = useRef(true);
  const mounted = useRef(true);

  const refreshList = useCallback(async (keyword = "") => {
    const version = ++listVersion.current;
    setListLoading(true);
    try {
      const items = await apiGet<AiConversationDto[]>(`/api/ai/conversations?q=${encodeURIComponent(keyword)}`);
      if (mounted.current && version === listVersion.current) setConversations(items);
    } catch (cause) {
      if (mounted.current && version === listVersion.current) message.error(failure(cause));
    } finally {
      if (mounted.current && version === listVersion.current) setListLoading(false);
    }
  }, [message]);

  const loadConversation = useCallback(async (id: string) => {
    if (operation.current || uploadCount.current) return;
    const version = ++viewVersion.current;
    setConversationLoading(true);
    setError("");
    setHistoryOpen(false);
    try {
      const next = await apiGet<AiConversationDto>(`/api/ai/conversations/${id}`);
      if (!mounted.current || version !== viewVersion.current) return;
      setConversation(next);
      setCategoryId(next.categoryId);
      setContent("");
      setAttachments([]);
      filesRef.current = [];
      setReferences([...(next.messages || [])].reverse().find((item) => item.role === "user")?.references || []);
      followScroll.current = true;
      window.history.replaceState(null, "", `/ai-assistant?conversationId=${encodeURIComponent(id)}`);
    } catch (cause) {
      if (mounted.current && version === viewVersion.current) setError(failure(cause));
    } finally {
      if (mounted.current && version === viewVersion.current) setConversationLoading(false);
    }
  }, []);

  const initialize = useCallback(async () => {
    setInitialLoading(true);
    setInitialError("");
    try {
      const data = await apiGet<AiBootstrap>("/api/ai/bootstrap");
      if (!mounted.current) return;
      setBootstrap(data);
      const params = new URLSearchParams(window.location.search);
      const initialCategory = params.get("categoryId");
      if (initialCategory && data.categories.some((c) => c.id === initialCategory)) setCategoryId(initialCategory);
      const question = params.get("question");
      if (question) setContent(question.slice(0, 12000));
      const id = params.get("conversationId");
      if (id) void loadConversation(id);
    } catch (cause) {
      if (mounted.current) setInitialError(failure(cause));
    } finally {
      if (mounted.current) setInitialLoading(false);
    }
  }, [loadConversation]);

  useEffect(() => {
    mounted.current = true;
    void initialize();
    const uploads = uploadControllers.current;
    return () => {
      mounted.current = false;
      viewVersion.current += 1;
      listVersion.current += 1;
      referenceVersion.current += 1;
      streamController.current?.abort();
      uploads.forEach((controller) => controller.abort());
    };
  }, [initialize]);

  useEffect(() => {
    const timer = setTimeout(() => void refreshList(query), 250);
    return () => clearTimeout(timer);
  }, [query, refreshList]);

  useEffect(() => {
    if (followScroll.current) messagesEnd.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [conversation?.messages, conversation?.draft, sending]);

  const categories = bootstrap?.categories || [];
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const busy = sending || drafting || conversationLoading || submittingDraft;
  const ready = Boolean(bootstrap?.enabled && (bootstrap.configured || (demo && bootstrap.localDemoAvailable)));
  const visibleMessages = conversation?.messages?.filter((item) => item.role === "user" || item.role === "assistant") || [];
  const hasMessages = visibleMessages.length > 0;
  const hasPendingReply = visibleMessages.some((item) => item.status === "PENDING");
  const suggestionsDisabled = busy || hasPendingReply || uploading > 0;
  const directTicketParams = new URLSearchParams();
  if (categoryId) directTicketParams.set("categoryId", categoryId);
  const latestQuestion = [...visibleMessages].reverse().find((item) => item.role === "user")?.content;
  if (content.trim() || latestQuestion) directTicketParams.set("description", (content.trim() || latestQuestion || "").slice(0, 12000));
  const directTicketHref = `/tickets/new${directTicketParams.size ? `?${directTicketParams}` : ""}`;
  const referenceImages = useMemo(() => {
    const unique = new Map<string, AiAttachment>();
    referenceDetail?.messages?.forEach((item) => item.attachments.forEach((file) => unique.set(file.url, file)));
    return [...unique.values()];
  }, [referenceDetail]);

  useEffect(() => {
    const id = conversation?.id;
    if (!id || !hasPendingReply || sending) { setRecoveryState("idle"); return; }
    let active = true;
    let attempts = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    setRecoveryState("polling");
    async function poll() {
      try {
        const latest = await apiGet<AiConversationDto>(`/api/ai/conversations/${id}`);
        if (!active) return;
        failures = 0;
        setConversation((current) => current?.id === id ? latest : current);
        if (!latest.messages?.some((item) => item.status === "PENDING")) { setRecoveryState("idle"); return; }
      } catch { failures++; }
      if (!active) return;
      attempts++;
      if (attempts >= 120 || failures >= 3) { setRecoveryState("unavailable"); return; }
      timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [conversation?.id, hasPendingReply, sending, recoveryEpoch]);

  function clearPendingRequest() {
    pendingRequest.current = null;
    try { sessionStorage.removeItem("itdesk.ai.pending-request"); } catch { /* Private browsing may disable storage. */ }
  }

  function chooseSuggestion(suggestion: string) {
    if (suggestionsDisabled || operation.current || uploadCount.current) return;
    const next = appendFollowupSuggestion(content, suggestion);
    if (next === null) {
      message.info("输入内容接近 12000 字上限，请先精简后再添加建议。原内容已保留。");
      composerInput.current?.focus({ cursor: "end" });
      return;
    }
    setContent(next);
    requestAnimationFrame(() => composerInput.current?.focus({ cursor: "end" }));
  }

  function setFiles(next: AiAttachment[]) { filesRef.current = next; setAttachments(next); }
  function newConversation() {
    if (operation.current || uploadCount.current) return;
    viewVersion.current += 1;
    setConversation(null);
    setCategoryId("");
    setContent("");
    setFiles([]);
    setReferences([]);
    setError("");
    setHistoryOpen(false);
    setConversationLoading(false);
    window.history.replaceState(null, "", "/ai-assistant");
  }

  async function changeCategory(id: string) {
    if (busy || uploading) return;
    if (!conversation) { setCategoryId(id); return; }
    operation.current = true;
    setConversationLoading(true);
    try {
      const response = await fetch(`/api/ai/conversations/${conversation.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId: id }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "分类调整失败");
      setConversation(body.data);
      setCategoryId(id);
      void refreshList(query);
    } catch (cause) { message.error(failure(cause)); }
    finally { operation.current = false; setConversationLoading(false); }
  }

  async function upload(file: File) {
    if (operation.current) return;
    if (filesRef.current.length + uploadCount.current >= 6) { message.warning("一次最多添加 6 张图片"); return; }
    if (!file.size || file.size > 10 * 1024 * 1024) { message.error("请选择不超过 10MB 的图片"); return; }
    if (!/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name) && !/^image\/(jpeg|png|gif|webp|bmp|heic|heif)$/.test(file.type)) { message.error("请选择有效的图片文件"); return; }
    const controller = new AbortController();
    uploadControllers.current.add(controller);
    uploadCount.current++;
    setUploading(uploadCount.current);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: form, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "图片上传失败");
      if (mounted.current) setFiles([...filesRef.current, result.data]);
    } catch (cause) {
      if (!controller.signal.aborted) message.error(failure(cause));
    } finally {
      uploadControllers.current.delete(controller);
      uploadCount.current--;
      if (mounted.current) setUploading(uploadCount.current);
    }
  }

  async function send() {
    if (operation.current || uploadCount.current) return;
    if (conversation?.draft && !conversation.draft.ticketId && /^(确认提交|按这个提交|提交吧)[。！!\s]*$/.test(content.trim()) && draftAction.current) {
      if (await draftAction.current.submit()) setContent("");
      return;
    }
    if (!ready) return;
    if (hasPendingReply && recoveryState !== "unavailable") { message.info("正在恢复上次回答，请稍后再发送"); return; }
    if (!categoryId) { message.warning("先选择问题分类，助手才能按对应流程排查"); return; }
    if (!selectedCategory?.aiEnabled) { message.warning("该分类暂未启用 AI 问答，可以直接提交工单"); return; }
    const text = content.trim();
    const sentFiles = [...filesRef.current];
    if (!text && !sentFiles.length) return;
    operation.current = true;
    setSending(true);
    setError("");
    followScroll.current = true;
    const controller = new AbortController();
    streamController.current = controller;
    let current = conversation;
    let accepted = false;
    let assistantId = "";
    try {
      if (!current) {
        current = await apiPost<AiConversationDto>("/api/ai/conversations", { categoryId, title: (text || "图片问题排查").slice(0, 80) });
        setConversation(current);
        window.history.replaceState(null, "", `/ai-assistant?conversationId=${encodeURIComponent(current.id)}`);
      }
      const payload = { content: text || "请帮我分析图片中的问题。", attachments: sentFiles, referenceConversationIds: references.map((item) => item.id), demo };
      const signature = await aiRequestSignature({ ...payload, conversationId: current.id, categoryId });
      let previous: unknown = pendingRequest.current;
      if (!previous) { try { previous = JSON.parse(sessionStorage.getItem("itdesk.ai.pending-request") || "null"); } catch { previous = null; } }
      const request = pendingAiRequest(signature, previous);
      pendingRequest.current = request;
      try { sessionStorage.setItem("itdesk.ai.pending-request", JSON.stringify(request)); } catch { /* The in-memory identity still protects retries in this view. */ }
      const response = await fetch(`/api/ai/conversations/${current.id}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ ...payload, clientRequestId: request.requestId })
      });
      await readAiStream(response, (event) => {
        if (!mounted.current) return;
        if (event.type === "start") {
          accepted = true;
          assistantId = event.assistantMessageId;
          setContent(""); setFiles([]);
          setConversation((previous) => previous ? { ...previous, messages: [...(previous.messages || []).filter((item) => item.id !== event.userMessage.id && item.id !== assistantId), event.userMessage, { id: assistantId, role: "assistant", content: "", attachments: [], status: "PENDING", createdAt: new Date().toISOString() }] } : previous);
        } else if (event.type === "delta") {
          setConversation((previous) => previous ? { ...previous, messages: previous.messages?.map((item) => item.id === assistantId ? { ...item, content: item.content + event.content } : item) } : previous);
        } else if (event.type === "done") {
          setContent(""); setFiles([]); setConversation(event.conversation);
          if (!event.conversation.messages?.some((item) => item.status === "PENDING")) clearPendingRequest();
        } else if (event.type === "error") clearPendingRequest();
      });
      void refreshList(query);
    } catch (cause) {
      if (!mounted.current) return;
      setError(controller.signal.aborted ? "已停止生成，已发送的问题仍保留在当前对话。" : failure(cause));
      if (!accepted) { setContent(text); setFiles(sentFiles); }
      if (current) {
        const latest = await apiGet<AiConversationDto>(`/api/ai/conversations/${current.id}`).catch(() => null);
        if (latest && mounted.current) setConversation(latest);
      }
      void refreshList(query);
    } finally {
      operation.current = false;
      streamController.current = null;
      if (mounted.current) setSending(false);
    }
  }

  async function prepareDraft() {
    if (operation.current || !conversation || !hasMessages) return;
    operation.current = true; setDrafting(true); setError("");
    try {
      const draft = await apiPost<AiDraftDto>(`/api/ai/conversations/${conversation.id}/draft`, { demo });
      followScroll.current = true;
      setConversation((current) => current ? { ...current, draft } : current);
    } catch (cause) { setError(failure(cause)); }
    finally { operation.current = false; setDrafting(false); }
  }

  async function markSolved() {
    if (!conversation || operation.current) return;
    operation.current = true;
    try {
      const response = await fetch(`/api/ai/conversations/${conversation.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: conversation.status === "SOLVED" ? "ACTIVE" : "SOLVED" }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "反馈保存失败");
      setConversation(body.data); void refreshList(query);
      message.success(body.data.status === "SOLVED" ? "已记录解决反馈" : "可以继续排查这个问题");
    } catch (cause) { message.error(failure(cause)); }
    finally { operation.current = false; }
  }

  async function removeConversation(id: string) {
    if (operation.current) return;
    try {
      await apiDelete(`/api/ai/conversations/${id}`);
      if (conversation?.id === id) newConversation();
      void refreshList(query);
      message.success("对话已删除");
    } catch (cause) { message.error(failure(cause)); }
  }

  async function inspectReference(id: string) {
    const version = ++referenceVersion.current;
    setReferenceLoading(true); setReferenceDetail(null);
    try {
      const result = await apiGet<AiConversationDto>(`/api/ai/conversations/${id}`);
      if (version === referenceVersion.current && mounted.current) setReferenceDetail(result);
    } catch (cause) { message.error(failure(cause)); }
    finally { if (version === referenceVersion.current && mounted.current) setReferenceLoading(false); }
  }

  const history = <div className="ai-history-inner">
    <div className="ai-sidebar-title"><span>我的对话</span><span>{conversations.length}</span></div>
    <Button className="action-teal" block icon={<PlusOutlined />} onClick={newConversation} disabled={busy || uploading > 0}>新建对话</Button>
    <Input.Search aria-label="搜索历史问题" placeholder="搜索历史问题" allowClear value={query} onChange={(event) => setQuery(event.target.value)} loading={listLoading} />
    <div className="ai-history-list">{!conversations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有找到相关对话" : "你的排查记录会保存在这里"} /> : conversations.map((item) => <div className={`ai-history-item${item.id === conversation?.id ? " is-active" : ""}`} key={item.id}>
      <button type="button" disabled={busy || uploading > 0} onClick={() => void loadConversation(item.id)} aria-current={item.id === conversation?.id ? "true" : undefined}><span className="ai-history-item-title">{item.id === conversation?.id ? <CheckCircleOutlined /> : <MessageOutlined />}{item.title}</span><span className="ai-history-meta">{item.categoryName}<span>{dateLabel(item.updatedAt)}{item.status === "SOLVED" ? " · 已解决" : ""}</span></span></button>
      <Popconfirm title="删除这条对话？" description="删除后无法继续引用该对话，已创建的工单会保留。" onConfirm={() => removeConversation(item.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}><Button type="text" size="small" danger disabled={busy} aria-label={`删除对话：${item.title}`} icon={<DeleteOutlined />} /></Popconfirm>
    </div>)}</div>
    <div className="ai-history-footer"><HistoryOutlined /><span>历史记录仅对你本人和有权处理关联工单的人员可见</span></div>
  </div>;

  return <EmployeeShell title="AI 助手" hideHeading>
    <div className="ai-workspace">
      <aside className="ai-history-sidebar">{history}</aside>
      <section className="ai-chat-panel" aria-label={AI_ASSISTANT_NAME}>
        <header className="ai-chat-toolbar">
          <div className="ai-chat-identity"><Button className="ai-mobile-history" type="text" aria-label="打开历史对话" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} /><span className="ai-avatar"><RobotOutlined /></span><div><h1>{AI_ASSISTANT_NAME}</h1><p>{conversation ? conversation.title : "一起排查，让问题有个着落"}</p></div></div>
          <Link href={directTicketHref} className="ai-direct-ticket"><FileAddOutlined /><span>直接提交工单</span></Link>
        </header>
        <div className="ai-category-bar"><label htmlFor="ai-category">问题分类</label><Select id="ai-category" aria-label="问题分类" placeholder="选择问题所属分类" value={categoryId || undefined} disabled={busy || uploading > 0} onChange={(id) => void changeCategory(id)} options={categories.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))} />{conversation?.status === "SOLVED" && <Tag color="success">已解决</Tag>}{demo && <Tag color="orange">本地模拟</Tag>}</div>
        {initialError && <div className="ai-panel-alert"><Alert type="error" showIcon message={initialError} action={<Button onClick={() => void initialize()} size="small">重试</Button>} /></div>}
        {!initialLoading && bootstrap && !ready && <div className="ai-panel-alert"><Alert type="info" showIcon message={!bootstrap.enabled ? "AI 问答暂未启用" : "AI 助手尚未连接大模型"} description="你可以直接提交工单，或由管理员在“大模型配置”中完成连接。" /></div>}
        {selectedCategory && !selectedCategory.aiEnabled && <div className="ai-panel-alert"><Alert showIcon type="info" message="该分类暂未启用 AI 问答，可直接提交工单。" /></div>}
        {hasPendingReply && !sending && <div className="ai-panel-alert"><Alert showIcon type={recoveryState === "unavailable" ? "warning" : "info"} message={recoveryState === "unavailable" ? "上次回答状态暂未确认，可刷新检查或直接提交工单。" : "正在恢复上次回答，已发送的问题不会重复提交。"} action={<Button size="small" onClick={() => setRecoveryEpoch((value) => value + 1)}>刷新状态</Button>} /></div>}
        <div className="ai-messages" ref={messagesScroll} role="log" aria-label="问题排查对话" aria-busy={sending} onScroll={() => { const el = messagesScroll.current; if (el) followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
          {initialLoading || conversationLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : !hasMessages ? <div className="ai-welcome"><span className="ai-welcome-icon"><RobotOutlined /></span><h2>遇到什么 IT 问题？</h2><p>先选分类，说说遇到的情况，也可以发截图。<br />我会一步步帮你排查，需要时为你整理工单。</p><div className="ai-starter-list">{(selectedCategory?.examples?.length ? selectedCategory.examples : ["电脑运行很慢，应该先检查什么？", "打印任务一直排队，无法打印", "网络已连接，但打不开业务系统"]).slice(0, 3).map((example) => <button type="button" key={example} onClick={() => setContent(example)} disabled={busy}><MessageOutlined /><span>{example}</span><span aria-hidden="true">↗</span></button>)}</div></div> : <>
            {visibleMessages.map((item) => <article key={item.id} className={`ai-message ai-message-${item.role === "user" ? "user" : "assistant"}`}>
              <span className="ai-message-avatar" aria-hidden="true">{item.role === "user" ? <UserOutlined /> : <RobotOutlined />}</span>
              <div className="ai-message-body">
                <div className="ai-message-name"><span>{item.role === "user" ? "我" : AI_ASSISTANT_NAME}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
                <div className="ai-message-bubble">
                  {item.role === "assistant" && item.content ? <MessageContent content={item.content} /> : <div className="ai-message-text">{item.content || (item.status === "PENDING" ? sending ? "正在分析…" : "上次回答尚未完成，正在检查保存状态。" : item.status === "FAILED" ? "本次回答未完成，可继续补充问题或提交工单。" : "")}</div>}
                  {item.attachments.length > 0 && <Image.PreviewGroup><div className="ai-message-images">{item.attachments.map((file) => <Image src={file.url} key={file.url} alt={file.name} width={136} height={100} style={{ objectFit: "cover" }} />)}</div></Image.PreviewGroup>}
                  {item.references && item.references.length > 0 && <div className="ai-sources">引用历史：{item.references.map((source) => <Button type="link" size="small" key={source.id} disabled={busy} onClick={() => { setReferenceOpen(true); void inspectReference(source.id); }}>{source.title} · {dateLabel(source.createdAt)}</Button>)}</div>}
                  {item.status === "FAILED" && <Tag className="ai-message-status" color="orange">未完成</Tag>}
                </div>
                <FollowupSuggestions role={item.role} status={item.status} suggestions={item.suggestions} disabled={suggestionsDisabled} onSelect={chooseSuggestion} />
              </div>
            </article>)}
            {conversation?.draft && <TicketDraft key={conversation.draft.id} draft={conversation.draft} conversationId={conversation.id} categories={categories} disabled={sending || drafting || conversationLoading} confirmRef={draftAction} onBusyChange={(value) => { operation.current = value; setSubmittingDraft(value); }} onChange={(draft) => { setConversation((current) => current?.id === conversation.id ? { ...current, draft } : current); void refreshList(query); }} />}
          </>}
          <div ref={messagesEnd} />
        </div>
        <div className="ai-composer-area">
          {error && <Alert type="warning" showIcon closable onClose={() => setError("")} message={error} style={{ marginBottom: 10 }} />}
          {hasMessages && <div className="ai-followup-actions"><Button className={conversation?.status === "SOLVED" ? "action-teal" : "action-success"} size="small" icon={conversation?.status === "SOLVED" ? <MessageOutlined /> : <CheckCircleOutlined />} disabled={busy} onClick={() => void markSolved()}>{conversation?.status === "SOLVED" ? "继续排查" : "问题已解决"}</Button><Button className="action-warning" size="small" icon={<FileAddOutlined />} disabled={busy || Boolean(conversation?.draft?.ticketId)} loading={drafting} onClick={() => void prepareDraft()}>{conversation?.draft?.ticketId ? "已提交工单" : conversation?.draft ? "更新报修草稿" : "未解决，转人工处理"}</Button></div>}
          {references.length > 0 && <div className="ai-reference-tags">参考历史：{references.map((item) => <Tag key={item.id} closable={!busy} onClose={() => setReferences((items) => items.filter((entry) => entry.id !== item.id))}>{item.title}</Tag>)}</div>}
          {attachments.length > 0 && <div className="ai-selected-images">{attachments.map((file) => <div key={file.url}><Image src={file.url} alt={file.name} width={62} height={50} style={{ objectFit: "cover" }} /><Tooltip title="移除图片"><Button size="small" type="text" danger aria-label={`移除 ${file.name}`} disabled={busy} icon={<DeleteOutlined />} onClick={() => setFiles(filesRef.current.filter((entry) => entry.url !== file.url))} /></Tooltip></div>)}</div>}
          <div className="ai-composer"><Input.TextArea ref={composerInput} aria-label="描述问题" placeholder={categoryId ? "描述故障、报错或继续补充排查结果…" : "先选择分类，再描述你遇到的问题…"} value={content} maxLength={12000} disabled={busy} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); files.forEach((file) => void upload(file)); } }} />
            <div className="ai-composer-tools"><Space size={4} wrap><Upload accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.heic,.heif" multiple showUploadList={false} disabled={busy} beforeUpload={(file) => { void upload(file); return false; }}><Button className="action-teal" type="text" icon={<PaperClipOutlined />} loading={uploading > 0} disabled={busy}>{uploading ? "上传中" : "添加图片"}</Button></Upload><Button className="action-violet" type="text" icon={<HistoryOutlined />} disabled={busy || uploading > 0} onClick={() => { setReferenceOpen(true); setReferenceDetail(null); }}>引用历史</Button></Space>{sending ? <Button className="action-warning" icon={<StopOutlined />} onClick={() => streamController.current?.abort()}>停止</Button> : <Button type="primary" icon={<SendOutlined />} disabled={busy || uploading > 0 || !ready || !categoryId || !selectedCategory?.aiEnabled || (!content.trim() && !attachments.length)} onClick={() => void send()}>发送</Button>}</div>
          </div>
          <div className="ai-composer-footer"><span>{demo ? "本地模拟仅用于流程体验，不代表真实模型回答或图片识别。" : "AI 回答供排查参考，无法解决可随时提交工单。"}</span>{bootstrap?.localDemoAvailable && <label className="ai-demo-toggle"><Switch size="small" checked={demo} disabled={busy} onChange={setDemo} />本地模拟</label>}</div>
          {attachments.length > 0 && bootstrap && !bootstrap.supportsVision && !demo && <div className="ai-note">当前模型未启用图片理解；可更换支持图片的模型，或将图片附在工单中。</div>}
        </div>
      </section>
    </div>
    <Drawer title="历史对话" placement="left" width={300} open={historyOpen} onClose={() => setHistoryOpen(false)}>{history}</Drawer>
    <Modal title="引用之前的问题或图片" open={referenceOpen} onCancel={() => { setReferenceOpen(false); referenceVersion.current++; }} footer={null} width={760}>
      <div className="ai-reference-picker"><div className="ai-reference-list"><Input.Search aria-label="搜索可引用的历史" placeholder="搜索历史问题" value={query} allowClear onChange={(event) => setQuery(event.target.value)} />{conversations.map((item) => <button key={item.id} className={referenceDetail?.id === item.id ? "is-active" : ""} onClick={() => void inspectReference(item.id)} type="button" aria-current={referenceDetail?.id === item.id ? "true" : undefined}><strong>{item.title}</strong><span>{referenceDetail?.id === item.id && "当前预览 · "}{item.categoryName} · {dateLabel(item.createdAt)}</span></button>)}</div><div className="ai-reference-detail">{referenceLoading ? <Skeleton active /> : referenceDetail ? <><h3>{referenceDetail.title}</h3><p className="ai-note">{referenceDetail.categoryName} · {new Date(referenceDetail.createdAt).toLocaleString("zh-CN")}</p><p className="ai-reference-excerpt">{referenceDetail.messages?.find((item) => item.role === "user")?.content}</p><Button className="action-violet" icon={<HistoryOutlined />} disabled={busy || referenceDetail.id === conversation?.id || references.some((item) => item.id === referenceDetail.id) || references.length >= 3} onClick={() => { setReferences((items) => [...items, referenceDetail]); setReferenceOpen(false); }}>引用此对话</Button><h4><PictureOutlined /> 历史图片</h4>{referenceImages.length ? <div className="ai-reference-images">{referenceImages.map((file) => <div key={file.url}><Image src={file.url} alt={file.name} width={120} height={90} style={{ objectFit: "cover" }} /><Button className="action-teal" size="small" disabled={busy || attachments.some((entry) => entry.url === file.url) || attachments.length >= 6} onClick={() => { setFiles([...filesRef.current, file]); message.success("图片已添加到当前输入区"); }}>选用图片</Button></div>)}</div> : <p className="ai-note">这条对话没有图片</p>}</> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一条历史对话，查看内容和图片" />}</div></div>
    </Modal>
  </EmployeeShell>;
}
