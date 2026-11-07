# 趣然 IT 工单数据更正台

这是一个独立运行的 Next.js 子应用，用于在普通浏览器中更正趣然 IT 工单的业务数据。

它不导入主工单系统的页面、认证、服务层或通知模块。应用只连接同一个正式 MySQL，并且只声明 `Ticket` 模型，因此保存操作不会调用 `TicketService`、写入 `TicketLog` 或创建 `Notification`。

## 功能范围

- 固定地址和独立账号密码登录
- 不依赖钉钉身份
- 主工单系统无入口、无菜单、无跳转
- 按工单号、标题、申请人或处理人查询
- 更正状态、业务快照、完成时间、关闭时间和 SLA 时间
- 完成时间或 SLA 截止时间变化后双向重算处理超时
- 首响超时独立计算
- 保存前显示字段差异并要求填写更正原因
- 使用 `updatedAt` 和完整行指纹防止并发覆盖
- 独立 JSONL 更正记录，不进入普通工单时间线
- 写入前只读检查正式数据库字段、状态枚举和 Ticket 触发器

## 超时规则

完成超时：

```text
没有完成 SLA 截止时间：正常
存在完成时间：完成时间 > 完成 SLA 截止时间时超时
没有完成时间且处于 SLA 运行状态：当前时间 > 完成 SLA 截止时间时超时
```

完成时间正好等于截止时间时为正常。首响超时使用首次响应时间和首响 SLA 截止时间单独计算。

主系统显示的总超时仍然是“首响超时或处理超时”。因此处理超时恢复正常后，如果首响仍然超时，主系统仍会显示总 SLA 超时。

## 本地开发

```bash
npm install
npm run validate
npm test
npm run dev
```

默认端口是 `31023`，默认固定路径是：

```text
http://127.0.0.1:31023/ticket-correction-console
```

本地 `.env.local` 已被 Git 忽略，权限必须保持为 `600`。其中的 `DATABASE_URL` 初始值只是不可用的部署占位符，在连接真实工单库前必须替换。

生产启动脚本显式读取项目根目录的 `.env.local`，凭据不会复制进 `.next` 构建产物。应用只信任由 Nginx 覆盖写入的 `X-Real-IP`，不得让外部请求绕过反向代理直连应用端口。

## 凭据配置

禁止把明文密码写入源码或 `.env`。使用交互式脚本生成 scrypt 哈希：

```bash
npm run hash-password
```

把输出保存为 `CORRECTION_PASSWORD_HASH`。在 `.env.local` 中，每个 `$` 要写成 `\$`，避免 Next.js 的 dotenv 展开破坏哈希；服务端会在读取时还原。输入脚本不会回显密码，也不会自动去除密码内部空格或做 Unicode 规范化。

生产环境必须设置：

- `DATABASE_URL`
- `CORRECTION_METADATA_DATABASE_URL`，独立核查账号，连接同一个 MySQL 实例和目标库
- `EXPECTED_DATABASE_NAME`，必须与 `SELECT DATABASE()` 返回值完全一致
- `NEXT_PUBLIC_CORRECTION_BASE_PATH`
- `CORRECTION_USERNAME`
- `CORRECTION_PASSWORD_HASH`
- `CORRECTION_SESSION_SECRET`
- `CORRECTION_AUDIT_SECRET`
- `CORRECTION_AUDIT_PATH`
- `CORRECTION_COOKIE_SECURE=true`

## 数据库权限

独立数据库账号建议只授予：

```sql
GRANT SELECT, UPDATE ON it_ticket.Ticket TO 'ticket_corrector'@'127.0.0.1';
```

另建仅用于核查的账号，通过 `CORRECTION_METADATA_DATABASE_URL` 配置：

```sql
GRANT SELECT, TRIGGER ON it_ticket.Ticket TO 'ticket_metadata'@'127.0.0.1';
```

MySQL 只有在账号拥有目标表 `TRIGGER` 权限时才显示触发器元数据。写账号的查询结果为空不能证明没有触发器。应用因此使用独立核查连接，逐次验证它与写连接的数据库名、MySQL `server_uuid` 相同且账号不同；核查账号必须且只能拥有目标表的 `SELECT`、`TRIGGER`，没有业务数据 `INSERT`、`UPDATE`、`DELETE` 权限。缺少连接、触发器可见权限或校验失败时，保存立即关闭。

`TRIGGER` 权限同时允许创建和删除目标表触发器，并不是纯只读元数据权限。此版本应用不会调用这些操作；生产若要求数据库层也阻止此类 DDL，应由 DBA 提供受控的 `SQL SECURITY DEFINER` 元数据接口，再将核查账号缩减到该接口的 `EXECUTE` 权限，并相应接入核查实现。不要将 `TRIGGER` 加到写账号，也不要直接修改授权白名单以跳过验证。


不要授予全局权限、`Ticket` 的 `INSERT`/`DELETE`、其他业务表权限或 `information_schema` 写权限，也不要执行 `prisma db push` 或任何迁移。本应用的 Prisma Schema 只用于生成一个读取和更新现有 `Ticket` 表的客户端。应用会读取 `information_schema.COLUMNS`，并通过独立核查连接读取 `information_schema.TRIGGERS`；若数据库显式列出相关授权，只允许只读 `SELECT`。

正式写入前，应用会从 `information_schema` 核对：

- 当前数据库是否与 `EXPECTED_DATABASE_NAME` 完全一致
- 必要列是否存在
- 正式 status enum 支持哪些状态
- Ticket 表是否存在数据库触发器
- 当前账号是否只有允许的最小权限，并且确实拥有 Ticket `SELECT`、`UPDATE`

普通健康检查可以短暂缓存结果，但每一次数据库写入前都会强制重新核对库名、结构、触发器和当前账号授权。任一项不匹配时写入会失败关闭。

## 独立更正记录

更正记录采用 JSONL，并使用 HMAC 哈希链连接。每次更正包含：

- `PREPARED`
- `COMMITTED` 或 `FAILED`
- 操作账号、工单号、更正原因
- 字段前值和后值
- 请求号、时间、前序哈希

审计文件不可写时，数据库更新会在开始前被拒绝。生产路径应放在发布目录之外，并保持文件权限 `600`。应用必须使用单实例运行，避免多个进程同时追加同一个文件。

同一进程内，完整更正流程与审计恢复共用操作锁。健康检查会等待正在执行的更正结束，不会把尚未提交的正常操作误判为历史异常。多个进程或多副本仍不受此锁保护，必须维持单实例部署。

前端保存预览与后端更新使用同一套字段差异及 SLA 计算逻辑。只修改标题等无关字段时保留历史超时标记；改变状态或相关时间才重算对应标记。

## 静默边界

本应用的保存动作：

- 不调用钉钉
- 不创建 `Notification`
- 不写 `TicketLog`
- 不在普通工单详情时间线显示

如果把工单改回进行中、清空完成时间或调整未来 SLA，主系统后续定时任务仍可能按照正常规则发送 SLA 提醒。已完成且有 `resolvedAt` 的工单不会进入该提醒扫描。

部署方法见 [DEPLOYMENT.md](./DEPLOYMENT.md)。
