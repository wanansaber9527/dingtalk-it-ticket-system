import { PrismaClient } from "@prisma/client";
import { AppError } from "./http.js";

const KEY = Symbol.for("quran.ticket-correction.metadata-prisma");

export function getMetadataClient() {
  const url = process.env.CORRECTION_METADATA_DATABASE_URL;
  if (!url?.trim()) {
    throw new AppError(
      503,
      "METADATA_CONNECTION_REQUIRED",
      "尚未配置独立数据库核查连接，写入功能已关闭"
    );
  }
  if (!globalThis[KEY]) {
    globalThis[KEY] = new PrismaClient({
      datasourceUrl: url,
      log: []
    });
  }
  return globalThis[KEY];
}
