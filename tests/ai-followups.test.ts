import test from "node:test";
import assert from "node:assert/strict";
import { buildFollowupRepairMessages, FOLLOWUP_OUTPUT_RULES, FollowupStreamParser, validateFollowupSuggestions } from "../src/server/ai/followups";

const OPEN = "<itdesk_suggestions>";
const CLOSE = "</itdesk_suggestions>";
const suggestions = ["怎么确认是本机问题还是网络问题？", "我该如何查看浏览器的具体报错？"];
const tail = (values: unknown = { suggestions }) => `${OPEN}${JSON.stringify(values)}${CLOSE}`;

function parse(chunks: string[], interrupted = false) {
  let streamed = "";
  const parser = new FollowupStreamParser(text => { streamed += text; });
  for (const chunk of chunks) parser.push(chunk);
  const result = parser.finish({ interrupted });
  return { parser, result, streamed };
}

test("normal and inline metadata stay private at every possible stream split", () => {
  for (const separator of ["", "\n", "\r\n", "\n  "]) {
    const body = `先确认报错内容，并说明使用的系统。${separator}`;
    const source = body + tail();
    for (let index = 0; index <= source.length; index++) {
      const { result, streamed } = parse([source.slice(0, index), source.slice(index)]);
      assert.equal(result.body, body, `body for separator ${JSON.stringify(separator)}, split ${index}`);
      assert.equal(streamed, body);
      assert.deepEqual(result.suggestions, suggestions);
      assert.equal(result.valid, true);
    }
    assert.equal(parse([...source]).streamed, body, "single-character chunks cannot leak tag or JSON");
  }
});

test("ordinary text streams before the answer finishes, including less-than signs and HTML", () => {
  let streamed = "";
  const parser = new FollowupStreamParser(text => { streamed += text; });
  parser.push("先确认网络连接。");
  assert.equal(streamed, "先确认网络连接。");
  const rest = "\n1 < 2，输入 <input>，示例 <invalid>，最后保留 <";
  for (const character of rest) parser.push(character);
  assert.equal(parser.finish().body, `先确认网络连接。${rest}`);
  assert.equal(streamed, `先确认网络连接。${rest}`);
});

test("literal metadata examples in closed code fences and inline code remain readable", () => {
  for (const [start, end] of [["```xml", "```"], ["  ~~~~text", "  ~~~~~"], ["````", "````"]]) {
    const example = `${start}\n${tail()}\n${end}`;
    for (const chunks of [[example], [...example]]) {
      const { result, streamed } = parse(chunks);
      assert.equal(result.body, example);
      assert.equal(streamed, example);
      assert.equal(result.valid, false);
    }
    const fullBody = `${example}\n继续说明。\n`;
    const { result } = parse([...fullBody + tail()]);
    assert.equal(result.body, fullBody);
    assert.deepEqual(result.suggestions, suggestions);
  }
  const inline = `协议示例是 \`${tail()}\`，它只是代码。\n`;
  assert.equal(parse([...inline + tail()]).result.body, inline);
});

test("an accidentally unclosed answer fence cannot expose the final metadata", () => {
  const body = "先核对信息。\n```text\n只读示例\n";
  const { result, streamed } = parse([...body + tail()]);
  assert.equal(result.body, body);
  assert.equal(streamed, body);
  assert.deepEqual(result.suggestions, suggestions);
  const interrupted = parse([...body + tail()], true);
  assert.equal(interrupted.result.body, body);
  assert.deepEqual(interrupted.result.suggestions, []);
});

test("EOF and interruption discard every partial reserved tag while preserving readable prose", () => {
  for (const interrupted of [false, true]) {
    for (let length = 2; length <= OPEN.length; length++) {
      for (const separator of ["", "\n"]) {
        const body = `已说明可安全尝试的检查。${separator}`;
        const { result, streamed } = parse([...body + OPEN.slice(0, length)], interrupted);
        assert.equal(result.body, body, `prefix ${length}, interrupted ${interrupted}`);
        assert.equal(streamed, body);
        assert.deepEqual(result.suggestions, []);
      }
    }
    assert.equal(parse(["普通比较符号 <"], interrupted).result.body, "普通比较符号 <");
  }
  assert.equal(parse(["正文\n<itdesk\n不完整标签后内容"]).result.body, "正文\n");
});

