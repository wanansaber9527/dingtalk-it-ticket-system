import { randomUUID } from "crypto";
import { AppError, fail, ok } from "@/src/lib/http";
import { getCurrentUser } from "@/src/server/auth";
import { decodeUploadedImage } from "@/src/server/upload-image";
import { storeOwnedUpload } from "@/src/server/upload-storage";
import { consumeUploadAllowance, readUploadForm, withUploadSlot } from "@/src/server/upload-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    consumeUploadAllowance(user.dingtalkUserId);
    return await withUploadSlot(async () => {
      const form = await readUploadForm(request);
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError(400, "UPLOAD_FILE_REQUIRED", "请选择要上传的图片");
      if (!file.size || file.size > 10 * 1024 * 1024) throw new AppError(400, "UPLOAD_TOO_LARGE", "请选择不超过 10MB 的有效图片");
      const image = await decodeUploadedImage(Buffer.from(await file.arrayBuffer()));
      const fileName = `${randomUUID()}${image.extension}`;
      await storeOwnedUpload(fileName, image.bytes, user.dingtalkUserId);
      return ok({ name: file.name.slice(0, 255) || "图片", url: `/api/uploads/${fileName}`, size: image.bytes.length, type: image.contentType });
    });
  } catch (error) { return fail(error); }
}
