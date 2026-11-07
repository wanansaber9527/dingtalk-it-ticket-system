import { prisma } from "./prisma.js";
import { AppError } from "./http.js";
import { getMetadataClient } from "./metadata-prisma.js";

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

const REQUIRED_TICKET_PRIVILEGES = ["SELECT", "UPDATE"];
const ALLOWED_INFORMATION_SCHEMA_PRIVILEGES = new Set(["SELECT"]);

let cachedContract = null;

function enumValues(columnType) {
  if (typeof columnType !== "string" || !columnType.toLowerCase().startsWith("enum(")) return [];
  return [...columnType.matchAll(/'((?:[^']|'')+)'/g)].map((match) => match[1].replace(/''/g, "'"));
}

function requiredExpectedDatabaseName(value = process.env.EXPECTED_DATABASE_NAME) {
  const databaseName = typeof value === "string" ? value.trim() : "";
  if (!databaseName) {
    throw new AppError(
      500,
      "EXPECTED_DATABASE_NAME_MISSING",
      "服务缺少必要配置：EXPECTED_DATABASE_NAME"
    );
  }
  return databaseName;
}

function normalizeTarget(rawTarget) {
  const target = rawTarget
    .trim()
    .replace(/`((?:``|[^`])*)`/g, (_, identifier) => identifier.replace(/``/g, "`"));
  const separator = target.indexOf(".");
  if (separator < 0) return null;
  return {
    database: target.slice(0, separator),
    table: target.slice(separator + 1)
  };
}

function grantStatements(rows) {
  return rows.flatMap((row) =>
    Object.values(row).filter((value) => typeof value === "string")
  );
}

export function evaluateDatabasePrivileges(statements, expectedDatabaseName, purpose = "writer", caseInsensitiveTableNames = false) {
  const requiredPrivileges = purpose === "metadata" ? ["SELECT", "TRIGGER"] : REQUIRED_TICKET_PRIVILEGES;
  const allowedPrivileges = new Set(requiredPrivileges);
  const ticketPrivileges = new Set();
  const violations = [];

  for (const statement of statements) {
    const normalized = statement.trim().replace(/\s+/g, " ");
    const hasGrantOption = /\sWITH\s+GRANT\s+OPTION(?:\s|$)/i.test(normalized);
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i.exec(normalized);

    if (!match) {
      violations.push("存在无法识别或由角色继承的授权");
      continue;
    }

    const privileges = match[1]
      .split(",")
      .map((privilege) => privilege.trim().toUpperCase());
    const target = normalizeTarget(match[2]);

    if (hasGrantOption) {
      violations.push("账号拥有 GRANT OPTION");
    }
    if (!target) {
      violations.push("存在无法识别的授权目标");
      continue;
    }

    // Case folding is allowed only when the connected MySQL server explicitly
    // reports case-insensitive table names (1/2); Linux's default 0 stays exact.
    const normalize = (name) => caseInsensitiveTableNames ? name.toLowerCase() : name;
    const targetDatabase = normalize(target.database);
    const targetTable = normalize(target.table);
    const expectedDatabase = normalize(expectedDatabaseName);

    if (targetDatabase === "*" && targetTable === "*") {
      if (!(privileges.length === 1 && privileges[0] === "USAGE")) {
        violations.push("账号拥有全局权限");
      }
      continue;
    }

    if (
      targetDatabase === expectedDatabase &&
      targetTable === normalize("Ticket")
    ) {
      for (const privilege of privileges) {
        if (!allowedPrivileges.has(privilege)) {
          violations.push(`Ticket 表存在禁止权限：${privilege}`);
          continue;
        }
        ticketPrivileges.add(privilege);
      }
      continue;
    }

    if (targetDatabase.toLowerCase() === "information_schema") {
      for (const privilege of privileges) {
        if (!ALLOWED_INFORMATION_SCHEMA_PRIVILEGES.has(privilege)) {
          violations.push(`information_schema 存在非只读权限：${privilege}`);
        }
      }
      continue;
    }

    violations.push(`账号拥有 Ticket 表之外的权限：${match[2]}`);
  }

  const missingTicketPrivileges = requiredPrivileges.filter(
    (privilege) => !ticketPrivileges.has(privilege)
  );
  return {
    valid: violations.length === 0 && missingTicketPrivileges.length === 0,
    ticketPrivileges: [...ticketPrivileges].sort(),
    missingTicketPrivileges,
    violations
  };
}

