import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword
} from "../lib/password.js";

test("scrypt 哈希可以校验正确密码并拒绝错误密码", async () => {
  const encoded = await hashPassword("correct-password", Buffer.alloc(16, 7));
  assert.equal(await verifyPassword("correct-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});

test("密码按 UTF-8 原样比较，不自动 trim 或规范化", async () => {
  const encoded = await hashPassword("pass。", Buffer.alloc(16, 9));
  assert.equal(await verifyPassword("pass。", encoded), true);
  assert.equal(await verifyPassword("pass.", encoded), false);
  assert.equal(await verifyPassword("pass。 ", encoded), false);
});

test("畸形哈希被安全拒绝", async () => {
  assert.equal(await verifyPassword("anything", "not-a-valid-hash"), false);
});
