// 中文注释：上传文件的服务端校验和读取工具，避免业务路由里散落文件系统细节。
import path from "path";
import { AppError } from "@/src/lib/http";

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif"
]);

const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"]);

const contentTypesByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif"
};

export function getUploadDir() {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
}

export function safeUploadFileName(fileName: string) {
  const decoded = decodeURIComponent(fileName);
  const baseName = path.basename(decoded);
  if (!baseName || baseName !== decoded || !/^[a-zA-Z0-9._-]+$/.test(baseName)) {
    throw new AppError(400, "INVALID_UPLOAD_NAME", "附件名称无效");
  }
  return baseName;
}

export function imageContentTypeFromName(fileName: string) {
  return contentTypesByExt[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

export function imageExtensionFromFile(file: File) {
  const ext = path.extname(file.name).toLowerCase();
  if (allowedImageExtensions.has(ext)) return ext;
  const matched = Object.entries(contentTypesByExt).find(([, contentType]) => contentType === file.type.toLowerCase());
  return matched?.[0] || ".jpg";
}

export function isSupportedClientImage(file: Pick<File, "name" | "type">) {
  const type = file.type.toLowerCase();
  const ext = path.extname(file.name).toLowerCase();
  return allowedImageTypes.has(type) || (!type && allowedImageExtensions.has(ext));
}

export function isSupportedImageBuffer(file: Pick<File, "name" | "type">, buffer: Buffer) {
  const type = file.type.toLowerCase();
  const ext = path.extname(file.name).toLowerCase();
  if (allowedImageTypes.has(type) && allowedImageExtensions.has(ext)) return true;
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return true;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return true;
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
  }
  return false;
}

export const imageUploadTip = "仅支持 JPG、PNG、GIF、WebP、BMP、HEIC 图片";
