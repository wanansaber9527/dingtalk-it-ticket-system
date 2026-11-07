import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("独立 Prisma 客户端只声明 Ticket 模型", async () => {
  const schema = await fs.readFile(
    path.join(projectRoot, "prisma", "schema.prisma"),
    "utf8"
  );
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(models, ["Ticket"]);
  assert.doesNotMatch(schema, /\bTicketLog\b|\bNotification\b/);
});

test("更正服务不引用主系统日志、通知或钉钉模块", async () => {
  const service = await fs.readFile(
    path.join(projectRoot, "lib", "ticket-service.js"),
    "utf8"
  );
  assert.doesNotMatch(
    service,
    /TicketLog|Notification|DingTalk|ticketService|notificationService/
  );
  assert.match(service, /tx\.ticket\.updateMany/);
});

test("登录表单在前端接管前禁止原生 GET 泄露凭据", async () => {
  const loginForm = await fs.readFile(
    path.join(projectRoot, "components", "LoginForm.jsx"),
    "utf8"
  );
  assert.match(loginForm, /method="post"/);
  assert.match(loginForm, /disabled=\{!hydrated \|\| submitting\}/);
  assert.doesNotMatch(loginForm, /method="get"/i);
});
