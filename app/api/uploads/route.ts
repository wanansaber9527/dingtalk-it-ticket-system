// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { AppError, fail, ok } from "@/src/lib/http";
import { getUploadDir, imageExtensionFromFile, imageUploadTip, isSupportedImageBuffer } from "@/src/server/uploads";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(400, "UPLOAD_FILE_REQUIRED", "请选择要上传的图片");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new AppError(400, "UPLOAD_TOO_LARGE", "图片不能超过 10MB");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!isSupportedImageBuffer(file, bytes)) {
      throw new AppError(400, "UPLOAD_IMAGE_ONLY", imageUploadTip);
    }
    const ext = imageExtensionFromFile(file).slice(0, 16);
    const fileName = `${randomUUID()}${ext}`;
    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), bytes);
    return ok({ name: file.name, url: `/api/uploads/${fileName}`, size: file.size, type: file.type });
  } catch (error) {
    return fail(error);
  }
}
