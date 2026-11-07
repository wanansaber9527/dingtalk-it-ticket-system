# 趣然工单系统

公司内部使用的 IT 工单管理系统，入口面向钉钉 H5/工作台。当前数据库使用 MySQL，钉钉 OpenAPI 路径保持集中配置，便于按官方文档补齐或调整。

## 当前版本说明

- “趣然IT工单智能助手”替换知识库并作为首页：分类问答、图片与历史上下文、对话内提单、管理端“大模型配置”，每轮提供与当前回答关联的继续建议。开发验证见 [AI 助手说明](AI_ASSISTANT_LOCAL.md)。
- 分类默认抄送、工单抄送快照与只读查看；人员定时同步、离职归档、返聘身份核验及同步日志。同步进程须独立托管，不能仅启动 Web 服务。

- 系统名称：趣然工单系统
- 核心定位：钉钉内使用的企业 IT 工单提交、分派、处理、通知与统计系统
- 当前版本已移除 AI 表格同步功能，不再展示 AI 同步日志入口和相关接口
- 首页看板支持「图表概览」和「详细数据」两种展示方式
- 图形化看板基于系统真实工单数据展示状态分布、分类排行和执行人处理排行

## 项目目录结构

```text
.
├── app
│   ├── api                         # Next.js API Routes
│   │   ├── admin                   # 管理员接口
│   │   ├── dingtalk                # 钉钉认证/回调/通知测试
│   │   ├── tickets                 # 员工工单接口
│   │   ├── knowledge-base          # 员工知识库搜索
│   │   └── uploads                 # 本地附件上传
│   ├── admin                       # 管理员后台页面
│   ├── tickets                     # 员工端工单页面
│   └── knowledge-base              # 员工端知识库页面
├── components
│   ├── admin                       # 后台布局
│   └── tickets                     # 员工端组件
├── prisma
│   ├── schema.prisma               # 数据模型
│   └── seed.ts                     # 初始化用户、分类、配置
├── scripts
│   └── init-admin.ts               # 初始化超级管理员
└── src
    ├── lib                         # Prisma、HTTP、标签与客户端请求
    └── server
        ├── dingtalk                # DingTalkClient
        └── services                # 工单、分类、通知、知识库、看板、用户服务
```

## 技术栈

- Next.js App Router / React / TypeScript
- Ant Design
- Prisma ORM
- MySQL 8.x

## 核心能力

- 钉钉用户识别：`src/server/services/dingtalkAuthService.ts`
- 员工提交工单、我的工单、详情、补充说明、确认、退回、评价
- 管理员看板、图形化看板、工单管理、分派、转交、处理、关闭
- 分类配置、默认处理人、SLA 时限
- 钉钉工作通知封装和通知记录
- 结构化知识库管理与员工搜索
- 后端角色权限校验

## Prisma Schema

数据库模型在 `prisma/schema.prisma`，包含：

- `User`
- `Ticket`
- `TicketLog`
- `TicketCategory`
- `KnowledgeBase`
- `Notification`
- `SystemConfig`

## REST API

员工端：

- `GET /api/me`
- `POST /api/tickets`
- `GET /api/tickets/my`
- `GET /api/tickets/:id`
- `POST /api/tickets/:id/comments`
- `POST /api/tickets/:id/confirm`
- `POST /api/tickets/:id/reopen`
- `POST /api/tickets/:id/satisfaction`
- `GET /api/knowledge-base/search`

管理员端：

- `GET /api/admin/dashboard`
- `GET /api/admin/tickets`
- `GET /api/admin/tickets/:id`
- `POST /api/admin/tickets/:id/assign`
- `POST /api/admin/tickets/:id/transfer`
- `POST /api/admin/tickets/:id/status`
- `POST /api/admin/tickets/:id/resolve`
- `POST /api/admin/tickets/:id/close`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/:id`
- `GET /api/admin/knowledge-base`
- `POST /api/admin/knowledge-base`
- `PUT /api/admin/knowledge-base/:id`
- `GET /api/admin/notifications`
- `POST /api/admin/notifications/:id/resend`
- `GET /api/admin/users`
- `PUT /api/admin/users/:id/role`

钉钉：

- `GET /api/dingtalk/auth`
- `POST /api/dingtalk/callback`
- `POST /api/dingtalk/notify-test`

## 钉钉封装

- 钉钉用户、access token、工作通知封装：`src/server/dingtalk/DingTalkClient.ts`

## 本地启动

```bash
npm ci
npm run local:setup
npm run local:start
```

使用独立本地 MySQL 与模拟钉钉身份，不加载项目原有 `.env`。具体环境、账号与验证记录见 [本地测试说明](LOCAL_TESTING.md)。不要对正式数据库运行 `db:seed`。

打开：

- 员工端：`http://127.0.0.1:3100/tickets/new`
- 后台：`http://127.0.0.1:3100/admin`

## 初始化管理员账号

默认本地 `.env` 使用 `demo-super` 作为超级管理员。初始化真实钉钉用户为超级管理员：

```bash
npm run init:admin -- --userId <钉钉userId> --name <姓名>
```

## 本地调试身份

本地默认开启：

```env
DEV_AUTH_ENABLED="true"
DEV_DINGTALK_USER_ID="demo-super"
DINGTALK_MOCK_ENABLED="true"
```

上述开关仅用于本地开发。正式环境禁止开发身份与 mock，需设置独立随机 `AUTH_COOKIE_SECRET`（至少 32 字节），并在正式构建时提供 `NEXT_PUBLIC_DINGTALK_CORP_ID`。

正式部署使用服务器 Linux 依赖重新构建，保留共享数据库配置与私有 `UPLOAD_DIR`。`public/uploads` 不得放置真实附件或指向旧附件库的软链；新旧附件 URL 均由带权限校验的路由处理。先备份、检查数据库实际结构，再依次应用 AI 助手、继续建议、分类抄送、人员同步增量 SQL；执行生产专用人员关联回填后验证候选服务，再切换 release。禁止用本地 seed 或 `db push` 覆盖生产。详见 [本次发布记录](DEPLOYMENT_2026-11-08_AI.md)。
