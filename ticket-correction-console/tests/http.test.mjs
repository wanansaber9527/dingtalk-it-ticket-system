import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../lib/http.js";

test("缺少 Content-Length 的分块请求仍执行实际字节上限", async () => {
  const request = new Request("http://localhost/test", {
    method: "POST", body: JSON.stringify({ data: "超长内容".repeat(100) })
  });
  await assert.rejects(readJson(request, 32), (error) => error.code === "PAYLOAD_TOO_LARGE");
});

test("正常 JSON 可读取，无效 JSON 返回明确错误", async () => {
  assert.deepEqual(await readJson(new Request("http://localhost/test", {
    method: "POST", body: '{"value":"测试"}'
  })), { value: "测试" });
  await assert.rejects(readJson(new Request("http://localhost/test", {
    method: "POST", body: "invalid"
  })), (error) => error.code === "INVALID_JSON");
});
