import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSilentWriteContract,
  evaluateDatabasePrivileges,
  inspectDatabaseContract
} from "../lib/database-contract.js";

const REQUIRED_COLUMNS = [
  "id",
  "ticketNo",
  "title",
  "categoryId",
  "categoryName",
  "priority",
  "status",
  "applicantUserId",
  "applicantName",
  "applicantDepartment",
  "applicantPosition",
  "handlerUserId",
  "handlerName",
  "description",
  "attachments",
  "expectedResolveTime",
  "firstResponseAt",
  "resolvedAt",
  "closedAt",
  "slaFirstResponseDeadline",
  "slaResolveDeadline",
  "isFirstResponseOverdue",
  "isResolveOverdue",
  "resultSummary",
  "satisfactionLevel",
  "satisfactionComment",
  "createdAt",
  "updatedAt"
];

const SAFE_GRANTS = [
  "GRANT USAGE ON *.* TO `ticket_corrector`@`127.0.0.1`",
  "GRANT SELECT, UPDATE ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`",
  "GRANT SELECT ON `information_schema`.* TO `ticket_corrector`@`127.0.0.1`"
];

const METADATA_GRANTS = [
  "GRANT USAGE ON *.* TO `ticket_metadata`@`127.0.0.1`",
  "GRANT SELECT, TRIGGER ON `it_ticket`.`Ticket` TO `ticket_metadata`@`127.0.0.1`"
];

function fakeMetadata(overrides = {}) {
  return fakeClient({ grants: METADATA_GRANTS, account: "ticket_metadata@127.0.0.1", ...overrides });
}

