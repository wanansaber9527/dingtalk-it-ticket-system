// 中文注释：附件 URL 统一处理，兼容旧的 /uploads 路径和新的 API 读取路径。

export type TicketAttachment = {
  name: string;
  url: string;
  size?: number;
  type?: string;
};

function fileNameFromUploadUrl(url: string) {
  const cleanUrl = url.split("?")[0].split("#")[0];
  return cleanUrl.split("/").filter(Boolean).pop();
}

export function attachmentDisplayUrl(url: string) {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith("/api/uploads/")) return url;
  if (url.startsWith("/uploads/")) {
    const fileName = fileNameFromUploadUrl(url);
    return fileName ? `/api/uploads/${encodeURIComponent(fileName)}` : url;
  }
  return url;
}

export function parseTicketAttachments(value?: string | null): TicketAttachment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string") {
          return { name: fileNameFromUploadUrl(item) || "附件图片", url: item };
        }
        if (!item || typeof item !== "object") return null;
        const attachment = item as Partial<TicketAttachment>;
        if (!attachment.url) return null;
        return {
          name: attachment.name || fileNameFromUploadUrl(attachment.url) || "附件图片",
          url: attachment.url,
          size: attachment.size,
          type: attachment.type
        };
      })
      .filter(Boolean) as TicketAttachment[];
  } catch {
    return [];
  }
}
