import test from "node:test";
import assert from "node:assert/strict";
import { Children, createElement, isValidElement, type ButtonHTMLAttributes, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowupSuggestions, appendFollowupSuggestion } from "../components/ai/FollowupSuggestions";

const suggestions = ["只有这台电脑受影响，我应该检查哪里？", "错误提示一直出现，可以继续排查吗？"];
const defaults = { role: "assistant", status: "COMPLETE", suggestions, disabled: false, onSelect: () => {} };

function buttonsOf(props: Parameters<typeof FollowupSuggestions>[0]) {
  const element = FollowupSuggestions(props);
  assert.ok(element);
  return Children.toArray(element.props.children).filter((node): node is ReactElement<ButtonHTMLAttributes<HTMLButtonElement>> => isValidElement(node) && node.type === "button");
}

test("suggestions only appear as a complete pair on each completed assistant reply", () => {
  for (const changed of [
    { role: "user" }, { role: "system" }, { status: "PENDING" }, { status: "FAILED" },
    { suggestions: undefined }, { suggestions: [] }, { suggestions: ["一条"] },
    { suggestions: ["一", "二", "三"] }, { suggestions: ["有效", "  "] }
  ]) assert.equal(FollowupSuggestions({ ...defaults, ...changed }), null);
  assert.equal(buttonsOf(defaults).length, 2);
  const older = renderToStaticMarkup(createElement(FollowupSuggestions, { ...defaults, suggestions: ["之前的问题一", "之前的问题二"] }));
  assert.match(older, /之前的问题一/);
  const current = renderToStaticMarkup(createElement(FollowupSuggestions, defaults));
  assert.match(current, /只有这台电脑/);
  assert.match(current, /type="button"/);
  assert.match(current, /你可以这样继续/);
  assert.doesNotMatch(current, /填写【…】后发送/);
});

test("a suggestion click appends editable text without a network request or form submission", (t) => {
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("Suggestion clicks must not send requests"); });
  let content = "我已重启过路由器。";
  let calls = 0;
  const buttons = buttonsOf({ ...defaults, onSelect: (value) => { calls++; content = appendFollowupSuggestion(content, value)!; } });
  assert.equal(buttons[0].props.type, "button");
  (buttons[0].props.onClick as () => void)();
  assert.equal(content, `我已重启过路由器。\n${suggestions[0]}`);
  assert.equal(calls, 1);
  assert.equal(network.mock.callCount(), 0);
});

test("busy suggestions cannot change the composer even if a stale click handler is invoked", () => {
  let calls = 0;
  const buttons = buttonsOf({ ...defaults, disabled: true, onSelect: () => { calls++; } });
  for (const button of buttons) {
    assert.equal(button.props.disabled, true);
    (button.props.onClick as () => void)();
  }
  assert.equal(calls, 0);
});

test("reply templates explain editable fields and fill them unchanged without sending", (t) => {
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("Templates must not auto-send"); });
  const template = "我的电脑使用【操作系统】，通过【网线／Wi-Fi】连接，目前提示【报错原文】。";
  const help = "我不清楚怎么确认连接方式和网络状态，请先教我查看。";
  let content = "现象补充：";
  const props = { ...defaults, suggestions: [template, help], onSelect: (value: string) => { content = appendFollowupSuggestion(content, value)!; } };
  const markup = renderToStaticMarkup(createElement(FollowupSuggestions, props));
  assert.match(markup, /你可以这样继续/);
  assert.match(markup, /点击填入 · 填写【…】后发送/);
  const buttons = buttonsOf(props);
  assert.match(buttons[0].props["aria-label"]!, /请填写【…】中的内容后再发送/);
  assert.match(buttons[0].props.title!, /填写【…】后自行发送/);
  assert.equal(buttons[1].props.title, "填入输入框，不会自动发送");
  assert.equal(buttons[0].props.type, "button");
  (buttons[0].props.onClick as () => void)();
  assert.equal(content, `现象补充：\n${template}`);
  assert.equal(network.mock.callCount(), 0);
});

test("append keeps the original text intact and refuses overflow instead of truncating it", () => {
  assert.equal(appendFollowupSuggestion("", "  新问题  "), "新问题");
  assert.equal(appendFollowupSuggestion("  原问题  ", "新问题"), "  原问题  \n新问题");
  assert.equal(appendFollowupSuggestion("原问题\n", "新问题"), "原问题\n新问题");
  assert.equal(appendFollowupSuggestion("原问题", "  "), null);
  assert.equal(appendFollowupSuggestion("原".repeat(11998), "问")?.length, 12000);
  const original = "原".repeat(11999);
  assert.equal(appendFollowupSuggestion(original, "问"), null);
  assert.equal(original.length, 11999);
});