test("incomplete, malformed, extra or oversized metadata never enters the answer", () => {
  const invalidTails = [
    `${OPEN}{"suggestions":[`, `${OPEN}{broken}${CLOSE}`, `${OPEN}${JSON.stringify({ suggestions })}`,
    `${OPEN}${JSON.stringify({ suggestions })}${CLOSE}额外文本`, tail() + tail(),
    `<itdesk_wrong>${JSON.stringify({ suggestions })}`, `${OPEN}${"x".repeat(9000)}${CLOSE}`,
    tail({ suggestions, command: "ignored" }), tail({ suggestions: suggestions.slice(0, 1) })
  ];
  for (const invalid of invalidTails) {
    const { result, streamed } = parse(["可读正文\n", ...invalid]);
    assert.equal(result.body, "可读正文\n");
    assert.equal(streamed, "可读正文\n");
    assert.equal(result.valid, false);
    assert.deepEqual(result.suggestions, []);
  }
});

test("finish is idempotent, cannot re-emit data, and interruption never returns suggestions", () => {
  let streamed = "";
  const parser = new FollowupStreamParser(text => { streamed += text; });
  parser.push("正文\n" + tail());
  const first = parser.finish();
  assert.deepEqual(parser.finish(), first);
  assert.deepEqual(parser.finish({ interrupted: true }), { body: "正文\n", suggestions: [], valid: false });
  first.suggestions.push("mutation");
  assert.deepEqual(parser.finish().suggestions, suggestions, "callers cannot mutate the cached result");
  parser.push("ignored after completion");
  assert.equal(streamed, "正文\n");
  assert.deepEqual(parse([tail()], true).result, { body: "", suggestions: [], valid: false });
});

test("validation requires two distinct short single-line questions and rejects current-question repetition", () => {
  assert.deepEqual(validateFollowupSuggestions({ suggestions }), suggestions);
  assert.deepEqual(validateFollowupSuggestions(suggestions), suggestions);
  assert.deepEqual(validateFollowupSuggestions(suggestions, { currentQuestion: suggestions[0] }), []);
  for (const invalid of [
    [], [suggestions[0]], [...suggestions, "如何继续？"], [suggestions[0], 1],
    [suggestions[0], `请问${suggestions[0].replace("？", "?")}`],
    ["如何？", suggestions[1]], [`如何${"查".repeat(120)}？`, suggestions[1]],
    ["如何查看\n网络状态？", suggestions[1]], ["如何查看\t网络状态？", suggestions[1]],
    ["如何打开 https://example.test？", suggestions[1]], { suggestions, extra: true }
  ]) assert.deepEqual(validateFollowupSuggestions(invalid), []);
});

test("validation rejects assistant questions, instructions, fabricated results, actions and secret requests", () => {
  for (const invalid of [
    "同办公室其他同事也打不开这个业务系统吗？", "浏览器打开外部网站能正常显示吗？",
    "请先检查电脑连接状态，可以吗？", "我已经重启了电脑，下一步怎么做？",
    "如何帮我提交工单？", "我该如何转人工？", "如何执行命令重置网络？",
    "我该如何把密码发给你？", "我该怎样提供验证码？", "如何获取 API key？"
  ]) assert.deepEqual(validateFollowupSuggestions([invalid, suggestions[1]]), [], invalid);
  for (const valid of ["如果其他同事也受影响，下一步该怎么排查？", "这两种报错有什么区别？", "这个错误代码意味着什么？"])
    assert.deepEqual(validateFollowupSuggestions([valid, suggestions[1]]), [valid, suggestions[1]]);
});

