# 本地测试交付 · 2026-11-07

发布状态更新：已于 2026-11-07 21:13 正式上线主系统，见 [发布记录](DEPLOYMENT_2026-11-07.md)。以下保留本地交付时的测试范围与记录。

当前工作分支：`codex/local-hardening-ui-20261107`。开发、数据库回归和界面测试全部在本机完成，未部署服务器。原工作区已有改动保留在当前分支，修改前源码备份位于 `.codex-snapshots/before-hardening-ui-20261107-175449/`。

## 打开测试版

- 主系统：http://127.0.0.1:3100/admin
- 员工提单：http://127.0.0.1:3100/tickets/new
- 更正台：http://127.0.0.1:3101/ticket-correction-console

主系统右上角可切换“管理员 / 处理人 / 员工”。这是仅限本地开发模式的入口，生产构建中不显示，接口返回 404。页面使用独立数据库的示例数据，钉钉调用为本地模拟，不发送真实消息。

更正台账号为 `local-review`。本地随机密码在 `.local-dev/runtime.json` 的 `correctionPassword` 字段。该文件还包含本地数据库凭据，请不要上传或提交。需要单独查看密码可在项目目录运行：

```sh
node -e 'console.log(JSON.parse(require("fs").readFileSync(".local-dev/runtime.json","utf8")).correctionPassword)'
```

## 建议验收流程

1. 切换员工，填写标题、分类、描述，上传图片后提交；确认详情、附件和处理人正常。
2. 切换处理人，在工作台找到刚提交的工单，接单、添加备注、调整预计时间、退回补充或完成处理。
3. 退回后切换员工补充，再切回处理人继续处理；完成后员工可评价。原有“确认完成 / 重新打开”停用规则继续保留。
4. 切换管理员，检查看板、工单筛选、分页、分派、分类、知识库、权限和通知记录。
5. 先编辑分类或知识，再点击新建，确认没有带入上一条内容。保存中按钮应锁定；图片上传中或失败时不能提交。
6. 在窄窗口检查手机布局、底部导航、弹窗和表格。更正台先看变更差异，再测试本地更正和审计恢复。

已留下一条 `本地验收 · Fluent 提单流程` 的已完成工单及评价，便于核对完整流转；自动化测试创建的数据会清理。

## 启动与检查

本机已准备 Node 和 MySQL，数据目录为 `.local-dev/mysql`，仅监听 `127.0.0.1:33427`，数据库为 `itdesk_local`。启动器不读取原 `.env`，也不使用生产连接。

```sh
npm run local:start
# 首次安装或需要补齐示例数据时使用；upsert 不覆盖已有测试记录
npm run local:setup
# 更正台的隔离预览启动器（本机文件）
node .local-dev/start-correction.mjs
```

检查命令按顺序运行，构建会重新生成类型文件，不要与 typecheck 并行：

```sh
npm run lint
npm run typecheck
npm test
npm run test:local
npm run local:build
npm audit
```

`npm test` 仅执行离线回归，跳过需真实本地库的两个集成套件；`test:local` 显式启用隔离数据库与 HTTP 回归，要求主服务已在 3100 运行。更正台的单元测试在子目录运行 `npm test`。主服务日志：`.local-dev/app.log`。

## 已完成的验证

- 主项目：ESLint、TypeScript、生产构建通过；68 项离线与隔离数据库/HTTP 测试全部通过，无跳过。
- 生产模式本机冒烟：10 项通过，包含匿名拒绝、开发身份无效、有效/过期 Cookie、员工后台权限、旧附件路由鉴权。
- 更正台：59 项单元测试、生产构建、真实本地数据库权限与审计恢复验证通过。
- 两个项目的 npm audit 均为 0 项；这表示当前依赖扫描无已知告警，不代表所有业务漏洞已被穷尽。
- 浏览器完成手机/桌面、完整提单流转、表单新建重置、分页异常和短屏导航检查。最后复查页面无新控制台告警。
- 明细见 `output/local-verification/verification.json`，桌面截图为 `output/local-verification/fluent-dashboard-desktop.jpg`。

## 本轮完成的修复

| 范围 | 改动 |
| --- | --- |
| 登录 | 生产禁止 Mock/开发身份；强制独立密钥；签名 Cookie 到期校验；同源回跳；钉钉加载/请求超时及失败重试 |
| 附件 | 上传与下载鉴权；真实图片解码、大小/像素/频率限制；私有目录与归属校验；旧链接按工单权限兼容 |
| 账号权限 | 同步不覆盖人工禁用；保护最后有效超管；默认执行人必须有效 |
| 工单 | 终态禁止分派转交；操作与日志事务提交；并发冲突保护；编号冲突有限重试；SLA在实际操作时计算 |
| 通知 | 保留完整正文；跨进程去重、失败退避、过期租约恢复；旧 worker 不能覆盖新结果；cron 区分扫描/实际发送 |
| 统计与列表 | 全量聚合替代前500条样本；状态图不重复计算超时；关键词和超时筛选同时生效；三列表服务端分页 |
| 表单 | 新建/编辑隔离；保存锁；上传完成校验；知识建议防抖取消；错误和空状态区分；评价/备注独立表单 |
| 更正台 | 独立元数据权限核查、触发器阻断、审计恢复互斥、预览与服务端SLA一致、请求体限制 |
| 界面 | 按指定 Fluent 风格统一蓝灰色、轻亚克力导航、细边框、轻阴影、键盘焦点、减少动效及移动适配 |
| 依赖 | 修补 Next/React/Prisma/图片处理及传递依赖；Ant Design 5 按官方方案适配 React 19 |

UI/UX Pro Max 已从 2.11.0 更新至官方稳定版本 2.15.0，旧技能保存在用户技能备份目录。视觉参考：[StyleKit Fluent Design](https://www.stylekit.top/zh/styles/fluent-design)。React 19 兼容依据：[Ant Design 官方说明](https://5x-ant-design.antgroup.com/docs/react/v5-for-19)。

## 上线前的实际配置要求

本轮未新增主数据库 schema 变更。用户完成本地验收后，再安排服务器发布和真实钉钉联调。

- 生产必须配置至少 32 字节的随机 `AUTH_COOKIE_SECRET`，关闭 `DEV_AUTH_ENABLED` 和 `DINGTALK_MOCK_ENABLED`。新 Cookie 格式上线后旧登录会失效，需从钉钉重新免登。
- 新附件写入私有目录，确保目录持久化和备份。反向代理的 `/uploads/*` 必须转发到 Next 鉴权路由，不能继续用公开静态 `alias`。
- `scripts/migrate-private-uploads.ts` 默认只预览，`--apply` 只复制并核对哈希，不删除旧附件；需结合服务器实际目录执行，尚未在服务器运行。
- 更正台需新增独立的 `CORRECTION_METADATA_DATABASE_URL`，与 writer 同库同实例、不同账号，元数据账号不能有业务 DML 权限。MySQL `TRIGGER` 权限含触发器 DDL 能力；配置边界和替代方案见子项目 README。
- 真正的钉钉免登、企业通讯录、OA 通知投递、服务器代理和存量图片访问仍需发布环境验证。本地 Mock 回归不等于这些外部集成已上线验收。
