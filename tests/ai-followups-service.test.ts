import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { buildContext, conversationExcerpt, parseArray } from "../src/server/ai/context";
import { loadService, matches } from "./helpers/service-harness";

// Execute the real service, context builder and follow-up parser with all model
// transport and database access replaced by deterministic in-memory fixtures.
const user = { id: "followups-user-db", dingtalkUserId: "followups-user", name: "测试用户", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };
const answer = "先检查打印机面板上的网络连接状态，再确认电脑是否连接同一网络。";
const suggestions = ["怎样查看打印机面板上的网络连接状态？", "怎样判断电脑和打印机是否连接同一网络？"];
const anchors = ["打印机面板上的网络连接状态", "确认电脑是否连接同一网络"];
const metadata = (values = suggestions, quoted = anchors) => ({
  stage: "steps",
  suggestions: values.map((text, index) => ({ kind: index === 0 ? "clarify" : "verify", anchor: quoted[index], text }))
});
const wrap = (body: string, value: unknown) => `${body}\n<itdesk_suggestions>${JSON.stringify(value)}</itdesk_suggestions>`;
const envelope = (body = answer, values = suggestions, quoted = anchors) => wrap(body, metadata(values, quoted));
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type ReplyPlan = { content: string; chunks?: string[]; fail?: Error; abort?: AbortController };

function harness(plans: ReplyPlan[] = [{ content: envelope() }]) {
  const now = new Date();
  const conversation: any = {
    id: "followups-conversation", userId: user.dingtalkUserId, categoryId: "printer", categoryName: "打印机", title: "打印机离线",
    status: "ACTIVE", createdAt: now, updatedAt: now, busyUntil: null, activeRequestId: null, messages: [], draft: null
  };
  const state = { calls: [] as any[], quota: 0, messageUpdates: [] as any[], drafts: 0 };
  const settings = {
    enabled: true, apiKey: "offline-fixture-only", baseUrl: "https://fixture.invalid", model: "offline-fixture", supportsVision: false,
    temperature: 0.2, maxOutputTokens: 2000, contextMessages: 12, dailyMessageLimit: 20, timeoutSeconds: 30, retentionDays: 30, systemPrompt: ""
  };
  const category = { categoryId: "printer", categoryName: "打印机", enabled: true, version: 1, prompt: "逐步排查打印问题。", environment: "", examples: [] };
  const snapshot = () => structuredClone(conversation);
  const db: any = {
    aiConversation: {
      findFirst: async ({ where }: any) => matches(conversation, where) ? snapshot() : null,
      findMany: async ({ where }: any) => matches(conversation, where) ? [snapshot()] : [],
      updateMany: async ({ where, data }: any) => {
        if (!matches(conversation, where)) return { count: 0 };
        Object.assign(conversation, data);
        if (!data.updatedAt) conversation.updatedAt = new Date(Math.max(Date.now(), conversation.updatedAt.getTime() + 1));
        return { count: 1 };
      }
    },
    ticketCategory: { findFirst: async () => ({ id: "printer", name: "打印机", enabled: true }) },
    aiMessage: {
      findUnique: async ({ where }: any) => structuredClone(conversation.messages.find((row: any) => matches(row, where)) || null),
      create: async ({ data }: any) => {
        if (data.requestKey && conversation.messages.some((row: any) => row.requestKey === data.requestKey)) throw Object.assign(new Error("Unique request key"), { code: "P2002" });
        const row = { id: `message-${conversation.messages.length + 1}`, status: "COMPLETE", attachments: null, references: null, suggestions: null, inputTokens: 0, outputTokens: 0, createdAt: new Date(now.getTime() + conversation.messages.length), ...data };
        conversation.messages.push(row);
        return structuredClone(row);
      },
      update: async ({ where, data }: any) => {
        const row = conversation.messages.find((item: any) => matches(item, where));
        assert.ok(row, "message update must target an existing row");
        state.messageUpdates.push(structuredClone(data));
        Object.assign(row, data);
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of conversation.messages) if (matches(row, where)) { Object.assign(row, data); count++; }
        return { count };
      }
    },
    aiDailyUsage: {
      upsert: async () => undefined,
      updateMany: async ({ where }: any) => state.quota < where.count.lt ? (++state.quota, { count: 1 }) : { count: 0 }
    },
    aiTicketDraft: {
      deleteMany: async () => { if (!conversation.draft?.ticketId) conversation.draft = null; return { count: 0 }; },
      findUnique: async () => structuredClone(conversation.draft),
      create: async ({ data }: any) => {
        state.drafts++;
        conversation.draft = { id: "followups-draft", version: 1, priority: "NORMAL", ticketId: null, ...data };
        return structuredClone(conversation.draft);
      }
    },
    $transaction: async (operation: (tx: unknown) => unknown) => operation(db)
  };
  const { AiService } = loadService("src/server/services/aiService.ts", {
    zod: { z },
    "@/src/server/ai/config": { getAiSettings: async () => settings, getPublicAiSettings: async () => settings, getCategoryConfig: async () => category },
    "@/src/server/ai/context": { buildContext, conversationExcerpt, parseArray },
    "@/src/server/ai/provider": {
      streamCompletion: async (requestSettings: unknown, messages: unknown, options: any = {}) => {
        const plan = plans[state.calls.length];
        state.calls.push({ settings: structuredClone(requestSettings), messages: structuredClone(messages) });
        assert.ok(plan, "unexpected extra model call");
        for (const chunk of plan.chunks || [plan.content]) options.onDelta?.(chunk);
        plan.abort?.abort();
        if (options.signal?.aborted) throw new Error("fixture request aborted");
        if (plan.fail) throw plan.fail;
        return { content: plan.content, model: "offline-fixture", usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } };
      }
    },
    "./ticketService": { TicketService: class { constructor() { throw new Error("Ticket transport is outside this fixture"); } } }
  });
  const service = new AiService(db);
  const prepare = (clientRequestId = "followups-request-1", content = "打印机显示离线，我该怎么检查？") => service.prepareMessage(conversation.id, { content, clientRequestId }, user);
  const respond = async (prepared: any, signal?: AbortSignal) => {
    const events: any[] = [];
    await service.respond(prepared, (event: any) => events.push(event), signal);
    return events;
  };
  const latest = () => conversation.messages.filter((row: any) => row.role === "assistant").at(-1);
  return { service, state, conversation, settings, category, prepare, respond, latest };
}

