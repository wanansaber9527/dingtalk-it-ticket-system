import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuditRecovery } from "../lib/audit-recovery.js";
import { reconcileAuditState } from "../lib/audit-recovery.js";
import { appendAudit, inspectAuditChain } from "../lib/audit.js";
import { withCorrectionLock } from "../lib/correction-lock.js";
import { ticketFingerprint } from "../lib/ticket-domain.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const prepared = {
  ticketId: "ticket-1",
  expectedFingerprint: "before",
  plannedFingerprint: "after"
};

test("悬空 PREPARED 可区分数据库已提交和未提交", () => {
  assert.equal(classifyAuditRecovery(prepared, "after"), "RECOVERED_COMMITTED");
  assert.equal(classifyAuditRecovery(prepared, "before"), "RECOVERED_NOT_COMMITTED");
  assert.equal(classifyAuditRecovery(prepared, "another"), "RECONCILIATION_REQUIRED");
});

test("缺少计划指纹的旧审计记录会关闭写入", () => {
  assert.throws(
    () => classifyAuditRecovery({ ticketId: "ticket-1", expectedFingerprint: "before" }, "before"),
    (error) => error?.code === "AUDIT_RECORD_INCOMPLETE"
  );
});

test("单进程并发健康检查等待更正提交，不误判为未提交", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "audit-concurrency-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  process.env.CORRECTION_AUDIT_PATH = path.join(directory, "audit.jsonl");
  process.env.CORRECTION_AUDIT_SECRET = "isolated-test-secret".repeat(4);
  const ticket = { id: "ticket-1", title: "before" };
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  let notifyPrepared;
  const isPrepared = new Promise((resolve) => { notifyPrepared = resolve; });
  const correction = withCorrectionLock(async () => {
    await appendAudit({ ...prepared, operationId: "running", phase: "PREPARED" });
    notifyPrepared();
    await paused;
    ticket.title = "after";
    await appendAudit({ operationId: "running", phase: "COMMITTED" });
  });
  await isPrepared;
  let reads = 0;
  const recovery = reconcileAuditState({ client: { ticket: { findUnique: async () => {
    reads += 1;
    return ticket;
  } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0, "正在执行的操作不得进入恢复查询");
  release();
  await Promise.all([correction, recovery]);
  assert.deepEqual((await inspectAuditChain()).records.map((record) => record.phase), ["PREPARED", "COMMITTED"]);
});

test("并发恢复只补一个终态，失败的操作锁不会阻塞后续请求", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "audit-recovery-lock-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  process.env.CORRECTION_AUDIT_PATH = path.join(directory, "audit.jsonl");
  process.env.CORRECTION_AUDIT_SECRET = "isolated-test-secret".repeat(4);
  const ticket = { id: "ticket-1", title: "before" };
  await appendAudit({
    ...prepared, operationId: "interrupted", phase: "PREPARED",
    expectedFingerprint: ticketFingerprint(ticket)
  });
  await assert.rejects(withCorrectionLock(async () => { throw new Error("test failure"); }));
  const client = { ticket: { findUnique: async () => ticket } };
  await Promise.all([reconcileAuditState({ client }), reconcileAuditState({ client })]);
  assert.deepEqual((await inspectAuditChain()).records.map((record) => record.phase), ["PREPARED", "RECOVERED_NOT_COMMITTED"]);
  await withCorrectionLock(() => withCorrectionLock(async () => "nested"));
});
