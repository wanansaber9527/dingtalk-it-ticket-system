// 中文注释：钉钉集成封装，集中处理钉钉开放平台和 AI 表格同步相关逻辑。
import type {
  AiTableOperationType,
  KnowledgeBase,
  PrismaClient,
  Ticket,
  TicketLog
} from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import {
  aiTableTableIds,
  mapKnowledgeBaseToAiTable,
  mapSatisfactionToAiTable,
  mapTicketLogToAiTable,
  mapTicketToAiTable
} from "./aiTableMappings";

type RecordFields = Record<string, string | number | boolean | null>;
type RetryResult = { id: string; status: "SUCCESS" | "FAILED"; errorMessage?: string };
type AiTableRecordResponse = { recordId?: string; id?: string; updated?: boolean };

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function replacePathParams(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, encodeURIComponent(value)),
    path
  );
}

export class DingTalkAiTableClient {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  private get mockEnabled() {
    // 中文注释：本地默认 mock，真实上线时关闭该开关并补齐官方 API 路径。
    return process.env.DINGTALK_AI_TABLE_MOCK_ENABLED !== "false";
  }

  async insertRecord(tableId: string, fields: RecordFields): Promise<AiTableRecordResponse> {
    if (this.mockEnabled) {
      return { recordId: `mock_${Date.now()}_${Math.random().toString(16).slice(2)}` };
    }
    const path = process.env.DINGTALK_AI_TABLE_INSERT_RECORD_PATH;
    if (!path) throw new Error("未配置 DINGTALK_AI_TABLE_INSERT_RECORD_PATH");
    return this.request<AiTableRecordResponse>(path, { tableId }, "POST", { fields });
  }

  async updateRecord(tableId: string, recordId: string, fields: RecordFields): Promise<AiTableRecordResponse> {
    if (this.mockEnabled) {
      return { recordId, updated: true };
    }
    const path = process.env.DINGTALK_AI_TABLE_UPDATE_RECORD_PATH;
    if (!path) throw new Error("未配置 DINGTALK_AI_TABLE_UPDATE_RECORD_PATH");
    return this.request<AiTableRecordResponse>(path, { tableId, recordId }, "PUT", { fields });
  }

  async listRecords(tableId: string, query: Record<string, unknown> = {}) {
    if (this.mockEnabled) {
      return { records: [], query };
    }
    const path = process.env.DINGTALK_AI_TABLE_LIST_RECORDS_PATH;
    if (!path) throw new Error("未配置 DINGTALK_AI_TABLE_LIST_RECORDS_PATH");
    return this.request(path, { tableId }, "POST", query);
  }

