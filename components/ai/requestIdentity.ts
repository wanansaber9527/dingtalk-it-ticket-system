import type { AiAttachment } from "@/src/lib/ai";

export type PendingAiRequest = { signature: string; requestId: string; createdAt: number };
export async function aiRequestSignature(payload: { conversationId: string; categoryId: string; content: string; attachments: AiAttachment[]; referenceConversationIds: string[]; demo: boolean }) {
  const normalized = { ...payload, attachments: payload.attachments.map(({ name, url }) => ({ name, url })), referenceConversationIds: [...payload.referenceConversationIds].sort() };
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pendingAiRequest(signature: string, previous: unknown, now = Date.now()): PendingAiRequest {
  if (previous && typeof previous === "object" && "signature" in previous && previous.signature === signature && "requestId" in previous && typeof previous.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(previous.requestId) && "createdAt" in previous && typeof previous.createdAt === "number" && now - previous.createdAt >= 0 && now - previous.createdAt < 86400000) {
    return previous as PendingAiRequest;
  }
  return { signature, requestId: crypto.randomUUID(), createdAt: now };
}
