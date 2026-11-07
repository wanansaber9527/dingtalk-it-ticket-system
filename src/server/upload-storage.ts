import path from "path";
import { lstat, mkdir, readFile, writeFile, unlink } from "fs/promises";
import { AppError } from "@/src/lib/http";

const imageTypes: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".heic": "image/heic", ".heif": "image/heif" };

function inside(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function getUploadDir() {
  const configured = process.env.UPLOAD_DIR?.trim();
  const target = path.resolve(configured || path.join(process.cwd(), "var", "uploads"));
  // 旧配置可能直接指向 public；新文件必须写入私有目录。
  return inside(path.join(process.cwd(), "public"), target) ? path.join(process.cwd(), "var", "uploads") : target;
}

export function legacyUploadDirs() {
  return [...new Set([process.env.UPLOAD_DIR?.trim(), path.join(process.cwd(), "public", "uploads")].filter((value): value is string => Boolean(value)).map((value) => path.resolve(value)))].filter((value) => value !== getUploadDir());
}

export function safeUploadFileName(value: string) {
  let name: string;
  try { name = decodeURIComponent(value); } catch { throw new AppError(400, "INVALID_UPLOAD_NAME", "附件名称无效"); }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(name) || path.basename(name) !== name) {
    throw new AppError(400, "INVALID_UPLOAD_NAME", "附件名称无效");
  }
  return name;
}

export function imageContentTypeFromName(fileName: string) {
  return imageTypes[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

export async function findUploadFile(fileName: string) {
  const name = safeUploadFileName(fileName);
  for (const directory of [getUploadDir(), ...legacyUploadDirs()]) {
    const location = path.join(directory, name);
    try {
      const info = await lstat(location);
      if (info.isFile() && !info.isSymbolicLink()) return { location, size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new AppError(404, "UPLOAD_NOT_FOUND", "附件图片不存在或已被删除");
}

export async function readUploadOwner(fileName: string) {
  const location = path.join(getUploadDir(), ".owners", `${safeUploadFileName(fileName)}.json`);
  try {
    const owner = JSON.parse(await readFile(location, "utf8"));
    return typeof owner.uploadedBy === "string" ? owner.uploadedBy as string : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function storeOwnedUpload(fileName: string, bytes: Buffer, userId: string) {
  const name = safeUploadFileName(fileName);
  const directory = getUploadDir();
  const owners = path.join(directory, ".owners");
  await mkdir(owners, { recursive: true, mode: 0o700 });
  const file = path.join(directory, name);
  const sidecar = path.join(owners, `${name}.json`);
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(sidecar, JSON.stringify({ version: 1, uploadedBy: userId, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    await unlink(file).catch(() => undefined);
    throw error;
  }
}
