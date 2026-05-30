# 趣然工单系统

公司内部使用的 IT 工单管理系统，入口面向钉钉 H5/工作台。当前数据库使用 MySQL，钉钉 OpenAPI 路径保持集中配置，便于按官方文档补齐或调整。

## 当前版本说明

- 系统名称：趣然工单系统
- 核心定位：钉钉内使用的企业 IT 工单提交、分派、处理、通知与统计系统
- 当前版本已移除 AI 表格同步功能，不再展示 AI 同步日志入口和相关接口
- 首页看板支持「原样式」和「图形化样式」两种展示方式
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
npm install
npm run db:push
npm run db:seed
npm run dev
```

启动前请先在 `.env` 中配置可用的 MySQL `DATABASE_URL`。

打开：

- 员工端：`http://localhost:3000/tickets/new`
- 后台：`http://localhost:3000/admin`

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

真实接入时关闭 mock，并从钉钉免登入口进入系统。
