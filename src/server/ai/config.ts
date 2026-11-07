import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AiCategoryConfigDto, AiPublicSettings, AiSettings } from "@/src/lib/ai";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { AppError } from "@/src/lib/http";
import type { UserWithRoles } from "@/src/lib/userRoles";
import { requireRole } from "@/src/server/permissions";
import { categoryDefaults, DEFAULT_SYSTEM_PROMPT } from "@/src/server/ai/prompts";
import { isLocalAiDemoAvailable, parseProviderUrl } from "@/src/server/ai/provider";

const CONFIG_KEY = "ai.settings.v1";
const CATEGORY_PREFIX = "ai.category.";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", supportsVision: false,
  temperature: 0.3, maxOutputTokens: 2048, contextMessages: 20, dailyMessageLimit: 100,
  timeoutSeconds: 60, retentionDays: 90, systemPrompt: DEFAULT_SYSTEM_PROMPT
};

const settingsSchema = z.object({
  enabled: z.boolean(), baseUrl: z.string().trim().max(2048), model: z.string().trim().max(200),
  supportsVision: z.boolean(), temperature: z.number().min(0).max(2), maxOutputTokens: z.number().int().min(128).max(16384),
  contextMessages: z.number().int().min(4).max(80), dailyMessageLimit: z.number().int().min(1).max(10000),
  timeoutSeconds: z.number().int().min(5).max(180), retentionDays: z.number().int().min(7).max(365),
  systemPrompt: z.string().trim().max(12000)
});

const updateSchema = settingsSchema.partial().extend({ apiKey: z.string().trim().max(4096).optional(), clearApiKey: z.boolean().optional() });
type StoredSettings = Omit<AiSettings, "apiKey"> & { encryptedApiKey?: string };
type StoredCategory = { enabled: boolean; prompt: string; environment: string; examples: string[]; version: number; updatedBy?: string; revisions?: { version: number; prompt: string; environment: string; enabled: boolean; examples: string[]; changedAt: string }[] };

function encryptionKey() {
  let secret = process.env.AI_CONFIG_SECRET?.trim();
  if (!secret && isLocalAiDemoAvailable()) secret = process.env.AUTH_COOKIE_SECRET?.trim();
  if (!secret || secret.length < 32 || /CHANGE_ME|placeholder|example/i.test(secret) ||
    (process.env.NODE_ENV === "production" && secret === process.env.AUTH_COOKIE_SECRET)) {
    throw new AppError(503, "AI_SECRET_MISSING", "请配置独立且至少 32 字符的 AI_CONFIG_SECRET 后再保存模型密钥");
  }
  return createHash("sha256").update(`itdesk-ai-config-v1\0${secret}`).digest();
}

function encryptKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(CONFIG_KEY));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptKey(value: string) {
  const key = encryptionKey();
  try {
    const [version, ivText, tagText, cipherText, extra] = value.split(".");
    if (version !== "v1" || extra || !ivText || !tagText || !cipherText) throw new Error("format");
    const iv = Buffer.from(ivText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("format");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(CONFIG_KEY));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new AppError(503, "AI_KEY_UNREADABLE", "模型密钥无法解密，请检查 AI_CONFIG_SECRET 或重新保存密钥"); }
}

async function readStored(prisma: PrismaClient): Promise<StoredSettings | null> {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: CONFIG_KEY } });
  if (!row) return null;
  try {
    const data = JSON.parse(row.configValue);
    const parsed = settingsSchema.parse(data);
    if (data.encryptedApiKey !== undefined && typeof data.encryptedApiKey !== "string") throw new Error("key");
    return { ...parsed, encryptedApiKey: data.encryptedApiKey };
  } catch { throw new AppError(503, "AI_CONFIG_INVALID", "AI 配置格式无效，请联系管理员重新配置"); }
}

export async function getAiSettings(prisma: PrismaClient = defaultPrisma): Promise<AiSettings> {
  const stored = await readStored(prisma);
  if (!stored) return { ...DEFAULT_AI_SETTINGS };
  const { encryptedApiKey, ...settings } = stored;
  return { ...settings, apiKey: encryptedApiKey ? decryptKey(encryptedApiKey) : undefined };
}

function publicSettings(settings: AiSettings): AiPublicSettings {
  const { apiKey, ...publicValue } = settings;
  return { ...publicValue, hasApiKey: Boolean(apiKey), configured: Boolean(apiKey && settings.baseUrl && settings.model), localDemoAvailable: isLocalAiDemoAvailable() };
}

export async function getPublicAiSettings(prisma: PrismaClient = defaultPrisma): Promise<AiPublicSettings> {
  const stored = await readStored(prisma);
  if (!stored) return publicSettings(DEFAULT_AI_SETTINGS);
  const { encryptedApiKey, ...settings } = stored;
  return publicSettings({ ...settings, apiKey: encryptedApiKey ? "configured" : undefined });
}