test("one model response streams only the answer and persists its two follow-ups in the final DTO", async () => {
  const full = envelope();
  const h = harness([{ content: full, chunks: [answer.slice(0, 7), answer.slice(7) + "\n<itdesk_sug", "gestions>", JSON.stringify(metadata()), "</itdesk_suggestions>"] }]);
  const events = await h.respond(await h.prepare());
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].settings.maxOutputTokens, h.settings.maxOutputTokens);
  assert.equal(h.state.quota, 1);
  assert.equal(events.some(event => event.type === "error"), false);
  assert.equal(events.filter(event => event.type === "delta").map(event => event.content).join("").trim(), answer);
  assert.equal(h.latest().content.trim(), answer);
  assert.equal(h.latest().status, "COMPLETE");
  assert.deepEqual(JSON.parse(h.latest().suggestions), suggestions);
  assert.deepEqual(plain(events.at(-1).conversation.messages.at(-1).suggestions), suggestions);
  assert.equal(h.conversation.activeRequestId, null);
  assert.equal(h.conversation.busyUntil, null);
});

test("a missing newline before metadata never leaks suggestions into visible or persisted answer text", async () => {
  const inline = envelope().replace("\n<itdesk_suggestions>", "<itdesk_suggestions>");
  const h = harness([{ content: inline, chunks: [answer + "<itdesk_sug", inline.slice((answer + "<itdesk_sug").length)] }, { content: envelope("") }]);
  const events = await h.respond(await h.prepare());
  assert.equal(h.latest().content.trim(), answer);
  assert.equal(events.filter(event => event.type === "delta").map(event => event.content).join("").trim(), answer);
  assert.equal(h.latest().status, "COMPLETE");
  assert.equal(h.state.calls.length, 1);
  const context = await buildContext({ settings: h.settings, category: h.category, user: user as any, messages: h.conversation.messages, histories: [] });
  for (const suggestion of suggestions) assert.equal(JSON.stringify(context).includes(suggestion), false);
});

