export const DIRECTORY_SYNC_MIN_INTERVAL = 5;
export const DIRECTORY_SYNC_MAX_INTERVAL = 1440;
export const DIRECTORY_SYNC_DEFAULT_INTERVAL = 60;

export type DirectorySyncStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
export type DirectorySyncAction = "CREATED" | "UPDATED" | "UNCHANGED" | "DEPARTED" | "RESTORED" | "PENDING" | "FAILED";
export type DirectorySyncRunDto = {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  departedCount: number;
  restoredCount: number;
  pendingCount: number;
  failedCount: number;
  errorMessage: string | null;
  operatorId: string | null;
};
export type DirectorySyncSettingsDto = {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string;
  lastSuccessAt: string | null;
  running: boolean;
  lastRun: DirectorySyncRunDto | null;
};
export type DirectorySyncItemDto = {
  id: string;
  userId: string | null;
  externalUserId: string | null;
  name: string | null;
  action: string;
  changesJson: string | null;
  changes: string[];
  errorMessage: string | null;
  createdAt: string;
};
export type DirectorySyncLogPageDto = { items: DirectorySyncRunDto[]; total: number; page: number; pageSize: number };
export type DirectorySyncDetailDto = DirectorySyncRunDto & { items: DirectorySyncItemDto[] };
export type DirectorySyncResult = Pick<DirectorySyncRunDto, "status" | "total" | "createdCount" | "updatedCount" | "unchangedCount" | "departedCount" | "restoredCount" | "pendingCount" | "failedCount"> & { runId: string };

export const directorySyncStatusLabels: Record<string, string> = { RUNNING: "同步中", SUCCESS: "成功", PARTIAL: "部分完成", FAILED: "失败" };
export const directorySyncActionLabels: Record<string, string> = { CREATED: "新增", UPDATED: "资料更新", UNCHANGED: "无变化", DEPARTED: "离职归档", RESTORED: "返聘恢复", PENDING: "待核实", FAILED: "失败" };
