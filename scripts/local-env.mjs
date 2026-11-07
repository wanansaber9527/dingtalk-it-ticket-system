import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local-dev");
const configPath = path.join(local, "runtime.json");
const port = 33427;
const database = "itdesk_local";
const socket = path.join(local, "mysql.sock");
fs.mkdirSync(local, { recursive: true, mode: 0o700 });

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}

function mysql(sql, initial = false) {
  const args = initial
    ? ["--no-defaults", "--protocol=socket", `--socket=${socket}`, "-u", "root"]
    : [`--defaults-extra-file=${path.join(local, "mysql-client.cnf")}`, "--protocol=socket"];
  const result = spawnSync("mysql", args, { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`本地 MySQL 操作失败：${result.stderr}`);
}

async function startDatabase() {
  if (fs.existsSync(socket)) {
    const ping = spawnSync("mysqladmin", ["--no-defaults", "--protocol=socket", `--socket=${socket}`, "ping"], { encoding: "utf8" });
    if (ping.status === 0 || ping.stderr.includes("Access denied")) return;
  }
  const datadir = path.join(local, "mysql");
  if (!fs.existsSync(path.join(datadir, "auto.cnf"))) {
    execute("mysqld", ["--no-defaults", "--initialize-insecure", `--datadir=${datadir}`, `--log-error=${path.join(local, "mysql-init.log")}`]);
  }
  const child = spawn("mysqld", ["--no-defaults", `--datadir=${datadir}`, `--socket=${socket}`, `--port=${port}`, "--bind-address=127.0.0.1", "--mysqlx=OFF", `--pid-file=${path.join(local, "mysql.pid")}`, `--log-error=${path.join(local, "mysql.log")}`], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (fs.existsSync(socket)) return;
  }
  throw new Error("本地 MySQL 未能启动，请查看 .local-dev/mysql.log");
}

function createConfig() {
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, "utf8"));
  const token = () => crypto.randomBytes(32).toString("hex");
  const config = { rootPassword: token(), appPassword: token(), writerPassword: token(), metadataPassword: token(), authSecret: token(), correctionSecret: token(), auditSecret: token(), correctionPassword: token().slice(0, 20) };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(local, "mysql-client.cnf"), `[client]\nuser=root\npassword=${config.rootPassword}\nsocket=${socket}\n`, { mode: 0o600 });
  mysql(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${config.rootPassword}';`, true);
  return config;
}

export function localEnvironment(config, mode = "development") {
  const env = Object.fromEntries(["PATH", "HOME", "SHELL", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "SystemRoot"].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  // 只读取无凭据的示例文件；本地子进程通过 preload 禁止加载任何真实 dotenv 文件。
  for (const file of [".env.example"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match && !["PATH", "HOME", "SHELL", "NODE_ENV"].includes(match[1])) env[match[1]] = "";
    }
  }
  return { ...env,
    NODE_ENV: mode,
    ITDESK_LOCAL_ISOLATED: "1",
    NODE_OPTIONS: `--require ${JSON.stringify(path.join(root, "scripts", "local-no-dotenv.cjs"))}`,
    DATABASE_URL: `mysql://local_app:${config.appPassword}@127.0.0.1:${port}/${database}`,
    AUTH_COOKIE_SECRET: config.authSecret,
    AI_CONFIG_SECRET: config.aiConfigSecret || config.authSecret,
    AI_LOCAL_DEMO_ENABLED: mode === "development" ? "true" : "false",
    // 本机代理使用 Fake-IP DNS；仅对用户指定的 DeepSeek HTTPS 主机允许该本地例外。
    AI_TRUSTED_PROXY_HOSTS: mode === "development" ? "api.deepseek.com" : "",
    DEV_AUTH_ENABLED: mode === "development" ? "true" : "false",
    DINGTALK_MOCK_ENABLED: mode === "development" ? "true" : "false",
    DINGTALK_CORP_ID: mode === "development" ? "local-corp" : "",
    DIRECTORY_SYNC_CRON_SECRET: config.authSecret,
    DIRECTORY_SYNC_LOCAL_FIXTURE: mode === "development" && fs.existsSync(path.join(local, "directory-fixture.json")) ? path.join(local, "directory-fixture.json") : "",
    DEV_DINGTALK_USER_ID: "local-admin",
    DEV_USER_NAME: "本地管理员",
    DEV_USER_DEPARTMENT_NAME: "信息技术部",
    NEXT_PUBLIC_LOCAL_DEMO: mode === "development" ? "true" : "false",
    NEXT_PUBLIC_DINGTALK_CORP_ID: "",
    APP_BASE_URL: "http://127.0.0.1:3100",
    UPLOAD_DIR: path.join(local, "uploads"),
    LOCAL_NEXT_DIST_DIR: mode === "development" ? ".next-local" : ".next-build-check",
    NEXT_TELEMETRY_DISABLED: "1",
    TZ: "Asia/Shanghai"
  };
}

