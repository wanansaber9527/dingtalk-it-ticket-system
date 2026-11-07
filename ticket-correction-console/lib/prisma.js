import { PrismaClient } from "@prisma/client";

const GLOBAL_KEY = Symbol.for("quran.ticket-correction.prisma");

export const prisma =
  globalThis[GLOBAL_KEY] ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis[GLOBAL_KEY] = prisma;
}