test("a missing or invalid follow-up tail gets only one bounded repair call", async (t) => {
  for (const invalidAnswer of [answer, envelope(answer, [suggestions[0]])]) {
    await t.test(invalidAnswer === answer ? "missing tail" : "only one follow-up", async () => {
      const h = harness([{ content: invalidAnswer }, { content: envelope("") }]);
      await h.respond(await h.prepare());
      assert.equal(h.state.calls.length, 2);
      assert.equal(h.state.quota, 1, "repair belongs to the already charged answer");
      assert.ok(h.state.calls[1].settings.maxOutputTokens < h.settings.maxOutputTokens);
      assert.ok(h.state.calls[1].settings.timeoutSeconds <= 12);
      assert.equal(h.latest().content.trim(), answer);
      assert.deepEqual(JSON.parse(h.latest().suggestions), suggestions);
      assert.equal(h.latest().inputTokens, 60);
      assert.equal(h.latest().outputTokens, 40);
    });
  }
});

test("new ungrounded legacy output is repaired even though existing stored string pairs remain readable", async () => {
  const h = harness([{ content: wrap(answer, { suggestions }) }, { content: envelope("") }]);
  const events = await h.respond(await h.prepare());
  assert.equal(h.state.calls.length, 2);
  assert.equal(h.state.quota, 1);
  assert.deepEqual(JSON.parse(h.latest().suggestions), suggestions);
  assert.deepEqual(plain(events.at(-1).conversation.messages.at(-1).suggestions), suggestions);
  assert.equal(h.latest().content.trim(), answer);
});

test("repair must ground its pair in the original answer, not in an invented repair body", async (t) => {
  const invented = "请查看软件授权页面的到期日期，然后确认账号所属的部门名称。";
  const unrelated = ["怎样查看软件授权页面的到期日期？", "如何确认账号所属的部门名称？"];
  const inventedAnchors = ["软件授权页面的到期日期", "确认账号所属的部门名称"];
  for (const repairBody of ["", invented]) {
    await t.test(repairBody ? "fabricated repair body" : "missing anchor in answer", async () => {
      const h = harness([
        { content: envelope(answer, unrelated, inventedAnchors) },
        { content: envelope(repairBody, unrelated, inventedAnchors) }
      ]);
      const events = await h.respond(await h.prepare());
      assert.equal(h.state.calls.length, 2);
      assert.equal(h.latest().status, "COMPLETE");
      assert.equal(h.latest().content.trim(), answer);
      assert.deepEqual(parseArray(h.latest().suggestions), []);
      assert.equal(events.at(-1).type, "done");
      assert.equal(JSON.stringify(events).includes(invented), false);
      assert.equal(h.conversation.activeRequestId, null);
    });
  }
});

test("collection templates persist and reload without treating their placeholders as user facts", async () => {
  const collectionAnswer = "请告诉我电脑的操作系统、连接方式和报错原文。不清楚这些信息时，我可以教你查看网络状态页面。";
  const pair = ["我的电脑使用【操作系统】，通过【连接方式】连接，显示【报错原文】。", "我不清楚怎么查看网络状态页面，请教我。"];
  const collectionMetadata = {
    stage: "collect",
    suggestions: [
      { kind: "reply_template", anchor: "电脑的操作系统、连接方式和报错原文", text: pair[0] },
      { kind: "help", anchor: "我可以教你查看网络状态页面", text: pair[1] }
    ]
  };
  const h = harness([{ content: wrap(collectionAnswer, collectionMetadata) }, { content: envelope() }]);
  const firstEvents = await h.respond(await h.prepare());
  assert.equal(h.state.calls.length, 1);
  assert.deepEqual(JSON.parse(h.latest().suggestions), pair);
  assert.deepEqual(plain(firstEvents.at(-1).conversation.messages.at(-1).suggestions), pair);
  assert.deepEqual(plain((await h.service.detail(h.conversation.id, user)).messages.at(-1).suggestions), pair);
  assert.equal(h.latest().content.trim(), collectionAnswer);
  const userContent = "我使用 Windows，通过 Wi-Fi 连接，提示无法获取 IP 地址。";
  await h.respond(await h.prepare("followups-request-2", userContent));
  assert.equal(h.state.calls.length, 2);
  const context = JSON.stringify(h.state.calls[1].messages.filter((message: any) => message.role !== "system"));
  for (const suggestion of pair) assert.equal(context.includes(suggestion), false);
  assert.equal(context.includes(userContent), true);
  assert.equal(context.includes(JSON.stringify(collectionMetadata)), false);
});

