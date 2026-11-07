export const AI_ASSISTANT_NAME = "趣然IT工单智能助手";

export type AiAttachment = { name: string; url: string; size?: number; type?: string };
export type AiCategory = { id: string; name: string; enabled: boolean; aiEnabled: boolean; examples: string[] };
export type AiMessageDto = {
  id: string; role: string; content: string; attachments: AiAttachment[]; status: string; createdAt: string;
  references?: { id: string; title: string; createdAt: string }[];
  suggestions?: string[];
};
export type AiDraftDto = {
  id: string; title: string; categoryId: string; description: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  attachments: AiAttachment[]; version: number; ticketId: string | null; ticketNo?: string | null;
};
export type AiConversationDto = {
  id: string; title: string; categoryId: string; categoryName: string; status: string; updatedAt: string; createdAt: string;
  messages?: AiMessageDto[]; draft?: AiDraftDto | null;
};
export type AiSettings = {
  enabled: boolean; baseUrl: string; model: string; apiKey?: string;
  supportsVision: boolean; temperature: number; maxOutputTokens: number; contextMessages: number;
  dailyMessageLimit: number; timeoutSeconds: number; retentionDays: number; systemPrompt: string;
};
export type AiPublicSettings = Omit<AiSettings, "apiKey"> & { hasApiKey: boolean; configured: boolean; localDemoAvailable: boolean };
export type AiCategoryConfigDto = {
  categoryId: string; categoryName: string; enabled: boolean; prompt: string; environment: string;
  examples: string[]; version: number;
};
export type AiBootstrap = {
  assistantName: string; categories: AiCategory[]; configured: boolean; enabled: boolean;
  supportsVision: boolean; localDemoAvailable: boolean; dailyMessageLimit: number;
};
export type AiStreamEvent =
  | { type: "start"; userMessage: AiMessageDto; assistantMessageId: string }
  | { type: "delta"; content: string }
  | { type: "done"; conversation: AiConversationDto }
  | { type: "error"; message: string };