export async function inspectDatabaseContract({
  force = false,
  client = prisma,
  metadataClient: configuredMetadataClient,
  expectedDatabaseName: configuredDatabaseName
} = {}) {
  const expectedDatabaseName = requiredExpectedDatabaseName(configuredDatabaseName);
  const metadataClient = configuredMetadataClient || getMetadataClient();
  const now = Date.now();
  if (
    !force &&
    cachedContract &&
    cachedContract.client === client &&
    cachedContract.metadataClient === metadataClient &&
    cachedContract.expectedDatabaseName === expectedDatabaseName &&
    cachedContract.expiresAt > now
  ) {
    return cachedContract.value;
  }

  try {
    const [columns, triggers, databaseRows, grantRows, metadataRows, metadataGrantRows] = await Promise.all([
      client.$queryRaw`
        SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Ticket'
      `,
      metadataClient.$queryRaw`
        SELECT TRIGGER_NAME, EVENT_MANIPULATION
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'Ticket'
      `,
      client.$queryRaw`SELECT DATABASE() AS databaseName, @@session.time_zone AS timeZone,
        @@server_uuid AS serverUuid, CURRENT_USER() AS account,
        @@lower_case_table_names AS lowerCaseTableNames`,
      client.$queryRawUnsafe("SHOW GRANTS FOR CURRENT_USER"),
      metadataClient.$queryRaw`SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid,
        CURRENT_USER() AS account`,
      metadataClient.$queryRawUnsafe("SHOW GRANTS FOR CURRENT_USER")
    ]);

    const columnMap = new Map(columns.map((column) => [column.COLUMN_NAME, column]));
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnMap.has(column));
    const statuses = enumValues(columnMap.get("status")?.COLUMN_TYPE);
    const databaseName = databaseRows[0]?.databaseName || null;
    const caseInsensitiveTableNames = [1, 2].includes(Number(databaseRows[0]?.lowerCaseTableNames));
    const permissions = evaluateDatabasePrivileges(
      grantStatements(grantRows),
      expectedDatabaseName, "writer", caseInsensitiveTableNames
    );
    const metadataPermissions = evaluateDatabasePrivileges(
      grantStatements(metadataGrantRows), expectedDatabaseName, "metadata", caseInsensitiveTableNames
    );
    const writerIdentity = databaseRows[0];
    const metadataIdentity = metadataRows[0];
    const metadataMatches = Boolean(
      writerIdentity?.serverUuid &&
      writerIdentity.serverUuid === metadataIdentity?.serverUuid &&
      metadataIdentity.databaseName === expectedDatabaseName &&
      writerIdentity.account && metadataIdentity.account &&
      writerIdentity.account !== metadataIdentity.account
    );
    const value = {
      databaseName,
      expectedDatabaseName,
      databaseNameMatches: databaseName === expectedDatabaseName,
      timeZone: databaseRows[0]?.timeZone || null,
      missingColumns,
      statuses,
      triggers: triggers.map((trigger) => ({
        name: trigger.TRIGGER_NAME,
        operation: trigger.EVENT_MANIPULATION
      })),
      permissions,
      metadataPermissions,
      metadataMatches
    };
    cachedContract = {
      client,
      metadataClient,
      value,
      expectedDatabaseName,
      expiresAt: now + 60_000
    };
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Database contract inspection failed", error);
    throw new AppError(503, "DATABASE_CONTRACT_UNAVAILABLE", "无法核对正式数据库结构，写入功能已关闭");
  }
}

export async function assertSilentWriteContract(status, options = {}) {
  const contract = await inspectDatabaseContract({ ...options, force: true });
  if (!contract.databaseNameMatches) {
    throw new AppError(
      503,
      "DATABASE_NAME_MISMATCH",
      "当前连接的数据库不是配置的目标工单库，写入功能已关闭"
    );
  }
  if (contract.missingColumns.length) {
    throw new AppError(
      503,
      "DATABASE_SCHEMA_MISMATCH",
      `正式数据库缺少必要字段：${contract.missingColumns.join("、")}`
    );
  }
  if (!contract.metadataMatches || !contract.metadataPermissions.valid) {
    throw new AppError(
      503,
      "METADATA_VERIFICATION_FAILED",
      "独立核查账号、目标数据库或触发器可见权限未通过校验，写入功能已关闭"
    );
  }
  if (contract.triggers.length) {
    throw new AppError(503, "DATABASE_TRIGGER_PRESENT", "Ticket 表存在数据库触发器，无法保证静默写入");
  }
  if (contract.permissions.violations.length) {
    throw new AppError(
      503,
      "DATABASE_PRIVILEGES_UNSAFE",
      `数据库账号权限超出允许范围：${contract.permissions.violations.join("；")}`
    );
  }
  if (contract.permissions.missingTicketPrivileges.length) {
    throw new AppError(
      503,
      "DATABASE_PRIVILEGES_INSUFFICIENT",
      `数据库账号缺少 Ticket 必要权限：${contract.permissions.missingTicketPrivileges.join("、")}`
    );
  }
  if (!contract.statuses.includes(status)) {
    throw new AppError(400, "STATUS_NOT_DEPLOYED", "正式数据库尚未支持所选工单状态");
  }
  return contract;
}
