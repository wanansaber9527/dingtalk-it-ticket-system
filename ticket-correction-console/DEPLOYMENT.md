# 独立部署说明

## 1. 部署目录

建议使用独立目录和独立 PM2 进程，例如：

```text
/www/wwwroot/ticket-correction-console/current
```

不要覆盖主工单系统的部署目录。

## 2. 安装与构建

生产机使用 Node.js `20.19.x` 或 `22.9.0` 及以上版本。构建脚本依赖 `--env-file-if-exists`（Node 20.19 / 22.9 起支持），启动器依赖原生 `process.loadEnvFile()` 从项目根加载环境文件。

```bash
cd /www/wwwroot/ticket-correction-console/current
npm ci
npm run check
```

`NEXT_PUBLIC_CORRECTION_BASE_PATH` 是构建期配置，修改固定路径后必须重新构建。

构建只把 standalone 运行文件和静态资源放入 `.next`，不会复制 `.env.local`。生产启动器会在 Next.js 切换工作目录前，显式读取项目根目录的 `.env.local`。

## 3. 配置文件

创建 `.env.local` 并执行：

```bash
chmod 600 .env.local
```

生产环境至少需要：

```dotenv
DATABASE_URL="mysql://ticket_corrector:CHANGE_ME@127.0.0.1:3306/it_ticket"
CORRECTION_METADATA_DATABASE_URL="mysql://ticket_metadata:CHANGE_ME@127.0.0.1:3306/it_ticket"
EXPECTED_DATABASE_NAME="it_ticket"
NEXT_PUBLIC_CORRECTION_BASE_PATH="/ticket-correction-console"
CORRECTION_USERNAME="CHANGE_ME"
CORRECTION_PASSWORD_HASH="CHANGE_ME"
CORRECTION_SESSION_SECRET="CHANGE_ME"
CORRECTION_AUDIT_SECRET="CHANGE_ME"
CORRECTION_SESSION_TTL_MINUTES="120"
CORRECTION_COOKIE_SECURE="true"
CORRECTION_AUDIT_PATH="/var/lib/ticket-correction-console/corrections.jsonl"
```

审计目录应由运行账号独占：

```bash
install -d -m 700 /var/lib/ticket-correction-console
```

## 4. PM2

应用必须保持单实例：

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

PM2 和 `npm start` 都调用 `scripts/start-production.mjs`。该启动器只读取当前发布项目根目录的 `.env.local`，文件缺失或 `CORRECTION_COOKIE_SECURE` 不是 `true` 时会拒绝启动。

健康状态和登录页面可用不代表真实数据库已经通过写入门槛。登录后应确认页面顶部显示“数据库可写”。

## 5. Nginx

先在 Nginx 的 `http` 级别建立登录限流区：

```nginx
limit_req_zone $binary_remote_addr
    zone=ticket_correction_login:10m
    rate=5r/m;
```

再在站点的 `server` 中配置登录接口和固定路径。登录接口使用独立的精确匹配 location：

```nginx
location = /ticket-correction-console/api/auth/login {
    limit_req zone=ticket_correction_login burst=5 nodelay;
    limit_req_status 429;

    proxy_pass http://127.0.0.1:31023;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
}

location ^~ /ticket-correction-console {
    proxy_pass http://127.0.0.1:31023;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Nginx 必须覆盖客户端传入的 `X-Real-IP` 和 `X-Forwarded-For`，不能使用会保留伪造 XFF 的 `$proxy_add_x_forwarded_for`。应用只使用受控代理写入的 `X-Real-IP` 做登录限流，并且仍绑定在 `127.0.0.1`，不得把 `31023` 端口直接暴露到公网。该配置不需要在主工单系统增加路由或导航。

## 6. 上线前只读核对

使用独立数据库账号确认：

```sql
SELECT DATABASE(), VERSION(), @@session.time_zone;
SHOW CREATE TABLE Ticket;
SHOW COLUMNS FROM Ticket LIKE 'status';
SHOW GRANTS;

SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE EVENT_OBJECT_SCHEMA = DATABASE()
  AND EVENT_OBJECT_TABLE = 'Ticket';
```

触发器查询必须使用具有 `Ticket TRIGGER` 可见权限的核查账号。不能用仅有 SELECT/UPDATE 的写账号查询后，将空结果视为无触发器。两个账号应分别执行 `SHOW GRANTS`：

```sql
GRANT SELECT, UPDATE ON it_ticket.Ticket TO 'ticket_corrector'@'127.0.0.1';
GRANT SELECT, TRIGGER ON it_ticket.Ticket TO 'ticket_metadata'@'127.0.0.1';
```

应用强制校验两个连接的 `DATABASE()`、`@@server_uuid` 一致且 `CURRENT_USER()` 不同；核查账号不能拥有任何业务表 DML 权限。新连接缺失或权限不符合白名单时写入保持关闭。若 Ticket 存在触发器，应用会拒绝更正，因为无法保证触发器不会产生额外写入。

核查账号的 `TRIGGER` 仍允许触发器 DDL，不能称为严格只读账号。生产进一步收紧时，优先由 DBA 建立受控的 DEFINER 元数据接口，使应用账号只需 EXECUTE；这需要配套适配核查实现，本版不能直接用只授予 EXECUTE 的账号代替。

## 7. 业务验收

- 普通浏览器可打开固定地址，无需钉钉
- 主系统所有页面都没有更正台入口
- 未登录不能读取或更新工单
- 核查账号缺失 TRIGGER 权限、连接到不同实例或拥有 UPDATE 权限时，保存被拒绝
- 使用测试触发器验证检测生效；不要在正式库造触发器测试
- 并发健康检查不会把正在保存的操作恢复为未提交
- 只改标题时确认页不声称将重算历史 SLA
- 完成时间早于截止时间为正常
- 完成时间等于截止时间为正常
- 完成时间晚于截止时间为超时
- 修改完成时间不改变首响超时
- 并发保存时后提交者收到冲突提示
- 保存前后 `TicketLog`、`Notification` 行数不变
- 审计文件不可写时数据库内容不变

## 8. 回滚

停止独立进程并撤销 Nginx location 即可：

```bash
pm2 stop ticket-correction-console
```

因为主工单代码和数据库结构均未修改，不需要回滚主系统代码或执行数据库迁移。已经由更正台写入的 Ticket 数据，应根据独立审计记录人工确认后再恢复。
