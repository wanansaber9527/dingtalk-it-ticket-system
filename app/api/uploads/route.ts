// 中文注释：Next.js API 路由，负责接收请求、校验身份并调用对应服务层。
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fail, ok } from "@/src/lib/http";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("请选择要上传的附件");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("附件不能超过 10MB");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).slice(0, 16);
    const fileName = `${randomUUID()}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), bytes);
    return ok({ name: file.name, url: `/uploads/${fileName}`, size: file.size, type: file.type });
  } catch (error) {
    return fail(error);
  }
}