function fakeClient({
  databaseName = "it_ticket",
  grants = SAFE_GRANTS,
  serverUuid = "isolated-mysql-instance",
  account = "ticket_corrector@127.0.0.1",
  triggers = []
} = {}) {
  const calls = {
    columns: 0,
    triggers: 0,
    database: 0,
    grants: 0
  };
  const columns = REQUIRED_COLUMNS.map((name) => ({
    COLUMN_NAME: name,
    DATA_TYPE: name === "status" ? "enum" : "varchar",
    COLUMN_TYPE:
      name === "status"
        ? "enum('PENDING','ASSIGNED','PROCESSING','RETURNED','COMPLETED','CLOSED','REJECTED','CANCELLED')"
        : "varchar(191)",
    IS_NULLABLE: "YES"
  }));

  return {
    calls,
    async $queryRaw(strings) {
      const sql = strings.join(" ");
      if (sql.includes("information_schema.COLUMNS")) {
        calls.columns += 1;
        return columns;
      }
      if (sql.includes("information_schema.TRIGGERS")) {
        calls.triggers += 1;
        return triggers;
      }
      if (sql.includes("SELECT DATABASE()")) {
        calls.database += 1;
        return [{ databaseName, timeZone: "+00:00", serverUuid, account }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async $queryRawUnsafe(sql) {
      assert.equal(sql, "SHOW GRANTS FOR CURRENT_USER");
      calls.grants += 1;
      return grants.map((grant) => ({ grant }));
    }
  };
}

test("只允许 Ticket SELECT/UPDATE、全局 USAGE 和 information_schema 只读", () => {
  const result = evaluateDatabasePrivileges(SAFE_GRANTS, "it_ticket");
  assert.equal(result.valid, true);
  assert.deepEqual(result.ticketPrivileges, ["SELECT", "UPDATE"]);
  assert.deepEqual(result.missingTicketPrivileges, []);
  assert.deepEqual(result.violations, []);
});

test("拒绝全局权限、Ticket INSERT/DELETE 和 Ticket 外权限", () => {
  for (const grant of [
    "GRANT SELECT ON *.* TO `ticket_corrector`@`127.0.0.1`",
    "GRANT SELECT, UPDATE, INSERT ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`",
    "GRANT SELECT, UPDATE, DELETE ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`",
    "GRANT UPDATE ON `it_ticket`.`Notification` TO `ticket_corrector`@`127.0.0.1`",
    "GRANT SELECT ON `it_ticket`.`User` TO `ticket_corrector`@`127.0.0.1`"
  ]) {
    const result = evaluateDatabasePrivileges(
      [
        "GRANT SELECT, UPDATE ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`",
        grant
      ],
      "it_ticket"
    );
    assert.equal(result.valid, false, grant);
    assert.ok(result.violations.length > 0, grant);
  }
});

test("拒绝 information_schema 写权限和 GRANT OPTION", () => {
  for (const grant of [
    "GRANT UPDATE ON `information_schema`.* TO `ticket_corrector`@`127.0.0.1`",
    "GRANT SELECT, UPDATE ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1` WITH GRANT OPTION"
  ]) {
    const result = evaluateDatabasePrivileges(
      [
        "GRANT SELECT, UPDATE ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`",
        grant
      ],
      "it_ticket"
    );
    assert.equal(result.valid, false, grant);
  }
});

test("目标库名不一致时关闭写入", async () => {
  const client = fakeClient({ databaseName: "wrong_database" });
  await assert.rejects(
    assertSilentWriteContract("COMPLETED", {
      client,
      metadataClient: fakeMetadata(),
      expectedDatabaseName: "it_ticket"
    }),
    (error) => error?.code === "DATABASE_NAME_MISMATCH"
  );
});

test("缺少 EXPECTED_DATABASE_NAME 时失败关闭", async () => {
  const previous = process.env.EXPECTED_DATABASE_NAME;
  delete process.env.EXPECTED_DATABASE_NAME;
  try {
    await assert.rejects(
      inspectDatabaseContract({ force: true, client: fakeClient() }),
      (error) => error?.code === "EXPECTED_DATABASE_NAME_MISSING"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.EXPECTED_DATABASE_NAME;
    } else {
      process.env.EXPECTED_DATABASE_NAME = previous;
    }
  }
});

test("每次写入断言都强制刷新数据库结构和授权", async () => {
  const client = fakeClient();
  const metadataClient = fakeMetadata();
  const options = { client, metadataClient, expectedDatabaseName: "it_ticket" };

  await inspectDatabaseContract(options);
  await inspectDatabaseContract(options);
  assert.equal(client.calls.grants, 1, "普通检查应使用短缓存");

  await assertSilentWriteContract("COMPLETED", options);
  await assertSilentWriteContract("COMPLETED", options);
  assert.equal(client.calls.columns, 3);
  assert.equal(client.calls.triggers, 0, "写账号不得用于查询触发器");
  assert.equal(metadataClient.calls.triggers, 3);
  assert.equal(metadataClient.calls.grants, 3);
  assert.equal(client.calls.database, 3);
  assert.equal(client.calls.grants, 3);
});

test("缺少 Ticket SELECT 或 UPDATE 时拒绝写入", async () => {
  const client = fakeClient({
    grants: [
      "GRANT USAGE ON *.* TO `ticket_corrector`@`127.0.0.1`",
      "GRANT SELECT ON `it_ticket`.`Ticket` TO `ticket_corrector`@`127.0.0.1`"
    ]
  });
  await assert.rejects(
    assertSilentWriteContract("COMPLETED", {
      client,
      metadataClient: fakeMetadata(),
      expectedDatabaseName: "it_ticket"
    }),
    (error) => error?.code === "DATABASE_PRIVILEGES_INSUFFICIENT"
  );
});


test("缺少独立 metadata 连接时拒绝把不可见当成无触发器", async () => {
  const before = process.env.CORRECTION_METADATA_DATABASE_URL;
  delete process.env.CORRECTION_METADATA_DATABASE_URL;
  try {
    await assert.rejects(
      inspectDatabaseContract({ force: true, client: fakeClient(), expectedDatabaseName: "it_ticket" }),
      (error) => error?.code === "METADATA_CONNECTION_REQUIRED"
    );
  } finally {
    if (before === undefined) delete process.env.CORRECTION_METADATA_DATABASE_URL;
    else process.env.CORRECTION_METADATA_DATABASE_URL = before;
  }
});

test("metadata 必须可见触发器且不得拥有业务写权限", async () => {
  for (const grants of [SAFE_GRANTS, [
    "GRANT SELECT, UPDATE, TRIGGER ON `it_ticket`.`Ticket` TO `ticket_metadata`@`127.0.0.1`"
  ]]) {
    await assert.rejects(
      assertSilentWriteContract("COMPLETED", {
        client: fakeClient(), metadataClient: fakeMetadata({ grants }), expectedDatabaseName: "it_ticket"
      }),
      (error) => error?.code === "METADATA_VERIFICATION_FAILED"
    );
  }
});

test("核查连接必须使用独立账号并指向同一个 MySQL 实例和目标库", async () => {
  for (const overrides of [
    { serverUuid: "different-server" }, { databaseName: "different-database" },
    { account: "ticket_corrector@127.0.0.1" }, { serverUuid: null }
  ]) {
    await assert.rejects(
      assertSilentWriteContract("COMPLETED", {
        client: fakeClient(), metadataClient: fakeMetadata(overrides), expectedDatabaseName: "it_ticket"
      }),
      (error) => error?.code === "METADATA_VERIFICATION_FAILED"
    );
  }
});

test("独立核查账号发现触发器时禁止更正", async () => {
  await assert.rejects(
    assertSilentWriteContract("COMPLETED", {
      client: fakeClient(),
      metadataClient: fakeMetadata({ triggers: [{ TRIGGER_NAME: "write_log", EVENT_MANIPULATION: "UPDATE" }] }),
      expectedDatabaseName: "it_ticket"
    }),
    (error) => error?.code === "DATABASE_TRIGGER_PRESENT"
  );
});

test("不能用仅大小写不同的库表授权证明 Ticket 触发器可见性", () => {
  for (const target of ["`IT_TICKET`.`Ticket`", "`it_ticket`.`ticket`"]) {
    const grants = [`GRANT SELECT, TRIGGER ON ${target} TO \`ticket_metadata\`@\`127.0.0.1\``];
    assert.equal(evaluateDatabasePrivileges(grants, "it_ticket", "metadata").valid, false);
  }
});

test("只在 MySQL 明确采用大小写不敏感表名时接受折叠后的授权", () => {
  const grants = ["GRANT SELECT, TRIGGER ON `it_ticket`.`ticket` TO `ticket_metadata`@`127.0.0.1`"];
  assert.equal(evaluateDatabasePrivileges(grants, "it_ticket", "metadata", true).valid, true);
  assert.equal(evaluateDatabasePrivileges(grants, "it_ticket", "metadata", false).valid, false);
});
