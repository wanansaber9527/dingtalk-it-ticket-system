import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendAudit,
  inspectAuditChain
} from "../lib/audit.js";

test("独立审计按 0600 写入并形成哈希链", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-correction-audit-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const auditPath = path.join(directory, "corrections.jsonl");
  process.env.CORRECTION_AUDIT_PATH = auditPath;
  process.env.CORRECTION_AUDIT_SECRET = "a".repeat(64);

  await appendAudit({ phase: "PREPARED", operationId: "operation-1" });
  await appendAudit({ phase: "COMMITTED", operationId: "operation-1" });

  const records = (await fs.readFile(auditPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.equal(records[0].previousHash, "");
  assert.equal(records[1].previousHash, records[0].hash);
  assert.match(records[0].hash, /^[a-f0-9]{64}$/);

  const mode = (await fs.stat(auditPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const inspected = await inspectAuditChain();
  assert.equal(inspected.records.length, 2);
  assert.equal(inspected.lastHash, records[1].hash);
});

test("独立审计被篡改后拒绝继续追加", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-correction-audit-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const auditPath = path.join(directory, "corrections.jsonl");
  process.env.CORRECTION_AUDIT_PATH = auditPath;
  process.env.CORRECTION_AUDIT_SECRET = "b".repeat(64);

  await appendAudit({ phase: "PREPARED", operationId: "operation-2" });
  const contents = await fs.readFile(auditPath, "utf8");
  await fs.writeFile(auditPath, contents.replace("PREPARED", "COMMITTED"), "utf8");

  await assert.rejects(
    inspectAuditChain,
    (error) => error?.code === "AUDIT_CHAIN_INVALID"
  );
  await assert.rejects(
    appendAudit({ phase: "FAILED", operationId: "operation-2" }),
    (error) => error?.code === "AUDIT_UNAVAILABLE"
  );
});
