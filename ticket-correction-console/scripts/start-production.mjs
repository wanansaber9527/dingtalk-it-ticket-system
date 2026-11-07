import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

export function loadProjectEnvironment(projectRoot = PROJECT_ROOT) {
  const environmentPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(environmentPath)) {
    throw new Error(`Production environment file is missing: ${environmentPath}`);
  }
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("The current Node.js runtime does not support process.loadEnvFile()");
  }
  process.loadEnvFile(environmentPath);
  return environmentPath;
}

export function validateProductionEnvironment() {
  if (process.env.CORRECTION_COOKIE_SECURE !== "true") {
    throw new Error(
      "Production requires CORRECTION_COOKIE_SECURE=true"
    );
  }
}

export async function startProduction(projectRoot = PROJECT_ROOT) {
  process.env.NODE_ENV = "production";
  loadProjectEnvironment(projectRoot);
  process.env.NODE_ENV = "production";
  process.env.HOSTNAME = "127.0.0.1";
  process.env.PORT ||= "31023";
  process.env.CORRECTION_PROJECT_ROOT = projectRoot;
  validateProductionEnvironment();

  const serverPath = path.join(projectRoot, ".next", "standalone", "server.js");
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Standalone server is missing: ${serverPath}`);
  }
  await import(pathToFileURL(serverPath).href);
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  startProduction().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
