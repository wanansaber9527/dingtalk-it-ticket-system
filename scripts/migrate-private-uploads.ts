// Local/offline copy-only migration. Never deletes source attachments or changes the database.
import path from "node:path";
import crypto from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { getUploadDir, legacyUploadDirs, safeUploadFileName } from "../src/server/upload-storage";

function digest(bytes: Buffer) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

export async function migratePrivateUploads(source: string, destination: string, apply = false) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination) throw new Error("Source and destination must differ");
  const publicRoot = path.join(process.cwd(), "public");
  const relative = path.relative(publicRoot, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Destination must be outside public/");
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error("Source must be a real directory");
  const planned: { name: string; hash: string; bytes: number; existing: boolean }[] = [];
  const skipped: string[] = [];
  for (const name of (await readdir(source)).sort()) {
    try { if (safeUploadFileName(name) !== name) throw new Error("Noncanonical name"); } catch { skipped.push(name); continue; }
    const sourcePath = path.join(source, name);
    const info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink()) { skipped.push(name); continue; }
    const hash = digest(await readFile(sourcePath));
    let existing = false;
    try {
      const target = path.join(destination, name);
      const targetInfo = await lstat(target);
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || digest(await readFile(target)) !== hash) throw new Error(`Destination conflict: ${name}`);
      existing = true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    planned.push({ name, hash, bytes: info.size, existing });
  }
  if (apply) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const item of planned) {
      if (!item.existing) {
        const target = path.join(destination, item.name);
        await copyFile(path.join(source, item.name), target, constants.COPYFILE_EXCL);
        await chmod(target, 0o600);
        if (digest(await readFile(target)) !== item.hash) throw new Error(`Copied file hash mismatch: ${item.name}`);
      }
    }
  }
  return { mode: apply ? "copied-and-verified" : "dry-run", source, destination, planned, skipped, sourceFilesDeleted: 0 };
}

if (["migrate-private-uploads.ts", "migrate-private-uploads.js"].includes(path.basename(process.argv[1] || ""))) {
  const sourceIndex = process.argv.indexOf("--source");
  const sources = sourceIndex >= 0 ? [process.argv[sourceIndex + 1]] : legacyUploadDirs();
  if (sources.some((value) => !value || value.startsWith("--"))) throw new Error("--source requires a directory");
  (async () => {
    for (const source of sources) {
      console.log(JSON.stringify(await migratePrivateUploads(source, getUploadDir(), process.argv.includes("--apply")), null, 2));
    }
    console.log("Keep legacy files for rollback. Ensure the reverse proxy forwards /uploads/* to Next.js instead of serving an alias/static directory; otherwise application authorization cannot protect legacy URLs.");
  })().catch((error) => { console.error(error instanceof Error ? error.message : "Migration failed"); process.exitCode = 1; });
}