test("result-based suggestions are grounded in the acknowledged feedback and remain display-only", async () => {
  const resultAnswer = "重启后打印队列仍卡住，下一步先查看打印队列中的错误状态。";
  const pair = ["打印队列仍卡住时，下一步应该检查哪些信息？", "如何判断打印队列中的错误状态是否已恢复？"];
  const resultMetadata = {
    stage: "results",
    suggestions: [
      { kind: "next_step", anchor: "打印队列仍卡住", text: pair[0] },
      { kind: "verify", anchor: "查看打印队列中的错误状态", text: pair[1] }
    ]
  };
  const h = harness([{ content: wrap(resultAnswer, resultMetadata) }]);
  const events = await h.respond(await h.prepare("followups-results-1", "重启后打印队列仍卡住，显示脱机。"));
  assert.equal(h.state.calls.length, 1);
  assert.deepEqual(JSON.parse(h.latest().suggestions), pair);
  assert.equal(h.latest().content.trim(), resultAnswer);
  assert.equal(h.conversation.messages.length, 2);
  assert.equal(h.state.drafts, 0);
  assert.equal(events.filter(event => event.type === "delta").map(event => event.content).join("").trim(), resultAnswer);
});

test("failed or malformed repair preserves the complete answer without fabricated suggestions or repeated repair", async (t) => {
  for (const { label, ...repair } of [
    { label: "provider error", content: "", fail: new Error("fixture upstream secret") },
    { label: "malformed output", content: "not valid JSON" },
    { label: "incomplete suggestion pair", content: envelope("", [suggestions[0]]) },
    { label: "legacy pair without grounding", content: wrap("", { suggestions }) }
  ]) {
    await t.test(label, async () => {
      const h = harness([{ content: answer }, repair]);
      const events = await h.respond(await h.prepare());
      assert.equal(h.state.calls.length, 2);
      assert.equal(h.latest().status, "COMPLETE");
      assert.equal(h.latest().content.trim(), answer);
      assert.equal(parseArray(h.latest().suggestions).length, 0);
      assert.equal(events.some(event => event.type === "error"), false);
      assert.equal(events.at(-1).type, "done");
      assert.equal(JSON.stringify(events).includes("fixture upstream secret"), false);
      assert.equal(h.conversation.activeRequestId, null);
    });
  }
});

test("upstream failure and cancellation never save suggestions, repair, or retain the answer lock", async (t) => {
  for (const cancelled of [false, true]) {
    await t.test(cancelled ? "cancelled stream" : "failed stream", async () => {
      const controller = new AbortController();
      const h = harness([{ content: envelope(), chunks: ["请先检查打印机", "\n<itdesk_suggestions>{\"suggestions\":["], ...(cancelled ? { abort: controller } : { fail: new Error("fixture upstream secret") }) }]);
      const events = await h.respond(await h.prepare(), controller.signal);
      assert.equal(h.state.calls.length, 1);
      assert.equal(h.latest().status, "FAILED");
      assert.equal(parseArray(h.latest().suggestions).length, 0);
      assert.equal(h.latest().content.includes("itdesk_suggestions"), false);
      assert.equal(events.some(event => event.type === "done"), false);
      assert.ok(events.some(event => event.type === "error"));
      assert.equal(h.conversation.activeRequestId, null);
      assert.equal(h.conversation.busyUntil, null);
    });
  }
});

