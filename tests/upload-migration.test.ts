import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migratePrivateUploads } from "../scripts/migrate-private-uploads";

test("legacy migration previews, copies and verifies without deleting or overwriting", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "upload-migration-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"); const destination = path.join(root, "private");
  await mkdir(source); await writeFile(path.join(source, "old.png"), "old bytes");
  await writeFile(path.join(source, ".gitkeep"), "");
  await symlink(path.join(source, "old.png"), path.join(source, "linked.png"));
  const preview = await migratePrivateUploads(source, destination);
  assert.equal(preview.mode, "dry-run"); assert.equal(preview.planned.length, 1);
  await assert.rejects(access(destination));
  const copied = await migratePrivateUploads(source, destination, true);
  assert.equal(copied.sourceFilesDeleted, 0);
  assert.equal(await readFile(path.join(destination, "old.png"), "utf8"), "old bytes");
  assert.equal(await readFile(path.join(source, "old.png"), "utf8"), "old bytes");
  assert.equal((await migratePrivateUploads(source, destination, true)).planned[0].existing, true);
  await writeFile(path.join(destination, "old.png"), "different bytes");
  await assert.rejects(migratePrivateUploads(source, destination, true), /Destination conflict/);
  assert.equal(await readFile(path.join(destination, "old.png"), "utf8"), "different bytes");
  await assert.rejects(migratePrivateUploads(source, path.join(process.cwd(), "public", "other-uploads")), /outside public/);
});
