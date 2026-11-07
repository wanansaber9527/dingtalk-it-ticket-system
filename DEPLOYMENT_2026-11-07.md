# 2026-11-07 正式发布记录

新版主工单系统于 **2026-11-07 21:13（北京时间）**完成正式发布及收尾检查。

- 正式入口：<https://it.qurands.com:38443/tickets/new>，在钉钉中打开。
- 发布版本：`20261107-210238-fluent-v2`。
- 当前目录：`/www/wwwroot/it.qurands.com/current`。
- 当前软链目标：`/www/wwwroot/it.qurands.com/releases/20261107-210238-fluent-v2`。
- PM2：`dingtalk-it-ticket`，状态 `online`，运行配置已保存。
- 预检进程已移除；主服务仅监听原来的 `127.0.0.1:3000`。

本次上线包含代码审查修复、Fluent v2 布局、当前用户头像与移动端适配。正式构建关闭了开发身份、模拟钉钉和本地身份切换入口。真实钉钉接口可读取用户详情和头像；旧版登录 Cookie 会失效，需在钉钉内重新免登。

## 备份与数据

服务器备份目录：

`/www/wwwroot/it.qurands.com/backups/release-20261107-210238-fluent-v2/`

其中保留旧版代码及构建、共享配置和附件、完整数据库备份、原 PM2 配置、部署脚本及验证记录。归档哈希和数据库 gzip 校验通过。原发布目录 `20260530161451` 继续保留。

线上代码与本轮修改前的本地源码基线一致，未发现遗漏的线上专有修复；数据库 schema 一致。本次没有执行 `db push`、`db:seed` 或其他数据库结构迁移。

53 张历史图片复制到 `shared/private-uploads`，逐一核对 SHA-256；旧文件未删除。旧目录中的 `.gitkeep` 和一份未被工单或日志引用的历史 docx 保留原处，没有作为图片迁移。新 release 的 `public/uploads` 不包含实际文件或软链。

## 验证结果

- 服务器正式生产构建通过。
- 候选服务与切换后的主服务分别通过 33 项检查。
- 从客户端经过正式 HTTPS 域名的 18 项检查通过，包含会话、员工后台权限、开发入口关闭、页面样式、历史附件鉴权、图片哈希和私有缓存策略。
- 钉钉 token 与用户详情读取通过，返回真实头像；没有发送测试通知。
- 针对 HTTPS 代理的附件兼容修复通过 18 项相关测试、ESLint、TypeScript 和真实本地 Next 请求验证。
- 发布后检查窗口内，主服务错误日志新增 0 字节。

正式域名初次检查发现旧 `/uploads/*` 中间件内部 HTTPS 重写不兼容，已先回退原服务，再修复为直接复用鉴权 GET 的独立路由。重新构建后，真实 HTTPS 检查全部通过，再次切换成功。

验收未创建模拟生产工单，未调用通知/cron 投递接口。看板读取会按原业务规则刷新活动工单 SLA 标记。真实钉钉客户端的完整免登及生产提单/通知流转未做人工操作验收；本地完整流程回归及服务器接口验证记录应分开理解。

独立更正台没有活跃的线上 PM2 进程，本次没有新启用或发布该独立服务。

## 服务器回退

如需恢复发布前的线上版本，可执行已准备的回退脚本：

```sh
ssh -i "$HOME/.ssh/codex_itdesk_deploy" -p 31022 itdesk@rd.qurands.com \
  'node /www/wwwroot/it.qurands.com/backups/release-20261107-210238-fluent-v2/switch-release.cjs /www/wwwroot/it.qurands.com/backups/release-20261107-210238-fluent-v2/context.json --rollback && pm2 save'
```

脚本先核对当前发布版本，将新版期间新增的图片安全复制至旧版可读目录，再切回旧 release 并重启主进程。不会恢复数据库旧快照或抹掉发布后的业务数据。回退机制已在本次代理兼容修复过程中实际执行成功。

本地界面 v1 回退是另一套操作，见 [UI 回退说明](UI_LAYOUT_V2.md)，不要将其当作服务器发布回退。

本地脱敏验证明细位于 `output/deployment-2026-11-07/`，主要文件为 `final-status.json`、`live-verification.json`、`public-verification.json`、`integration-verification.json` 和 `build.log`。凭据和数据库备份仅保存在服务器受限目录，未下载到这些交付记录中。
