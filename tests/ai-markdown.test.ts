import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody, safeMarkdownUrl } from "../components/ai/MarkdownBody";

const render = (content: string) => renderToStaticMarkup(createElement(MarkdownBody, { content }));

test("model troubleshooting prose renders bold and numbered steps instead of raw Markdown", () => {
  const html = render("请先做两个无损检查：\n\n1. **影响范围**：只有这台电脑不能上网？\n2. **具体表现**：网页报什么错？\n\n另外，请告诉我**安装的是什么软件、大概什么时候装的**。");
  assert.match(html, /<ol>/);
  assert.match(html, /<strong>影响范围<\/strong>/);
  assert.match(html, /<strong>安装的是什么软件、大概什么时候装的<\/strong>/);
  assert.equal(html.includes("**"), false);
});

test("headings, tables, quotations, code and task lists produce semantic rich text", () => {
  const html = render("## 排查记录\n\n> 先保存工作。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 网络 | 正常 |\n\n- [x] 检查连接\n\n运行 `ipconfig`：\n\n```text\nline <safe>\nsecond line\n```\n\n~~旧步骤~~");
  assert.match(html, /<h2>排查记录<\/h2>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /aria-label="表格，可横向滚动"/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre[^>]*><code class="language-text">line &lt;safe&gt;/);
  assert.match(html, /type="checkbox"[^>]*disabled/);
  assert.match(html, /<del>旧步骤<\/del>/);
});

test("untrusted model HTML and image URLs cannot execute or load tracking resources", () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://tracker.invalid/pixel" onerror="alert(1)">\n\n[危险](javascript:alert%281%29)\n\n![图片说明](https://tracker.invalid/pixel)\n\n**可见内容**');
  assert.doesNotMatch(html, /<script|<img|onerror=|javascript:|tracker\.invalid/);
  assert.match(html, /<strong>可见内容<\/strong>/);
  assert.match(html, /图片说明/);
});

test("links keep safe navigation semantics and reject executable or protocol-relative URLs", () => {
  const html = render('[帮助](https://example.com/help?q=network)');
  assert.match(html, /href="https:\/\/example.com\/help\?q=network"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "//evil.invalid", "\\evil.invalid", "java\nscript:alert(1)"]) assert.equal(safeMarkdownUrl(url), "");
  assert.equal(safeMarkdownUrl("/tickets/local-test"), "/tickets/local-test");
});

test("partial streaming Markdown remains renderable as it grows", () => {
  const answer = "1. **检查网络**\n\n```text\nnetwork status\n```\n\n| 项目 | 状态 |\n| --- | --- |\n| 网络 | 正常 |";
  for (let length = 1; length <= answer.length; length++) assert.equal(typeof render(answer.slice(0, length)), "string");
  assert.match(render(answer), /<strong>检查网络<\/strong>/);
});
