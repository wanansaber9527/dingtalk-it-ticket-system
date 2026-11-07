import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const staticSource = path.join(projectRoot, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(projectRoot, "public");
const publicTarget = path.join(standaloneRoot, "public");

async function findEnvironmentFiles(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findEnvironmentFiles(entryPath)));
    } else if (entry.name === ".env" || entry.name.startsWith(".env.")) {
      found.push(path.relative(standaloneRoot, entryPath));
    }
  }
  return found;
}

const copiedEnvironmentFiles = await findEnvironmentFiles(standaloneRoot);
if (copiedEnvironmentFiles.length) {
  throw new Error(
    `Standalone output must not contain environment files: ${copiedEnvironmentFiles.join(", ")}`
  );
}

await fs.rm(staticTarget, { recursive: true, force: true });
await fs.mkdir(path.dirname(staticTarget), { recursive: true });
await fs.cp(staticSource, staticTarget, { recursive: true });

try {
  await fs.access(publicSource);
  await fs.rm(publicTarget, { recursive: true, force: true });
  await fs.cp(publicSource, publicTarget, { recursive: true });
} catch {
  // This application currently has no public assets.
}

process.stdout.write("Standalone runtime assets prepared.\n");
