# 钉钉IT工单系统

公司内部使用的 IT 工单管理系统，入口面向钉钉 H5/工作台。第一阶段默认使用 SQLite 和 Mock 钉钉/AI 表格调用，可本地快速运行；真实钉钉 OpenAPI 路径、AI 表格 BaseId/TableId 和字段映射均集中配置。

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
        ├── dingtalk                # DingTalkClient、DingTalkAiTableClient、字段映射
        └── services                # 工单、分类、通知、知识库、看板、用户服务
```

## 技术栈

- Next.js App Router / React / TypeScript
- Ant Design
- Prisma ORM
- SQLite 默认本地运行，后续可切换 MySQL/PostgreSQL

## 核心能力

- 钉钉用户识别：`src/server/services/dingtalkAuthService.ts`
- 员工提交工单、我的工单、详情、补充说明、确认、退回、评价
- 管理员看板、工单管理、分派、转交、处理、关闭、重新同步 AI 表格
- 分类配置、默认处理人、SLA 时限
- 钉钉工作通知封装和通知记录
- AI 表格同步封装、失败日志、单条/批量重试
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
- `AiTableSyncLog`
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
- `POST /api/admin/tickets/:id/sync-ai-table`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/:id`
- `GET /api/admin/knowledge-base`
- `POST /api/admin/knowledge-base`
- `PUT /api/admin/knowledge-base/:id`
- `GET /api/admin/notifications`
- `POST /api/admin/notifications/:id/resend`
- `GET /api/admin/ai-sync-logs`
- `POST /api/admin/ai-sync-logs`
- `POST /api/admin/ai-sync-logs/:id/retry`
- `GET /api/admin/users`
- `PUT /api/admin/users/:id/role`

钉钉：

- `GET /api/dingtalk/auth`
- `POST /api/dingtalk/callback`
- `POST /api/dingtalk/notify-test`

## 钉钉与 AI 表格封装

- 钉钉用户、access token、工作通知封装：`src/server/dingtalk/DingTalkClient.ts`
- AI 表格记录新增、更新、查询、同步与重试：`src/server/dingtalk/DingTalkAiTableClient.ts`
- AI 表格字段映射集中配置：`src/server/dingtalk/aiTableMappings.ts`

AI 表格接口路径没有硬编码。请在 `.env` 中补齐：

- `DINGTALK_AI_TABLE_API_BASE_URL`
- `DINGTALK_AI_TABLE_INSERT_RECORD_PATH`
- `DINGTALK_AI_TABLE_UPDATE_RECORD_PATH`
- `DINGTALK_AI_TABLE_LIST_RECORDS_PATH`

路径支持占位符：`{baseId}`、`{tableId}`、`{recordId}`。

## AI 表格字段映射

已集中映射以下 Sheet：

- IT工单主表：工单编号、标题、申请人、部门、分类、紧急程度、状态、处理人、SLA、描述、附件、结果、满意度等
- 工单流转日志表：工单编号、操作时间、操作人、操作类型、原状态、新状态、备注
- 工单分类配置表：分类名称、默认处理人、首响时限、完成时限、是否启用
- 知识库表：知识编号、标题、分类、适用部门、描述、步骤、来源工单、维护人、是否启用、更新时间
- 满意度评价表：工单编号、申请人、处理人、满意度、评价原因、评价时间

## 本地启动

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

如果本机 Prisma 没有自动创建 SQLite 文件，可先执行：

```bash
touch prisma/dev.db
npm run db:push
```

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
DINGTALK_AI_TABLE_MOCK_ENABLED="true"
```

真实接入时关闭 mock，并从钉钉免登入口进入系统。
