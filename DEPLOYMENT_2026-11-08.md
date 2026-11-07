# 2026-11-08 顶栏与快捷筛选发布记录

新版已于 **2026-11-08 02:37（北京时间）**完成正式发布。主服务 online，PM2 配置已保存，临时验证服务已移除。

正式入口：<https://it.qurands.com:38443/tickets/new>，在钉钉内刷新页面即可使用。

构建 ID：`frYz7aGwn9sUr_PS_72ub`。

## 修改内容

- 顶栏系统名称保持单行，替换原有 IT 图标为简洁工单标识，导航改为细线选中样式，调整品牌、导航、头像区间距。
- 管理端与员工端长姓名、部门名称限制宽度并省略，悬停可查看完整文字；原角色权限、导航目的地和头像读取保持不变。
- 处理工作台的待处理、待补充、已超时改为可点击且可取消的筛选按钮。
- 待处理包含待受理、已分派、处理中；与待补充互斥。已超时可叠加，保留原有首响/处理超时口径。
- 服务端全量筛选，数字按有权限查看的工单和已提交的关键词统计，不受当前页或选中状态影响。筛选变化回到第一页。
- 同一搜索范围切换保留统计数字；搜索范围变化、请求失败时隐藏旧数字，取消过期请求，避免显示旧结果。
- 手机端三个按钮等宽并列；支持键盘操作、焦点提示及 aria-pressed 选中状态。

## 已完成的本地验证

- `npm run test:local`：73 项全部通过，包含真实隔离数据库与 HTTP 回归。
- `npm run lint`、`npm run typecheck`、隔离生产构建通过。
- 浏览器实测点击/再次点击、互斥、超时叠加、关键词保留、零结果恢复。
- 顶栏在 320、375、640、1000、1024、1280、1440 像素宽度检查无横向溢出。手机按钮在 320 与 375 像素等宽并列。
- 独立代理复核权限、旧接口数组兼容、统计范围、请求竞态，18 项相关测试通过。
- 热更新期间改动 hook 依赖数量曾触发开发期提示；完整刷新后继续验证，正式构建通过。

截图：`output/local-verification/header-filters-20261108/desktop.jpg` 和 `mobile.jpg`。

## 版本与备份

发布版本：`20261108-023106-header-filters`。

上一个版本：`20261107-210238-fluent-v2`，保留供回退。

服务器备份：`/www/wwwroot/it.qurands.com/backups/release-20261108-023106-header-filters/`，包含发布前代码/构建、shared 配置及私有附件、数据库和 PM2 运行信息。源码/shared 归档及数据库 gzip 校验通过。

新版本原样复用上一版 `.env` 和私有附件目录，不更新数据库结构、不轮换认证密钥、不迁移附件。没有创建生产测试工单或发送测试通知。

本地修改前备份：`.codex-snapshots/before-header-polish-20261108-022346/`。

## 回退

以下命令将当前版本切回 11 月 7 日版本，并保存 PM2 状态。不会恢复旧数据库快照或清除上线后新增业务数据，附件继续使用同一个私有目录。

```sh
ssh -i "$HOME/.ssh/codex_itdesk_deploy" -o IdentitiesOnly=yes -p 31022 itdesk@rd.qurands.com \
  'node /www/wwwroot/it.qurands.com/backups/release-20261108-023106-header-filters/switch-release.cjs /www/wwwroot/it.qurands.com/backups/release-20261108-023106-header-filters/context.json --rollback && pm2 save'
```

脱敏发布报告位于 `output/deployment-2026-11-08/`。数据库备份与凭据仅保留在服务器受限目录。

## 正式环境验证结果

- 服务器生产构建通过；候选版本与切换后的正式版本各通过 46 项检查。
- 正式 HTTPS 域名的 18 项检查通过，新顶栏样式、鉴权、权限和历史附件兼容正常。
- 发布后检查窗口内主服务错误日志新增 0 字节。
- 当前生产缺少独立非超管处理人账号，线上筛选验证使用现有管理员；非超管处理人权限边界已在本地测试覆盖，未在生产创建或改变账号角色。
- 没有人工执行真实钉钉客户端的完整登录与生产提单流程；服务器接口验收没有创建生产测试工单或调用通知接口。看板/列表 GET 按原业务规则刷新到期的 SLA 标记。

完整结果见同目录下的 `final-status.json`、`candidate-verification.json`、`live-verification.json` 与 `public-verification.json`。本次没有实际执行回退。
