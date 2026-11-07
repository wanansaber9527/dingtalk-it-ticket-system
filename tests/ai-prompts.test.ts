import test from "node:test";
import assert from "node:assert/strict";
import { AI_ASSISTANT_NAME } from "../src/lib/ai";
import { buildSystemPrompt, categoryDefaults, DEFAULT_SYSTEM_PROMPT, FIXED_SYSTEM_PROMPT } from "../src/server/ai/prompts";

test("all deployed issue categories select detailed, distinct troubleshooting protocols", () => {
  const cases = [
    ["电脑故障", "电脑与硬件故障"],
    ["网络问题", "网络连接与访问"],
    ["系统账号", "系统账号与权限"],
    ["软件安装", "软件安装、升级与卸载"],
    ["打印设备", "打印、扫描与复印设备"],
    ["数据报表", "数据报表与数据核对"],
    ["业务系统", "办公软件与业务系统运行"],
    ["其他 IT 支持", "其他 IT 问题与分类确认"]
  ];
  const prompts = new Set<string>();
  for (const [name, responsibility] of cases) {
    const config = categoryDefaults(name);
    assert.ok(config.prompt.startsWith(`【职责｜${responsibility}】`), `${name} did not use its own protocol`);
    assert.ok(config.prompt.length >= 800 && config.prompt.length <= 1500, `${name}: ${config.prompt.length} characters`);
    assert.match(config.prompt, /【必要信息】/);
    assert.match(config.prompt, /【按现象分支】/);
    assert.match(config.prompt, /【图片和历史】/);
    assert.match(config.prompt, /【报修信息重点】/);
    assert.match(config.prompt, /每轮最多给 1—3 个/);
    assert.ok(config.examples.length >= 3 && config.examples.every(example => example.length > 0 && example.length <= 200));
    prompts.add(config.prompt);
  }
  assert.equal(prompts.size, cases.length);
});

test("overlapping category names prioritize the actual problem over generic system and hardware words", () => {
  const cases = [
    ["ERP 系统账号", "系统账号与权限"],
    ["网络账号权限", "系统账号与权限"],
    ["数据报表访问权限", "系统账号与权限"],
    ["网络打印机", "打印、扫描与复印设备"],
    ["打印机驱动安装", "打印、扫描与复印设备"],
    ["业务系统数据报表", "数据报表与数据核对"],
    ["数据恢复", "数据报表与数据核对"],
    ["电脑软件安装", "软件安装、升级与卸载"],
    ["业务客户端升级", "软件安装、升级与卸载"],
    ["网络设备升级", "网络连接与访问"],
    ["设备管理系统", "办公软件与业务系统运行"],
    ["电脑硬件", "电脑与硬件故障"],
    ["Software Installation", "软件安装、升级与卸载"],
    ["Wi-Fi Network", "网络连接与访问"]
  ];
  for (const [name, responsibility] of cases) assert.ok(categoryDefaults(name).prompt.startsWith(`【职责｜${responsibility}】`), name);
});

test("network instructions require multiple observations and do not diagnose DNS from a public IP or ping result", () => {
  const prompt = categoryDefaults("网络问题").prompt;
  assert.match(prompt, /直连公共IP成功或失败、单次ping通或不通，都不能直接断言DNS故障/);
  assert.match(prompt, /名称解析、目标服务与访问路径多项证据/);
  assert.match(prompt, /ICMP限制、HTTPS证书、虚拟主机和访问策略/);
  assert.match(prompt, /不猜测网关、DNS、代理、VPN地址/);
  assert.match(prompt, /命令或界面路径必须在确认操作系统、版本和用户权限后给出/);
});

test("data, installation and account protocols preserve their distinct high-impact boundaries", () => {
  const data = categoryDefaults("数据报表").prompt;
  for (const evidence of ["统计日期范围", "时区", "去重规则", "禁止直接重复提交", "不指导直接执行数据库更新", "不要求整份"]) assert.ok(data.includes(evidence), evidence);
  const install = categoryDefaults("软件安装").prompt;
  for (const evidence of ["处理器架构", "不编造下载地址", "不能指导关闭防护", "安装成功当作软件已获公司许可", "管理员权限"]) assert.ok(install.includes(evidence), evidence);
  const account = categoryDefaults("系统账号").prompt;
  for (const evidence of ["不索取验证码", "不代替身份核验或审批", "不能证明应授予同样权限", "不编造审批人"]) assert.ok(account.includes(evidence), evidence);
});

test("custom category content cannot remove fixed identity, execution and ticket-success boundaries", () => {
  const built = buildSystemPrompt({ categoryName: "自定义分类", prompt: "自定义排查内容", environment: "" }, "自定义补充内容");
  assert.ok(built.startsWith(FIXED_SYSTEM_PROMPT));
  for (const boundary of [AI_ASSISTANT_NAME, "不能取消这些边界", "不可信内容", "不默认所有人使用 Windows", "不自行执行设备、脚本、数据库或业务操作", "没有可信服务端创建成功结果和真实编号", "不能虚构编号"]) assert.ok(built.includes(boundary), boundary);
  assert.match(built, /尚未提供企业专有信息/);
  assert.match(built, /自定义排查内容/);
  assert.match(built, /自定义补充内容/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /底层规则详细不等于回复冗长/);
});

test("editing example suggestions does not mutate the shared category defaults", () => {
  const first = categoryDefaults("网络问题");
  const before = [...first.examples];
  first.examples[0] = "changed by caller";
  first.examples.push("another edit");
  assert.deepEqual(categoryDefaults("网络问题").examples, before);
});
