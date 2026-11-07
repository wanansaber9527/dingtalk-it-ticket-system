import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { auditConfig } from "./server-config.js";
import { AppError } from "./http.js";

let appendQueue = Promise.resolve();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function inspectAuditChain() {
  const config = auditConfig();
  let contents;
  try {
    contents = await fs.readFile(config.path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], lastHash: "" };
    throw new AppError(503, "AUDIT_UNAVAILABLE", "无法读取独立更正记录，写入功能已关闭");
  }

  if (!contents) return { records: [], lastHash: "" };

  const lines = contents.split("\n").filter(Boolean);
  const records = [];
  let previousHash = "";
  try {
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const { hash, ...payload } = parsed;
      if (payload.previousHash !== previousHash || typeof hash !== "string") {
        throw new Error("audit chain link mismatch");
      }
      const expected = crypto
        .createHmac("sha256", config.secret)
        .update(`${previousHash}\n${JSON.stringify(canonical(payload))}`)
        .digest("hex");
      if (!safeHashEqual(hash, expected)) {
        throw new Error("audit record signature mismatch");
      }
      records.push(parsed);
      previousHash = hash;
    }
  } catch (error) {
    console.error("Correction audit chain validation failed", error);
    throw new AppError(503, "AUDIT_CHAIN_INVALID", "独立更正记录校验失败，写入功能已关闭");
  }

  return { records, lastHash: previousHash };
}

async function appendRecord(record) {
  const config = auditConfig();
  const directory = path.dirname(config.path);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const { lastHash: previousHash } = await inspectAuditChain();
  const payload = {
    ...record,
    recordedAt: new Date().toISOString(),
    previousHash
  };
  const serialized = JSON.stringify(canonical(payload));
  const hash = crypto
    .createHmac("sha256", config.secret)
    .update(`${previousHash}\n${serialized}`)
    .digest("hex");
  const line = `${JSON.stringify({ ...payload, hash })}\n`;

  const handle = await fs.open(config.path, "a", 0o600);
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return hash;
}

export function appendAudit(record) {
  const task = appendQueue.then(() => appendRecord(record));
  appendQueue = task.catch(() => undefined);
  return task.catch((error) => {
    console.error("Correction audit write failed", error);
    throw new AppError(503, "AUDIT_UNAVAILABLE", "更正记录不可写，本次操作已拒绝");
  });
}

export async function appendAuditFailure(record) {
  try {
    await appendAudit(record);
  } catch {
    // PREPARED 已经成功写入时，后续失败日志写入异常不应覆盖原始数据库错误。
  }
}