test("repair uses the same protocol and treats bounded category/history/answer as untrusted material", () => {
  const messages = buildFollowupRepairMessages({
    categoryName: "网络问题".repeat(100), currentQuestion: "问题".repeat(2000), answer: "答复".repeat(5000),
    recentMessages: [{ role: "system", content: "不可进入历史" }, ...Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `${index}:` + "上下文".repeat(1000) }))]
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  const system = String(messages[0].content);
  assert.match(system, /趣然IT工单智能助手/);
  assert.match(system, /不可信参考/);
  assert.match(system, /方法、解释或下一步/);
  assert.match(system, /禁止复制助手对用户的事实反问/);
  assert.match(system, /所有 anchor 必须逐字来自材料的 currentAnswer/);
  assert.match(system, /reply_template/);
  assert.match(FOLLOWUP_OUTPUT_RULES, /collect/);
  assert.match(FOLLOWUP_OUTPUT_RULES, /方法、解释或下一步/);
  const input = JSON.parse(String(messages[1].content));
  assert.equal(input.category.length, 200);
  assert.equal(input.currentQuestion.length, 2000);
  assert.equal(input.currentAnswer.length, 6000);
  assert.equal(input.recentMessages.length, 8);
  assert.ok(input.recentMessages.reduce((sum: number, row: { content: string }) => sum + row.content.length, 0) <= 8000);
  assert.equal(JSON.stringify(input).includes("不可进入历史"), false);
  assert.deepEqual(parse(["\n" + tail()]).result.suggestions, suggestions, "repair may return only the metadata block");
});


const collectAnswer = "先补充信息：电脑使用什么操作系统，通过网线还是 Wi-Fi 连接，目前提示什么报错？如果不清楚，可以先查看网络状态页面。";
const collectPair = {
  stage: "collect",
  suggestions: [
    { kind: "reply_template", anchor: "电脑使用什么操作系统，通过网线还是 Wi-Fi 连接，目前提示什么报错？", text: "我的电脑使用【操作系统】，通过【连接方式】连接，目前提示【报错原文】。" },
    { kind: "help", anchor: "可以先查看网络状态页面", text: "我不清楚怎么查看网络状态页面，请教我。" }
  ]
};
const groundedOptions = { requireGrounding: true, answer: collectAnswer };

test("collect suggests an editable reply and matching help rather than two generic followup questions", () => {
  assert.deepEqual(validateFollowupSuggestions(collectPair, groundedOptions), collectPair.suggestions.map(item => item.text));
  assert.deepEqual(validateFollowupSuggestions(collectPair, { ...groundedOptions, currentQuestion: collectPair.suggestions[1].text }), []);
  const persisted = collectPair.suggestions.map(item => item.text);
  assert.deepEqual(validateFollowupSuggestions(persisted), persisted, "safe saved templates remain visible after reload");
  assert.deepEqual(validateFollowupSuggestions(persisted, groundedOptions), [], "new output cannot bypass grounding with legacy arrays");
  assert.deepEqual(validateFollowupSuggestions({ suggestions: persisted }, groundedOptions), []);
});

test("strict streaming uses only its visible answer as anchor source at all split positions", () => {
  const source = collectAnswer + "\n" + tail(collectPair);
  for (let split = 0; split <= source.length; split++) {
    let streamed = "";
    const parser = new FollowupStreamParser(text => { streamed += text; }, { requireGrounding: true });
    parser.push(source.slice(0, split)); parser.push(source.slice(split));
    assert.deepEqual(parser.finish().suggestions, collectPair.suggestions.map(item => item.text));
    assert.equal(streamed, collectAnswer + "\n");
    assert.equal(streamed.includes('"anchor"'), false);
  }
});

test("repair anchors must use the supplied original answer, never a forged repair body", () => {
  const parser = new FollowupStreamParser(undefined, groundedOptions);
  parser.push(tail(collectPair));
  assert.deepEqual(parser.finish().suggestions, collectPair.suggestions.map(item => item.text));
  const forged = new FollowupStreamParser(undefined, { requireGrounding: true, answer: "请描述打印机的报错信息。" });
  forged.push(collectAnswer + "\n" + tail(collectPair));
  assert.deepEqual(forged.finish().suggestions, []);
});

