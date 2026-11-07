import test from "node:test";
import assert from "node:assert/strict";
import { aiRequestSignature, pendingAiRequest } from "../components/ai/requestIdentity";

const payload = { conversationId: "conversation-1", categoryId: "network", content: "无法连接", attachments: [{ name: "error.png", url: "/api/uploads/test.png" }], referenceConversationIds: ["history-1"], demo: false };

test("ambiguous browser retries reuse the same request identity after storage round trip", async () => {
  const signature = await aiRequestSignature(payload);
  const original = pendingAiRequest(signature, null, 1000);
  assert.equal(pendingAiRequest(signature, JSON.parse(JSON.stringify(original)), 2000).requestId, original.requestId);
  assert.equal(signature.includes(payload.content), false);
});

test("changed user intent, attachments, histories or conversations start a new request", async () => {
  const original = pendingAiRequest(await aiRequestSignature(payload), null, 1000);
  for (const changed of [
    { ...payload, content: "新的问题" }, { ...payload, conversationId: "conversation-2" },
    { ...payload, categoryId: "printer" }, { ...payload, attachments: [] },
    { ...payload, referenceConversationIds: [] }, { ...payload, demo: true }
  ]) assert.notEqual(pendingAiRequest(await aiRequestSignature(changed), original, 2000).requestId, original.requestId);
});

test("expired or invalid stored identities cannot be reused", async () => {
  const signature = await aiRequestSignature(payload);
  const original = pendingAiRequest(signature, null, 1000);
  assert.notEqual(pendingAiRequest(signature, original, 86401000).requestId, original.requestId);
  assert.notEqual(pendingAiRequest(signature, { ...original, requestId: "invalid" }, 2000).requestId, "invalid");
});
