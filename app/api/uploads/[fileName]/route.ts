import { readFile } from "fs/promises";
import { fail } from "@/src/lib/http";
import { getCurrentUser } from "@/src/server/auth";
import { requireCanReadUpload } from "@/src/server/uploads";
import { findUploadFile, imageContentTypeFromName, safeUploadFileName } from "@/src/server/upload-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ fileName: string }> }) {
  try {
    const user = await getCurrentUser(request);
    const { fileName } = await context.params;
    const safeName = safeUploadFileName(fileName);
    await requireCanReadUpload(safeName, user);
    const file = await findUploadFile(safeName);
    return new Response(await readFile(file.location), { headers: {
      "content-type": imageContentTypeFromName(safeName),
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${safeName}"`,
      "vary": "Cookie"
    } });
  } catch (error) { return fail(error); }
}