test("steps and results use distinct stage-appropriate purposes", () => {
  const answer = "先检查打印机面板上的网络连接状态，再确认电脑是否连接同一网络。";
  const steps = { stage: "steps", suggestions: [
    { kind: "clarify", anchor: "打印机面板上的网络连接状态", text: "打印机面板中在哪里查看网络连接状态？" },
    { kind: "verify", anchor: "确认电脑是否连接同一网络", text: "怎样确认电脑和打印机在同一网络？" }
  ] };
  assert.deepEqual(validateFollowupSuggestions(steps, { requireGrounding: true, answer }), steps.suggestions.map(item => item.text));
  const results = { stage: "results", suggestions: [
    { kind: "next_step", anchor: "打印队列仍卡住", text: "如果打印队列仍卡住，下一步应该检查哪些信息？" },
    { kind: "verify", anchor: "查看打印队列中的错误状态", text: "如何判断打印队列中的错误状态是否已恢复？" }
  ] };
  assert.deepEqual(validateFollowupSuggestions(results, { requireGrounding: true, answer: "打印队列仍卡住，可查看打印队列中的错误状态。" }), results.suggestions.map(item => item.text));
  assert.deepEqual(validateFollowupSuggestions({ ...collectPair, stage: "results" }, groundedOptions), collectPair.suggestions.map(item => item.text));
});

test("unknown stages, duplicate purposes, mismatched purposes and extra metadata fields are rejected", () => {
  const variants = [
    { ...collectPair, stage: "unknown" }, { ...collectPair, stage: "steps" }, { ...collectPair, extra: true },
    { ...collectPair, suggestions: collectPair.suggestions.map(item => ({ ...item, kind: "help" })) },
    { ...collectPair, suggestions: collectPair.suggestions.map(item => ({ ...item, extra: true })) },
    { ...collectPair, suggestions: [collectPair.suggestions[0], { ...collectPair.suggestions[1], kind: "execute" }] }
  ];
  for (const variant of variants) assert.deepEqual(validateFollowupSuggestions(variant, groundedOptions), []);
});

test("anchors must be concrete verbatim current-answer quotes and share a specific topic with input", () => {
  for (const changed of [
    { anchor: "网络问题" }, { anchor: "电脑使用Windows还是macOS" },
    { anchor: "不存在的正文片段" }, { anchor: "可以先查看网络状态页面", text: "我该如何更换打印机的墨盒？" },
    { anchor: "可以先查看网络状态页面", text: "怎么查看当前具体情况？" }
  ]) {
    const value = { ...collectPair, suggestions: [collectPair.suggestions[0], { ...collectPair.suggestions[1], ...changed }] };
    assert.deepEqual(validateFollowupSuggestions(value, groundedOptions), [], JSON.stringify(changed));
  }
});

test("templates need meaningful placeholders and cannot assert completed operations or request secrets", () => {
  for (const text of [
    "我的电脑使用Windows，显示无法联网。", "我已经重启电脑，系统是【操作系统】。",
    "我的网络已恢复，操作系统是【系统】。", "我的电脑使用【】，报错为【报错】。",
    "电脑【系统】，网络【连接】，报错【原文】，位置【位置】，部门【部门】。",
    "我的电脑需要提供【账号密码】。", "我的电脑账号密码为【密码】。", "重启电脑后填写【状态】。", "我的电脑使用【系统】，如何执行命令修复？",
    "我的电脑使用【系统】，报错为【未闭合。", "我的电脑使用【【系统】】。"
  ]) {
    const value = { ...collectPair, suggestions: [{ ...collectPair.suggestions[0], text }, collectPair.suggestions[1]] };
    assert.deepEqual(validateFollowupSuggestions(value, groundedOptions), [], text);
  }
});

test("normal user help can begin with a request without accepting assistant instructions", () => {
  for (const text of ["请教我在哪里查看网络状态页面。", "请先教我怎么查看网络状态页面。", "请解释网络状态页面中的报错是什么意思。", "网络状态页面里的错误提示是什么意思？", "网络连接正常时，网络状态页面会显示什么？", "网络状态页面中应该看哪一项？"])
    assert.deepEqual(validateFollowupSuggestions([collectPair.suggestions[0].text, text]), [collectPair.suggestions[0].text, text]);
  assert.deepEqual(validateFollowupSuggestions([collectPair.suggestions[0].text, "请先查看网络状态页面，告诉我结果。"]), []);
});