test("cancelling during optional repair keeps readable text but never completes the answer or exposes suggestions", async () => {
  const controller = new AbortController();
  const h = harness([{ content: answer }, { content: envelope(""), abort: controller }]);
  const events = await h.respond(await h.prepare(), controller.signal);
  assert.equal(h.state.calls.length, 2);
  assert.equal(h.latest().status, "FAILED");
  assert.equal(h.latest().content.trim(), answer);
  assert.equal(parseArray(h.latest().suggestions).length, 0);
  assert.equal(events.some(event => event.type === "done"), false);
  assert.ok(events.some(event => event.type === "error"));
  assert.equal(h.conversation.activeRequestId, null);
});

test("history reload accepts legacy messages and never exposes suggestions for user or failed messages", async () => {
  const h = harness([]);
  const now = new Date();
  h.conversation.messages.push(
    { id: "legacy-missing", role: "assistant", content: "旧版回复", status: "COMPLETE", createdAt: now },
    { id: "legacy-null", role: "assistant", content: "另一条旧版回复", status: "COMPLETE", suggestions: null, createdAt: now },
    { id: "malformed", role: "assistant", content: "损坏字段兼容", status: "COMPLETE", suggestions: "not json", createdAt: now },
    { id: "valid", role: "assistant", content: answer, status: "COMPLETE", suggestions: JSON.stringify(suggestions), createdAt: now },
    { id: "failed", role: "assistant", content: "回答中断", status: "FAILED", suggestions: JSON.stringify(suggestions), createdAt: now },
    { id: "user", role: "user", content: "打印机离线", status: "COMPLETE", suggestions: JSON.stringify(suggestions), createdAt: now }
  );
  const detail = await h.service.detail(h.conversation.id, user);
  assert.deepEqual(plain(detail.messages.find((row: any) => row.id === "valid").suggestions), suggestions);
  for (const id of ["legacy-missing", "legacy-null", "malformed", "failed", "user"]) assert.equal(detail.messages.find((row: any) => row.id === id).suggestions?.length || 0, 0);
  assert.equal(h.state.calls.length, 0);
});

test("retrying the same request before or after completion keeps its original follow-ups and single quota charge", async () => {
  const h = harness();
  const first = await h.prepare();
  const pendingDuplicate = await h.prepare();
  assert.equal(pendingDuplicate.reused, true);
  await h.respond(pendingDuplicate);
  assert.equal(h.state.calls.length, 0);
  await h.respond(first);
  const completedDuplicate = await h.prepare();
  assert.equal(completedDuplicate.reused, true);
  const events = await h.respond(completedDuplicate);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.quota, 1);
  assert.equal(h.conversation.messages.length, 2);
  assert.deepEqual(plain(events[0].conversation.messages.at(-1).suggestions), suggestions);
  assert.deepEqual(plain((await h.service.detail(h.conversation.id, user)).messages.at(-1).suggestions), suggestions);
});

test("unselected follow-ups stay out of model context, excerpts, and the fallback ticket description", async () => {
  const offered = ["怎么找到打印机面板上显示的网络连接状态？", "怎么比较电脑和打印机是否连接同一网络？"];
  const h = harness([{ content: envelope(answer, offered) }, { content: envelope() }]);
  await h.respond(await h.prepare());
  const history = structuredClone(h.conversation);
  const context = await buildContext({ settings: h.settings, category: h.category, user: user as any, messages: h.conversation.messages, histories: [history] });
  const excerpt = conversationExcerpt(h.conversation.messages);
  const draft = await h.service.createDraft(h.conversation.id, user, { useModel: false });
  await h.respond(await h.prepare("followups-request-2", "我现在看到状态显示离线。"));
  for (const suggestion of offered) {
    assert.equal(JSON.stringify(context).includes(suggestion), false);
    assert.equal(excerpt.includes(suggestion), false);
    assert.equal(draft.description.includes(suggestion), false);
    assert.equal(JSON.stringify(h.state.calls[1].messages).includes(suggestion), false);
  }
  assert.match(draft.description, /建议不代表用户已执行/);
  assert.equal(h.state.calls.length, 2);
});
