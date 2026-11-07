import { pathToFileURL } from "node:url";
import { prisma } from "@/src/lib/prisma";
import { DirectorySyncService, safeSyncError } from "@/src/server/services/directorySyncService";

// Independent process. The durable schedule determines the interval; the minute tick does not synchronize every minute.
export async function runDirectorySyncWorker(once = false) {
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => { stopping = true; wake?.(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const service = new DirectorySyncService();
  try {
    do {
      try {
        const result = await service.run({ trigger: "AUTO" });
        if (!("skipped" in result)) console.info(JSON.stringify({ at: new Date().toISOString(), ...result }));
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), error: safeSyncError(error) }));
        if (once) throw error;
      }
      if (once || stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 60_000);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        if (stopping) wake();
      });
    } while (!stopping);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runDirectorySyncWorker(process.argv.includes("--once")).catch(() => { process.exitCode = 1; });
}