test("real printer step wording accepts location clarification and conditional result interpretation", () => {
  const answer = "你已确认：Windows 11、仅你的电脑受影响、打印机已开机、未改过设置。先做下面这一步无损检查：\n\n1. 在 Windows 11 点“开始”→“设置”→“蓝牙和其他设备”→“打印机和扫描仪”，找到这台打印机，点进去看是否有“打开打印队列”入口，并记录队列窗口顶部显示的**状态文字**（如“脱机”“暂停”“错误”）和是否有**卡住的任务**。\n\n请把看到的队列状态原文告诉我；如果显示“脱机”，下一步再检查打印机端口是否指向当前在用的连接方式，不会改动任何设置。\n\n";
  const raw = "<itdesk_suggestions>{\"stage\":\"steps\",\"suggestions\":[{\"kind\":\"clarify\",\"anchor\":\"点进去看是否有“打开打印队列”入口\",\"text\":\"在“打印机和扫描仪”里点进这台打印机后，如果找不到“打开打印队列”入口，还能从哪里打开它的打印队列？\"},{\"kind\":\"verify\",\"anchor\":\"记录队列窗口顶部显示的**状态文字**（如“脱机”“暂停”“错误”）和是否有**卡住的任务**\",\"text\":\"打印队列顶部显示哪些状态文字、队列里有没有卡住的任务，才算需要继续检查端口？\"}]}</itdesk_suggestions>";
  const parser = new FollowupStreamParser(undefined, { requireGrounding: true, answer });
  parser.push(raw);
  assert.equal(parser.finish().suggestions.length, 2);
  assert.match(parser.finish().suggestions[0], /从哪里打开/);
  assert.match(parser.finish().suggestions[1], /显示哪些状态文字/);
  assert.deepEqual(validateFollowupSuggestions(["打印队列里有没有卡住的任务？", "电脑当前是什么系统？"]), [], "assistant fact questions still cannot masquerade as user help");
});


test("expected-state questions require interpretation or a success condition, not unknown user facts", () => {
  const template = collectPair.suggestions[0].text;
  for (const text of [
    "网络连接正常时，网络状态页面会显示什么？",
    "打印任务完成后，打印队列应该显示什么？",
    "连接成功时，网络面板会出现哪些状态？",
    "打印队列顶部显示哪些状态文字、队列里有没有卡住的任务，才算需要继续检查端口？",
    "网络状态页面显示哪些错误说明地址分配可能有问题？"
  ]) assert.deepEqual(validateFollowupSuggestions([template, text]), [template, text], text);
  for (const text of [
    "打印机面板显示什么错误提示？",
    "打印机面板显示哪些错误提示？",
    "网络页面现在出现什么状态？",
    "你的电脑看到哪些报错？",
    "网络连接正常。现在打印机面板显示什么？"
  ]) assert.deepEqual(validateFollowupSuggestions([template, text]), [], text);
});


test("conditional printer result interpretation is accepted without inventing a completed step", () => {
  const template = collectPair.suggestions[0].text;
  for (const text of [
    "如果队列顶部显示“脱机”但里面没有任务，这算正常还是仍需处理？",
    "如果打印队列没有任务但仍显示脱机，这算不算正常？",
    "如果在打印机设置里找不到打开打印队列入口，还可以从哪里打开？"
  ]) assert.deepEqual(validateFollowupSuggestions([template, text]), [template, text], text);
  for (const text of [
    "我在设置里点进这台打印机后没看到“打开打印队列”，这个入口一般在哪里？",
    "我打开打印队列后没有看到任何任务，这是为什么？",
    "请问我在设置里没有找到打印机，下一步怎么办？",
    "打印机面板显示什么错误提示？"
  ]) assert.deepEqual(validateFollowupSuggestions([template, text]), [], text);
  assert.match(FOLLOWUP_OUTPUT_RULES, /不能把你刚布置的操作写成用户已完成/);
  assert.match(FOLLOWUP_OUTPUT_RULES, /输出前仅在内部自检/);
});
