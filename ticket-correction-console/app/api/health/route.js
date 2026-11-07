import { requireSession } from "@/lib/auth";
import { reconcileAuditState } from "@/lib/audit-recovery";
import { inspectDatabaseContract } from "@/lib/database-contract";
import { jsonError, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    requireSession(request);
    const audit = await reconcileAuditState();
    const contract = await inspectDatabaseContract({ force: true });
    const ready =
      audit.ready &&
      contract.databaseNameMatches &&
      contract.missingColumns.length === 0 &&
      contract.triggers.length === 0 &&
      contract.permissions.valid &&
      contract.metadataMatches &&
      contract.metadataPermissions.valid;
    const message = !contract.databaseNameMatches
      ? "当前连接的数据库不是配置的目标工单库，写入功能已关闭"
      : !contract.metadataMatches || !contract.metadataPermissions.valid
        ? "独立数据库核查未通过，写入功能已关闭"
      : contract.permissions.violations.length
        ? "数据库账号权限超出允许范围，写入功能已关闭"
        : contract.permissions.missingTicketPrivileges.length
          ? "数据库账号缺少 Ticket 必要权限，写入功能已关闭"
          : undefined;
    return jsonOk({
      ready,
      message,
      auditReady: audit.ready,
      recoveredAuditOperations: audit.recovered,
      timeZone: contract.timeZone,
      supportedStatuses: contract.statuses,
      missingColumns: contract.missingColumns,
      triggerCount: contract.triggers.length,
      databaseNameMatches: contract.databaseNameMatches,
      permissionReady: contract.permissions.valid
    });
  } catch (error) {
    return jsonError(error);
  }
}
