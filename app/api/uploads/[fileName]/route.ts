// 中文注释：附件图片读取接口，避免 Nginx 静态目录与 Next public 目录不一致导致图片无法显示。
import { readFile } from "fs/promises";
import path from "path";
import { AppError, fail } from "@/src/lib/http";
import { getUploadDir, imageContentTypeFromName, safeUploadFileName } from "@/src/server/uploads";

export async function GET(_request: Request, context: { params: Promise<{ fileName: string }> }) {
  try {
    const { fileName } = await context.params;
    const safeName = safeUploadFileName(fileName);
    const uploadDir = getUploadDir();
    try {
      const file = await readFile(path.join(uploadDir, safeName));
      return new Response(file, {
        headers: {
          "content-type": imageContentTypeFromName(safeName),
          "cache-control": "public, max-age=31536000, immutable"
        }
      });
    } catch {
      throw new AppError(404, "UPLOAD_NOT_FOUND", "附件图片不存在或已被删除");
    }
  } catch (error) {
    return fail(error);
  }
}
