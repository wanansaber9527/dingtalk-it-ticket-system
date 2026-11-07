import test from "node:test";
import assert from "node:assert/strict";
import { DingTalkClient } from "../src/server/dingtalk/DingTalkClient";

test("department member pages reject truncated, repeated and malformed cursors", async () => {
  for (const response of [
    { list: [], has_more: true },
    { list: [], has_more: true, next_cursor: 1 },
    { has_more: false },
    { list: [], has_more: "false" }
  ]) {
    const client = new DingTalkClient() as any;
    client.fetchOapi = async () => response;
    await assert.rejects(client.listUsersByDepartment("fake", 1), /分页/);
  }
});

test("directory pagination reads all pages and rejects missing department lists", async () => {
  const client = new DingTalkClient() as any;
  let calls = 0;
  client.fetchOapi = async () => ++calls === 1 ? { list: [{ userid: "a", name: "A" }], has_more: true, next_cursor: 100 } : { list: [{ userid: "b", name: "B" }], has_more: false };
  assert.deepEqual((await client.listUsersByDepartment("fake", 1)).map((row: any) => row.userid), ["a", "b"]);
  client.fetchOapi = async () => ({});
  await assert.rejects(client.listDepartmentIds("fake"), /不完整/);
});

test("directory data retains union identity and omits unavailable department details", () => {
  const client = new DingTalkClient() as any;
  const result = client.toSelectableUserFromDirectory({ userid: "a", name: "A", unionid: "u-a", dept_id_list: [2] }, new Map());
  assert.equal(result.unionId, "u-a");
  assert.equal(result.departmentId, "2");
  assert.equal(result.departmentName, undefined);
  assert.equal(result.position, undefined);
});

test("departure reader uses read-only API, pagination, and rejects permission / cursor failures", async () => {
  const oldMock = process.env.DINGTALK_MOCK_ENABLED;
  const oldFetch = globalThis.fetch;
  process.env.DINGTALK_MOCK_ENABLED = "false";
  const start = new Date("2026-11-01T00:00:00Z");
  const end = new Date("2026-11-02T00:00:00Z");
  const client = new DingTalkClient() as any;
  client.getOpenApiAccessToken = async () => "test-token";
  const urls: string[] = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.ok(init?.signal);
    assert.equal(init?.method, undefined);
    assert.equal((init?.headers as Record<string, string>)["x-acs-dingtalk-access-token"], "test-token");
    return Response.json(urls.length === 1 ? { records: [{ userId: "a", leaveTime: "2026-11-01T10:00:00Z" }], nextToken: "page2" } : { records: [{ userId: "b", leaveTime: "2026-11-01T11:00:00Z" }] });
  };
  try {
    const data = await client.listDepartures(start, end);
    assert.deepEqual(data.map((entry: any) => entry.externalUserId), ["a", "b"]);
    assert.match(urls[1], /nextToken=page2/);
    globalThis.fetch = async () => Response.json({ code: "Forbidden" }, { status: 403 });
    await assert.rejects(client.listDepartures(start, end), /权限/);
    globalThis.fetch = async () => Response.json({ records: [], nextToken: "repeat" });
    await assert.rejects(client.listDepartures(start, end), /分页/);
    globalThis.fetch = async () => Response.json({ records: [{ userId: "a", leaveTime: "invalid" }] });
    await assert.rejects(client.listDepartures(start, end), /有效身份或时间/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldMock === undefined) delete process.env.DINGTALK_MOCK_ENABLED; else process.env.DINGTALK_MOCK_ENABLED = oldMock;
  }
});
