import test from "node:test";
import assert from "node:assert/strict";
import { conversationExcerpt, buildContext } from "../src/server/ai/context";
import { DEFAULT_AI_SETTINGS } from "../src/server/ai/config";
import type { AiMessage } from "@prisma/client";
import type { UserWithRoles } from "../src/lib/userRoles";

test("context excerpts enforce a hard budget even across thousands of long messages", () => {
  const messages = Array.from({ length: 10000 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}:` + "长".repeat(12000), status: "COMPLETE" }));
  const excerpt = conversationExcerpt(messages, 4000);
  assert.ok(excerpt.length <= 4000);
  assert.match(excerpt, /9999/);
  assert.match(excerpt, /AI建议（不表示用户已执行）/);
});

test("model context bounds history while keeping trusted rules and the newest question", async () => {
  const now = new Date();
  const messages = Array.from({ length: 160 }, (_, i) => ({ id: String(i), conversationId: "c", role: i % 2 ? "user" : "assistant", content: i === 159 ? "当前问题必须保留" : "长".repeat(12000), attachments: "[]", status: "COMPLETE", createdAt: now }) as AiMessage);
  const category = { categoryId: "category", categoryName: "网络", enabled: true, version: 1, examples: [], prompt: "规则".repeat(5990) + "规则末尾保留", environment: "环境".repeat(9990) + "环境末尾保留" };
  const context = await buildContext({ settings: { ...DEFAULT_AI_SETTINGS, contextMessages: 80, systemPrompt: "补充".repeat(5990) + "补充末尾保留" }, category, user: { departmentName: "测试部门" } as UserWithRoles, messages, histories: [] });
  const text = JSON.stringify(context);
  assert.ok(text.length < 80000, `Unexpected context size: ${text.length}`);
  for (const expected of ["当前问题必须保留", "规则末尾保留", "环境末尾保留", "补充末尾保留", "趣然IT工单智能助手"]) assert.ok(text.includes(expected));
});
