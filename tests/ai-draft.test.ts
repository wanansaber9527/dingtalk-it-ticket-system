import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { loadService } from "./helpers/service-harness";

const user = { id: "user-db", dingtalkUserId: "employee", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };
const modelReply = { content: JSON.stringify({ title: "打印机离线", description: "用户报告打印机离线，已检查连接仍未解决；需要人工进一步检查。" }), model: "fixture", usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 } };

function harness(complete: () => Promise<unknown> = async () => modelReply) {
  const now = new Date();
  const conversation: any = { id: "conv", userId: "employee", categoryId: "printer", categoryName: "打印机", title: "打印机离线", status: "ACTIVE", updatedAt: now, createdAt: now, busyUntil: null, activeRequestId: null,
    messages: [{ id: "user-message", role: "user", content: "打印机显示离线，已经检查了连接，还是不行", attachments: "[]", status: "COMPLETE", model: null, createdAt: now }], draft: null };
  const state = { calls: 0, quota: 0, drafts: 0, records: [] as any[] };
  const db: any = {
    aiConversation: {
      updateMany: async ({ where, data }: any) => {
        if (where.activeRequestId && conversation.activeRequestId !== where.activeRequestId) return { count: 0 };
        if (where.updatedAt && where.updatedAt.getTime() !== conversation.updatedAt.getTime()) return { count: 0 };
        if (where.OR && conversation.busyUntil && conversation.busyUntil > new Date()) return { count: 0 };
        Object.assign(conversation, data);
        if (!data.updatedAt) conversation.updatedAt = new Date(Math.max(Date.now(), conversation.updatedAt.getTime() + 1));
        return { count: 1 };
      },
      findFirst: async ({ where }: any) => !where.activeRequestId || where.activeRequestId === conversation.activeRequestId ? conversation : null,
    },
    aiDailyUsage: {
      upsert: async () => undefined,
      updateMany: async ({ where }: any) => state.quota < where.count.lt ? (++state.quota, { count: 1 }) : { count: 0 }
    },
    aiTicketDraft: {
      findUnique: async () => conversation.draft,
      create: async ({ data }: any) => {
        if (conversation.draft) throw Object.assign(new Error("unique"), { code: "P2002" });
        state.drafts++;
        conversation.draft = { id: "draft", priority: "NORMAL", version: 1, ticketId: null, ...data };
        return conversation.draft;
      }
    },
    aiMessage: { create: async ({ data }: any) => { state.records.push(data); return data; } },
    $transaction: async (operation: (tx: unknown) => unknown) => operation(db)
  };
  const settings = { enabled: true, apiKey: "offline-fixture", model: "fixture", timeoutSeconds: 60, dailyMessageLimit: 100 };
  const { AiService } = loadService("src/server/services/aiService.ts", {
    zod: { z },
    "@/src/server/ai/config": { getAiSettings: async () => settings },
    "@/src/server/ai/context": { parseArray: (value: string) => JSON.parse(value || "[]"), conversationExcerpt: (messages: any[]) => messages.map(message => message.content).join("\n") },
    "@/src/server/ai/provider": { streamCompletion: async () => { state.calls++; return complete(); } },
    "./ticketService": { TicketService: class {} }
  });
  const service = new AiService(db);
  service.own = async () => structuredClone(conversation);
  return { service, conversation, state, settings };
}

test("manual AI draft generation holds a conversation lock, charges once, and records model usage", async () => {
  let release!: (value: unknown) => void;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const first = h.service.createDraft("conv", user);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(h.service.createDraft("conv", user), (error: any) => error.code === "AI_BUSY");
  release(modelReply);
  const draft = await first;
  assert.equal(draft.title, "打印机离线");
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.quota, 1);
  assert.equal(h.state.drafts, 1);
  assert.equal(h.state.records[0].inputTokens, 60);
  assert.equal(h.state.records[0].outputTokens, 30);
  assert.equal(h.conversation.activeRequestId, null);
  const reused = await h.service.createDraft("conv", user);
  assert.equal(reused.id, draft.id);
  assert.equal(h.state.calls, 1);
});

test("AI draft failures preserve original facts, release the lock, and remain submittable", async () => {
  const h = harness(async () => { throw new Error("upstream-secret-error-details"); });
  const draft = await h.service.createDraft("conv", user);
  assert.match(draft.description, /AI整理暂不可用/);
  assert.match(draft.description, /已经检查了连接/);
  assert.match(draft.description, /建议不代表用户已执行/);
  assert.ok(!draft.description.includes("upstream-secret"));
  assert.equal(h.conversation.activeRequestId, null);
  assert.equal(h.state.records[0].status, "FAILED");
  assert.equal(h.state.quota, 1);
});

test("exhausted daily quota creates an honest fallback card without a paid provider call", async () => {
  const h = harness(); h.state.quota = 100;
  const draft = await h.service.createDraft("conv", user);
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.quota, 100);
  assert.match(draft.description, /今日AI额度已用完/);
  assert.equal(h.conversation.activeRequestId, null);
});

test("demo conversations and internal auto cards never call a paid model or steal the active answer lock", async () => {
  const demo = harness(); demo.conversation.messages[0].model = "local-demo";
  const draft = await demo.service.createDraft("conv", user);
  assert.equal(demo.state.calls, 0);
  assert.equal(demo.state.quota, 0);
  assert.match(draft.description, /本地模拟/);
  const internal = harness();
  internal.conversation.busyUntil = new Date(Date.now() + 60000);
  internal.conversation.activeRequestId = "answer-in-progress";
  await internal.service.createDraft("conv", user, { useModel: false });
  assert.equal(internal.state.calls, 0);
  assert.equal(internal.state.quota, 0);
  assert.equal(internal.conversation.activeRequestId, "answer-in-progress");
});

test("malformed model JSON falls back while retaining known billed usage", async () => {
  const h = harness(async () => ({ ...modelReply, content: "not JSON" }));
  const draft = await h.service.createDraft("conv", user);
  assert.match(draft.description, /原始记录/);
  assert.equal(h.state.records[0].inputTokens, 60);
  assert.equal(h.state.records[0].outputTokens, 30);
  assert.equal(h.state.records[0].status, "FAILED");
});