export async function saveAiSettings(input: unknown, user: UserWithRoles, prisma: PrismaClient = defaultPrisma): Promise<AiPublicSettings> {
  requireRole(user, ["SUPER_ADMIN"]);
  const result = updateSchema.safeParse(input);
  if (!result.success) throw new AppError(400, "INVALID_AI_SETTINGS", "请检查模型地址、名称、额度和上下文参数的取值范围");
  const current = await readStored(prisma);
  const { apiKey, clearApiKey, ...updated } = result.data;
  const settings = settingsSchema.parse({ ...DEFAULT_AI_SETTINGS, ...current, ...updated });
  if (settings.baseUrl) parseProviderUrl(settings.baseUrl);
  if ((apiKey || current?.encryptedApiKey) && !clearApiKey && (!settings.baseUrl || !settings.model)) throw new AppError(400, "INCOMPLETE_AI_SETTINGS", "保存模型密钥时必须同时填写 API 地址和模型名称");
  const encryptedApiKey = clearApiKey ? undefined : apiKey ? encryptKey(apiKey) : current?.encryptedApiKey;
  const stored: StoredSettings = { ...settings, ...(encryptedApiKey ? { encryptedApiKey } : {}) };
  await prisma.systemConfig.upsert({
    where: { configKey: CONFIG_KEY },
    create: { configKey: CONFIG_KEY, configValue: JSON.stringify(stored), description: "AI 助手模型配置；密钥以 AES-256-GCM 加密保存" },
    update: { configValue: JSON.stringify(stored) }
  });
  return publicSettings({ ...settings, apiKey: encryptedApiKey ? "configured" : undefined });
}

const categorySchema = z.object({
  enabled: z.boolean(), prompt: z.string().trim().min(1).max(12000), environment: z.string().trim().max(20000),
  examples: z.array(z.string().trim().min(1).max(200)).max(8), version: z.number().int().min(0).optional()
});

function categoryValue(category: { id: string; name: string; enabled: boolean }, serialized?: string | null): AiCategoryConfigDto {
  const defaults = categoryDefaults(category.name);
  let config: Partial<StoredCategory> = {};
  if (serialized) {
    try {
      const candidate = JSON.parse(serialized);
      config = categorySchema.parse(candidate);
    } catch { throw new AppError(503, "AI_CATEGORY_CONFIG_INVALID", "分类 AI 配置格式无效，请联系管理员检查"); }
  }
  return { categoryId: category.id, categoryName: category.name, enabled: config.enabled ?? category.enabled,
    prompt: config.prompt ?? defaults.prompt, environment: config.environment ?? "", examples: config.examples ?? defaults.examples, version: config.version ?? 0 };
}

export async function getCategoryConfigs(prisma: PrismaClient = defaultPrisma): Promise<AiCategoryConfigDto[]> {
  const [categories, configs] = await Promise.all([
    prisma.ticketCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.systemConfig.findMany({ where: { configKey: { startsWith: CATEGORY_PREFIX } }, select: { configKey: true, configValue: true } })
  ]);
  const values = new Map(configs.map((config) => [config.configKey.slice(CATEGORY_PREFIX.length), config.configValue]));
  return categories.map((category) => categoryValue(category, values.get(category.id)));
}

export async function getCategoryConfig(categoryId: string, prisma: PrismaClient = defaultPrisma): Promise<AiCategoryConfigDto> {
  const category = await prisma.ticketCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "问题分类不存在");
  const row = await prisma.systemConfig.findUnique({ where: { configKey: CATEGORY_PREFIX + categoryId } });
  return categoryValue(category, row?.configValue);
}

export async function saveCategoryConfig(categoryId: string, input: unknown, user: UserWithRoles, prisma: PrismaClient = defaultPrisma): Promise<AiCategoryConfigDto> {
  requireRole(user, ["SUPER_ADMIN"]);
  const result = categorySchema.safeParse(input);
  if (!result.success) throw new AppError(400, "INVALID_AI_CATEGORY", "请填写有效的分类提示词、企业环境说明和示例问题");
  const category = await prisma.ticketCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "问题分类不存在");
  const configKey = CATEGORY_PREFIX + categoryId;
  const existing = await prisma.systemConfig.findUnique({ where: { configKey } });
  const before = categoryValue(category, existing?.configValue);
  if (result.data.version !== undefined && result.data.version !== before.version) throw new AppError(409, "AI_CONFIG_CHANGED", "分类规则已被更新，请刷新后再保存");
  const old = existing ? JSON.parse(existing.configValue) as StoredCategory : undefined;
  const revision = { version: before.version, prompt: before.prompt, environment: before.environment, examples: before.examples, enabled: before.enabled, changedAt: new Date().toISOString() };
  const stored: StoredCategory = { ...result.data, version: before.version + 1, updatedBy: user.dingtalkUserId, revisions: [...(old?.revisions || []).slice(-9), revision] };
  const configValue = JSON.stringify(stored);
  if (existing) {
    const saved = await prisma.systemConfig.updateMany({ where: { configKey, configValue: existing.configValue }, data: { configValue } });
    if (saved.count !== 1) throw new AppError(409, "AI_CONFIG_CHANGED", "分类规则已被更新，请刷新后再保存");
  } else {
    try { await prisma.systemConfig.create({ data: { configKey, configValue, description: `${category.name} AI 排查规则` } }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new AppError(409, "AI_CONFIG_CHANGED", "分类规则已被更新，请刷新后再保存");
      throw error;
    }
  }
  return categoryValue(category, configValue);
}
