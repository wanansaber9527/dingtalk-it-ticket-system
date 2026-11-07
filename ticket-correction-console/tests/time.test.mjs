import test from "node:test";
import assert from "node:assert/strict";
import {
  parseShanghaiDateTime,
  toShanghaiInputValue
} from "../lib/time.js";

test("北京时间输入按 UTC+8 解析", () => {
  const date = parseShanghaiDateTime("2026-07-29T18:30:45.123");
  assert.equal(date.toISOString(), "2026-07-29T10:30:45.123Z");
});

test("时间输入值保留毫秒，避免无修改时丢失精度", () => {
  assert.equal(
    toShanghaiInputValue("2026-07-29T10:30:45.123Z"),
    "2026-07-29T18:30:45.123"
  );
});

test("空时间返回 null", () => {
  assert.equal(parseShanghaiDateTime(""), null);
  assert.equal(parseShanghaiDateTime(null), null);
});

test("拒绝 JavaScript 会自动归一化的无效日历日期", () => {
  for (const value of [
    "2026-02-30T10:00",
    "2025-02-29T10:00",
    "2026-04-31T10:00",
    "2026-01-01T24:00",
    "2026-01-01T23:60",
    "2026-01-01T23:59:60"
  ]) {
    assert.throws(() => parseShanghaiDateTime(value), /时间格式无效/, value);
  }
});

test("接受真实存在的闰日", () => {
  assert.equal(
    parseShanghaiDateTime("2024-02-29T10:00").toISOString(),
    "2024-02-29T02:00:00.000Z"
  );
});