async function setup() {
  await startDatabase();
  const config = createConfig();
  mysql(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'local_app'@'127.0.0.1' IDENTIFIED BY '${config.appPassword}';
    GRANT ALL PRIVILEGES ON ${database}.* TO 'local_app'@'127.0.0.1';
    CREATE USER IF NOT EXISTS 'local_writer'@'127.0.0.1' IDENTIFIED BY '${config.writerPassword}';
    CREATE USER IF NOT EXISTS 'local_metadata'@'127.0.0.1' IDENTIFIED BY '${config.metadataPassword}';`);
  const env = localEnvironment(config);
  execute(process.execPath, ["node_modules/prisma/build/index.js", "generate"], { env });
  execute(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env });
  mysql(`GRANT SELECT, UPDATE ON ${database}.Ticket TO 'local_writer'@'127.0.0.1';
    GRANT SELECT, TRIGGER ON ${database}.Ticket TO 'local_metadata'@'127.0.0.1';`);
  execute(process.execPath, ["--import", "tsx", "scripts/local-seed.ts"], { env });
  execute(process.execPath, ["--import", "tsx", "scripts/backfill-personnel.ts", "--apply"], { env });
  console.log("本地测试库已就绪：127.0.0.1:33427 / itdesk_local（仅示例数据）");
}

function startDirectoryWorker(env) {
  const pidPath = path.join(local, "directory-worker.pid");
  if (fs.existsSync(pidPath)) {
    try { process.kill(Number(fs.readFileSync(pidPath, "utf8")), 0); return; }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const logfile = fs.openSync(path.join(local, "directory-worker.log"), "a", 0o600);
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/directory-sync-worker.ts"], { cwd: root, env, detached: true, stdio: ["ignore", logfile, logfile] });
  fs.writeFileSync(pidPath, String(child.pid));
  child.unref();
  fs.closeSync(logfile);
}

async function main() {
  const action = process.argv[2] || "start";
  if (action === "setup") return setup();
  if (!fs.existsSync(configPath)) throw new Error("请先运行 npm run local:setup");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  await startDatabase();
  const env = localEnvironment(config, action === "build" ? "production" : "development");
  if (action === "build") return execute(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env });
  if (action === "test") {
    const files = fs.readdirSync(path.join(root, "tests")).filter((name) => name.endsWith(".test.ts")).map((name) => `tests/${name}`);
    return execute(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], { env: { ...env, RUN_LOCAL_DB_TESTS: "1", RUN_LOCAL_HTTP_TESTS: "1" } });
  }
  if (action === "sync-once") return execute(process.execPath, ["--import", "tsx", "scripts/directory-sync-worker.ts", "--once"], { env });
  if (action !== "start") throw new Error("支持的命令：setup / start / build / test / sync-once");
  startDirectoryWorker(env);
  const pidPath = path.join(local, "app.pid");
  if (fs.existsSync(pidPath)) {
    const pid = Number(fs.readFileSync(pidPath, "utf8"));
    try {
      process.kill(pid, 0);
      console.log("本地服务已启动：http://127.0.0.1:3100/admin");
      return;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const logfile = fs.openSync(path.join(local, "app.log"), "a", 0o600);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3100"], { cwd: root, env, detached: true, stdio: ["ignore", logfile, logfile] });
  fs.writeFileSync(path.join(local, "app.pid"), String(child.pid));
  child.unref();
  fs.closeSync(logfile);
  console.log("本地服务启动中：http://127.0.0.1:3100/admin\n日志：.local-dev/app.log");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
