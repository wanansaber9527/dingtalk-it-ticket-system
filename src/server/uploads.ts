import { prisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import { canViewTicket, hasAnyRole, requireActiveUser } from "@/src/server/permissions";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { findUploadFile, imageContentTypeFromName, readUploadOwner, safeUploadFileName } from "@/src/server/upload-storage";

export { getUploadDir, imageContentTypeFromName, safeUploadFileName } from "@/src/server/upload-storage";

function fileNameFromUrl(value: unknown, newAttachment = false): string | null {
  if (typeof value !== "string" || value.length > 2048 || value.includes("\\")) return null;
  try {
    const base = new URL(process.env.APP_BASE_URL || "http://local.invalid");
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (newAttachment && (url.origin !== base.origin || value.startsWith("//"))) return null;
    const match = /^\/(?:api\/)?uploads\/([^/]+)$/.exec(url.pathname);
    return match ? safeUploadFileName(match[1]) : null;
  } catch { return null; }
}

function includesFile(serialized: string | null, fileName: string) {
  if (!serialized) return false;
  try {
    const items: unknown = JSON.parse(serialized);
    return Array.isArray(items) && items.some((item) => fileNameFromUrl(typeof item === "string" ? item : item?.url) === fileName);
  } catch { return false; }
}

async function ownsUnattachedUpload(fileName: string, user: UserWithRoles) {
  const ownerId = await readUploadOwner(fileName);
  if (!ownerId) return false;
  if (ownerId === user.dingtalkUserId) return true;
  // 返聘后附件元数据仍保留上传时的外部账号。仅使用当前企业内已核验的
  // 身份绑定找回同一个永久人员 ID；旧绑定可以 inactive，但不能跨企业/跨人员。
  const corpId = process.env.DINGTALK_CORP_ID?.trim() ||
    (process.env.NODE_ENV !== "production" && process.env.DINGTALK_MOCK_ENABLED === "true" ? "local-corp" : "");
  if (!corpId) return false;
  return Boolean(await prisma.userIdentity.findFirst({
    where: { corpId, externalUserId: ownerId, userId: user.id },
    select: { id: true }
  }));
}

export async function requireCanReadUpload(fileName: string, user: UserWithRoles) {
  requireActiveUser(user);
  const safeName = safeUploadFileName(fileName);
  if (hasAnyRole(user, ["SUPER_ADMIN"])) return;
  // 旧附件既可能存于工单，也可能存于补充说明日志。模糊查询后必须精确核对 JSON URL。
  const tickets = await prisma.ticket.findMany({
    where: { OR: [{ attachments: { contains: safeName } }, { logs: { some: { attachments: { contains: safeName } } } }] },
    select: { applicantId: true, handlerId: true, applicantUserId: true, handlerUserId: true, ccRecipients: { select: { personId: true, userId: true } }, attachments: true, logs: { where: { attachments: { contains: safeName } }, select: { attachments: true } } }
  });
  const linked = tickets.filter((ticket) => includesFile(ticket.attachments, safeName) || ticket.logs.some((log) => includesFile(log.attachments, safeName)));
  if (linked.length) {
    if (linked.some((ticket) => canViewTicket(user, ticket))) return;
  } else if (await ownsUnattachedUpload(safeName, user)) {
    return;
  }
  throw new AppError(403, "UPLOAD_FORBIDDEN", "无权访问该工单附件");
}

export type ValidatedAttachment = { name: string; url: string; size: number; type: string };

export async function validateOwnedAttachments(value: unknown, user: UserWithRoles): Promise<ValidatedAttachment[] | undefined> {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 10) throw new AppError(400, "INVALID_ATTACHMENTS", "每次最多上传 10 张图片");
  const result: ValidatedAttachment[] = [];
  for (const attachment of value) {
    const fileName = fileNameFromUrl(attachment?.url, true);
    if (!attachment || typeof attachment !== "object" || !fileName || typeof attachment.name !== "string" || !attachment.name.trim() || attachment.name.length > 255) {
      throw new AppError(400, "INVALID_ATTACHMENTS", "附件必须是通过本系统上传的图片");
    }
    await requireCanReadUpload(fileName, user);
    const file = await findUploadFile(fileName);
    result.push({ name: attachment.name.trim(), url: `/api/uploads/${encodeURIComponent(fileName)}`, size: file.size, type: imageContentTypeFromName(fileName) });
  }
  return result;
}
