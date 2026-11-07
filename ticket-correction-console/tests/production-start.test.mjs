import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadProjectEnvironment,
  PROJECT_ROOT,
  validateProductionEnvironment
} from "../scripts/start-production.mjs";
import { auditConfig } from "../lib/server-config.js";

test("生产启动只从项目根显式加载 .env.local", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ticket-correction-runtime-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const variableName = "CORRECTION_RUNTIME_ENV_TEST";
  delete process.env[variableName];
  t.after(() => delete process.env[variableName]);

  await fs.writeFile(
    path.join(directory, ".env.local"),
    `${variableName}=loaded-from-project-root\n`,
    { mode: 0o600 }
  );
  const loadedPath = loadProjectEnvironment(directory);
  assert.equal(loadedPath, path.join(directory, ".env.local"));
  assert.equal(process.env[variableName], "loaded-from-project-root");
});

test("生产启动拒绝缺失的项目根环境文件", () => {
  assert.throws(
    () => loadProjectEnvironment(path.join(os.tmpdir(), "missing-correction-env")),
    /Production environment file is missing/
  );
});

test("生产启动强制启用 Secure Cookie", () => {
  const previous = process.env.CORRECTION_COOKIE_SECURE;
  try {
    process.env.CORRECTION_COOKIE_SECURE = "false";
    assert.throws(
      () => validateProductionEnvironment(),
      /Production requires CORRECTION_COOKIE_SECURE=true/
    );
    process.env.CORRECTION_COOKIE_SECURE = "true";
    assert.doesNotThrow(() => validateProductionEnvironment());
  } finally {
    process.env.CORRECTION_COOKIE_SECURE = previous;
  }
});

test("PM2 与 npm start 共用同一个生产启动器", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8")
  );
  const ecosystemModule = await import(
    pathToFileURL(path.join(PROJECT_ROOT, "ecosystem.config.cjs")).href
  );
  assert.equal(packageJson.scripts.start, "node scripts/start-production.mjs");
  assert.equal(
    ecosystemModule.default.apps[0].script,
    "scripts/start-production.mjs"
  );
  assert.equal(ecosystemModule.default.apps[0].env.HOSTNAME, "127.0.0.1");
});

test("standalone 切换工作目录后审计相对路径仍以项目根解析", () => {
  const previousRoot = process.env.CORRECTION_PROJECT_ROOT;
  const previousPath = process.env.CORRECTION_AUDIT_PATH;
  const previousSecret = process.env.CORRECTION_AUDIT_SECRET;
  try {
    process.env.CORRECTION_PROJECT_ROOT = "/srv/ticket-correction-console";
    process.env.CORRECTION_AUDIT_PATH = "./var/audit/corrections.jsonl";
    process.env.CORRECTION_AUDIT_SECRET = "a".repeat(64);
    assert.equal(
      auditConfig().path,
      "/srv/ticket-correction-console/var/audit/corrections.jsonl"
    );
  } finally {
    if (previousRoot === undefined) delete process.env.CORRECTION_PROJECT_ROOT;
    else process.env.CORRECTION_PROJECT_ROOT = previousRoot;
    if (previousPath === undefined) delete process.env.CORRECTION_AUDIT_PATH;
    else process.env.CORRECTION_AUDIT_PATH = previousPath;
    if (previousSecret === undefined) delete process.env.CORRECTION_AUDIT_SECRET;
    else process.env.CORRECTION_AUDIT_SECRET = previousSecret;
  }
});