  async syncTicket(ticket: Ticket) {
    // 中文注释：主表同步失败只写入失败状态和同步日志，不抛出到工单主流程。
    const tableId = aiTableTableIds.ticket() || (this.mockEnabled ? "mock_ticket_table" : "");
    const fields = mapTicketToAiTable(ticket);
    const operationType: AiTableOperationType = ticket.aiTableRecordId ? "UPDATE_TICKET" : "INSERT_TICKET";
    const requestPayload = {
      entity: "ticket",
      ticketId: ticket.id,
      tableId,
      recordId: ticket.aiTableRecordId,
      fields
    };

    try {
      if (!tableId) throw new Error("未配置 DINGTALK_AI_TABLE_TICKET_TABLE_ID");
      const response = ticket.aiTableRecordId
        ? await this.updateRecord(tableId, ticket.aiTableRecordId, fields)
        : await this.insertRecord(tableId, fields);
      const recordId = ticket.aiTableRecordId || response.recordId || response.id || null;
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          aiTableRecordId: recordId,
          aiSyncStatus: "SUCCESS",
          aiSyncError: null
        }
      });
      await this.writeLog(ticket, operationType, requestPayload, response, "SUCCESS");
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI表格同步失败";
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { aiSyncStatus: "FAILED", aiSyncError: message }
      });
      await this.writeLog(ticket, operationType, requestPayload, null, "FAILED", message);
      return null;
    }
  }

  async syncTicketLog(log: TicketLog) {
    const tableId = aiTableTableIds.log() || (this.mockEnabled ? "mock_log_table" : "");
    const fields = mapTicketLogToAiTable(log);
    const requestPayload = {
      entity: "ticketLog",
      ticketLogId: log.id,
      tableId,
      fields
    };

    try {
      if (!tableId) throw new Error("未配置 DINGTALK_AI_TABLE_LOG_TABLE_ID");
      const response = await this.insertRecord(tableId, fields);
      await this.writeLog(null, "INSERT_TICKET_LOG", requestPayload, response, "SUCCESS", undefined, log.ticketNo);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI表格流转日志同步失败";
      await this.writeLog(null, "INSERT_TICKET_LOG", requestPayload, null, "FAILED", message, log.ticketNo);
      return null;
    }
  }

  async syncKnowledgeBase(kb: KnowledgeBase) {
    const tableId = aiTableTableIds.knowledgeBase() || (this.mockEnabled ? "mock_kb_table" : "");
    const fields = mapKnowledgeBaseToAiTable(kb);
    const requestPayload = {
      entity: "knowledgeBase",
      knowledgeBaseId: kb.id,
      tableId,
      fields
    };

    try {
      if (!tableId) throw new Error("未配置 DINGTALK_AI_TABLE_KB_TABLE_ID");
      const response = await this.insertRecord(tableId, fields);
      await this.prisma.aiTableSyncLog.create({
        data: {
          ticketId: kb.sourceTicketId,
          ticketNo: kb.sourceTicketNo,
          operationType: "INSERT_KB",
          requestPayload: jsonText(requestPayload),
          responsePayload: jsonText(response),
          status: "SUCCESS"
        }
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI表格知识库同步失败";
      await this.prisma.aiTableSyncLog.create({
        data: {
          ticketId: kb.sourceTicketId,
          ticketNo: kb.sourceTicketNo,
          operationType: "INSERT_KB",
          requestPayload: jsonText(requestPayload),
          status: "FAILED",
          errorMessage: message
        }
      });
      return null;
    }
  }

  async syncSatisfaction(ticket: Ticket) {
    const tableId = aiTableTableIds.satisfaction() || (this.mockEnabled ? "mock_satisfaction_table" : "");
    const fields = mapSatisfactionToAiTable(ticket);
    const requestPayload = {
      entity: "satisfaction",
      ticketId: ticket.id,
      tableId,
      fields
    };

    try {
      if (!tableId) throw new Error("未配置 DINGTALK_AI_TABLE_SATISFACTION_TABLE_ID");
      const response = await this.insertRecord(tableId, fields);
      await this.writeLog(ticket, "INSERT_SATISFACTION", requestPayload, response, "SUCCESS");
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI表格满意度同步失败";
      await this.writeLog(ticket, "INSERT_SATISFACTION", requestPayload, null, "FAILED", message);
      return null;
    }
  }

  async retryFailedSyncLog(id?: string): Promise<RetryResult[]> {
    // 中文注释：失败重试复用日志里的请求参数，避免业务层散落 AI 表格字段映射。
    const logs = await this.prisma.aiTableSyncLog.findMany({
      where: {
        status: "FAILED",
        ...(id ? { id } : {})
      },
      orderBy: { createdAt: "asc" },
      take: id ? 1 : 30
    });

    const results: RetryResult[] = [];
    for (const log of logs) {
      try {
        const payload = log.requestPayload ? JSON.parse(log.requestPayload) : null;
        if (!payload?.tableId || !payload?.fields) throw new Error("同步日志缺少可重试请求参数");
        const response = payload.recordId
          ? await this.updateRecord(payload.tableId, payload.recordId, payload.fields)
          : await this.insertRecord(payload.tableId, payload.fields);
        await this.prisma.aiTableSyncLog.update({
          where: { id: log.id },
          data: {
            status: "SUCCESS",
            responsePayload: jsonText(response),
            errorMessage: null
          }
        });
        if (log.ticketId) {
          await this.prisma.ticket.update({
            where: { id: log.ticketId },
            data: { aiSyncStatus: "SUCCESS", aiSyncError: null }
          });
        }
        results.push({ id: log.id, status: "SUCCESS" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "重试失败";
        await this.prisma.aiTableSyncLog.update({
          where: { id: log.id },
          data: { errorMessage: message }
        });
        results.push({ id: log.id, status: "FAILED", errorMessage: message });
      }
    }
    return results;
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    method: "POST" | "PUT",
    body: unknown
  ): Promise<T> {
    const baseUrl = process.env.DINGTALK_AI_TABLE_API_BASE_URL;
    const baseId = process.env.DINGTALK_AI_TABLE_BASE_ID;
    if (!baseUrl) throw new Error("未配置 DINGTALK_AI_TABLE_API_BASE_URL");
    if (!baseId) throw new Error("未配置 DINGTALK_AI_TABLE_BASE_ID");

    const fullPath = replacePathParams(path, { baseId, ...params });
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${fullPath}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`AI表格接口调用失败：${response.status} ${text}`);
    return data as T;
  }

  private async writeLog(
    ticket: Ticket | null,
    operationType: AiTableOperationType,
    requestPayload: unknown,
    responsePayload: unknown,
    status: "SUCCESS" | "FAILED",
    errorMessage?: string,
    ticketNo?: string | null
  ) {
    await this.prisma.aiTableSyncLog.create({
      data: {
        ticketId: ticket?.id,
        ticketNo: ticket?.ticketNo || ticketNo,
        operationType,
        requestPayload: jsonText(requestPayload),
        responsePayload: responsePayload ? jsonText(responsePayload) : null,
        status,
        errorMessage
      }
    });
  }
}
