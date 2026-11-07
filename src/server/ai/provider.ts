import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { AI_ASSISTANT_NAME, type AiSettings } from "@/src/lib/ai";
import { AppError } from "@/src/lib/http";

export type AiProviderContent = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type AiProviderMessage = { role: "system" | "user" | "assistant"; content: string | AiProviderContent[] };
export type AiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
export type AiCompletion = { content: string; model: string; usage: AiUsage };
export type AiCompletionOptions = { signal?: AbortSignal; onDelta?: (text: string) => void | Promise<void>; demo?: boolean };

export function buildProviderPayload(settings: AiSettings, messages: AiProviderMessage[]) {
  const host = parseProviderUrl(settings.baseUrl).hostname;
  return { model: settings.model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: settings.maxOutputTokens,
    temperature: settings.temperature, ...(host === "api.deepseek.com" ? { thinking: { type: "disabled" } } : {}) };
}

export function isLocalAiDemoAvailable() {
  return process.env.NODE_ENV === "development" && process.env.ITDESK_LOCAL_ISOLATED === "1" && process.env.DEV_AUTH_ENABLED === "true" && process.env.NEXT_PUBLIC_LOCAL_DEMO === "true" && process.env.AI_LOCAL_DEMO_ENABLED === "true";
}

export function isPrivateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0);
  }
  if (isIP(ip) === 6) {
    // 仅允许当前全球单播范围 2000::/3，保留/本地/IPv4 映射地址均不允许。
    const first = Number.parseInt(ip.split(":")[0], 16);
    return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff || /^2001:(?:db8|0|10|20)(?::|$)/.test(ip);
  }
  return true;
}

function fixtureAllowed(url: URL) {
  return isLocalAiDemoAvailable() && process.env.AI_ALLOW_LOCAL_FIXTURE === "true" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function isAllowedProviderAddress(url: URL, address: string) {
  if (!isPrivateAddress(address)) return true;
  if (fixtureAllowed(url)) return ["127.0.0.1", "::1"].includes(address);
  // 仅限本机隔离开发中的 TUN Fake-IP；显式允许的域名仍须通过正常 TLS 证书校验。
  const trustedHosts = (process.env.AI_TRUSTED_PROXY_HOSTS || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  return process.env.NODE_ENV === "development" && process.env.ITDESK_LOCAL_ISOLATED === "1" &&
    url.protocol === "https:" && (!url.port || url.port === "443") && trustedHosts.includes(url.hostname.toLowerCase()) &&
    isIP(address) === 4 && /^198\.(?:18|19)\./.test(address);
}

export function parseProviderUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, "INVALID_AI_URL", "请填写有效的模型 API 地址"); }
  const fixture = fixtureAllowed(url);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol !== "https:" && !(fixture && url.protocol === "http:")) || url.username || url.password || url.search || url.hash ||
    (!fixture && (host === "localhost" || /\.(localhost|local|internal|test|invalid)$/.test(host) || (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host))))) {
    throw new AppError(400, "INVALID_AI_URL", "模型 API 须使用不含凭据和查询参数的公网 HTTPS 地址");
  }
  url.pathname = /\/chat\/completions\/?$/.test(url.pathname) ? url.pathname.replace(/\/$/, "") : `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url;
}

async function providerAddress(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new AppError(502, "AI_DNS_FAILED", "无法解析模型服务地址，请检查 API 配置"); }
  if (!addresses.length || addresses.some((entry) => !isAllowedProviderAddress(url, entry.address))) {
    throw new AppError(400, "AI_PRIVATE_ADDRESS", "模型 API 地址不能指向本机、内网或保留地址");
  }
  return addresses.find((entry) => entry.family === 4) || addresses[0];
}

function publicUpstreamError(status: number) {
  if (status === 401 || status === 403) return new AppError(502, "AI_AUTH_FAILED", "模型服务认证失败，请联系管理员检查密钥或模型权限");
  if (status === 429 || status === 402) return new AppError(503, "AI_UPSTREAM_LIMIT", "模型服务额度不足或请求繁忙，请稍后重试，也可以直接提交工单");
  if (status >= 300 && status < 400) return new AppError(502, "AI_REDIRECT_REFUSED", "模型 API 返回重定向，请管理员配置最终 API 地址");
  if (status === 404) return new AppError(502, "AI_MODEL_NOT_FOUND", "模型或 API 路径不存在，请管理员检查配置");
  return new AppError(502, "AI_UPSTREAM_FAILED", "模型服务暂时无法回答，请稍后重试，也可以直接提交工单");
}

function tokenCount(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }

function readUsage(value: unknown): AiUsage {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const promptTokens = tokenCount(usage.prompt_tokens);
  const completionTokens = tokenCount(usage.completion_tokens);
  return { promptTokens, completionTokens, totalTokens: tokenCount(usage.total_tokens) || promptTokens + completionTokens };
}

function invalidResponse() { return new AppError(502, "AI_INVALID_RESPONSE", "模型服务返回了无法识别的回答，请稍后重试"); }

async function readCompletion(response: IncomingMessage, options: AiCompletionOptions, model: string, signal: AbortSignal): Promise<AiCompletion> {
  const stream = String(response.headers["content-type"] || "").includes("text/event-stream");
  if (!stream && !String(response.headers["content-type"] || "").includes("application/json")) throw invalidResponse();
  let buffer = "", eventLines: string[] = [], content = "", bytes = 0, complete = false;
  let usage: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const decoder = new TextDecoder();
  const add = async (value: unknown) => {
    if (typeof value !== "string" || !value) return;
    content += value;
    if (content.length > 128000) throw new AppError(502, "AI_RESPONSE_TOO_LARGE", "模型回答超过长度限制，请缩小问题范围后重试");
    await options.onDelta?.(value);
  };
  const processPayload = async (payload: string) => {
    if (payload === "[DONE]") { complete = true; return; }
    let data: Record<string, unknown>;
    try { data = JSON.parse(payload); } catch { throw invalidResponse(); }
    if (!data || typeof data !== "object" || data.error) throw invalidResponse();
    if (data.usage) usage = readUsage(data.usage);
    if (Array.isArray(data.choices) && data.choices.length) {
      const choice = data.choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown };
      await add(stream ? choice.delta?.content : choice.message?.content);
      if (choice.finish_reason) complete = true;
    }
  };
  const flushEvent = async () => {
    const payload = eventLines.join("\n"); eventLines = [];
    if (payload) await processPayload(payload);
  };
  for await (const raw of response) {
    if (signal.aborted) throw signal.reason;
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new AppError(502, "AI_RESPONSE_TOO_LARGE", "模型回答超过长度限制，请缩小问题范围后重试");
    buffer += decoder.decode(chunk, { stream: true });
    if (!stream) continue;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
      if (!line) await flushEvent();
      else if (line.startsWith("data:")) eventLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (buffer.length > 262144 || eventLines.join("").length > 262144) throw invalidResponse();
  }
  buffer += decoder.decode();
  if (stream) {
    if (buffer.startsWith("data:")) eventLines.push(buffer.slice(5).replace(/^ /, "").trimEnd());
    await flushEvent();
    if (!complete) throw new AppError(502, "AI_STREAM_INTERRUPTED", "模型回答连接中断，请重试或直接提交工单");
  } else { await processPayload(buffer); }
  if (!content.trim()) throw new AppError(502, "AI_EMPTY_RESPONSE", "模型未返回有效回答，请重试或直接提交工单");
  return { content, model, usage };
}

function textFromMessage(message: AiProviderMessage) {
  return typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

async function demoCompletion(messages: AiProviderMessage[], options: AiCompletionOptions): Promise<AiCompletion> {
  if (!isLocalAiDemoAvailable()) throw new AppError(403, "AI_DEMO_FORBIDDEN", "模拟回答仅限隔离的本地测试环境");
  const recent = messages.filter((message) => message.role === "user").at(-1);
  const text = recent ? textFromMessage(recent) : "";
  const hasImages = messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
  let content = `【本地模拟回答，未调用真实大模型】\n我是${AI_ASSISTANT_NAME}。`;
  if (/报修|工单|人工|还是不行|仍未解决/.test(text)) content += "\n可以点击下方“帮我提交工单”，我会整理这段对话中的故障描述和图片供你核对。确认提交成功后，页面会显示真实的本地测试工单编号。";
  else content += "\n请补充具体设备或系统、错误提示，以及你已尝试的操作。可以先检查问题是否只影响当前设备，再确认故障开始时间；涉及管理员权限或现场操作时可转工单。";
  if (hasImages) content += "\n你已附带图片；模拟模式不会识别图片内容，需配置支持图片的真实模型进行图片分析验收。";
  if (messages.some(message => message.role === "system" && textFromMessage(message).includes("<itdesk_suggestions>"))) {
    const handoff = /报修|工单|人工|还是不行|仍未解决/.test(text);
    const anchor = handoff ? "故障描述和图片" : "具体设备或系统、错误提示";
    const suggestions = handoff ? [
      { kind: "reply_template", anchor, text: "我的故障描述是【现象】，图片中的提示是【报错原文或无图片】。" },
      { kind: "help", anchor, text: "怎么整理故障描述和图片，方便处理人员判断？" }
    ] : [
      { kind: "reply_template", anchor, text: "我的设备或系统是【设备或系统】，错误提示是【报错原文】。" },
      { kind: "help", anchor, text: "怎么查看设备或系统的错误提示？" }
    ];
    content += `\n<itdesk_suggestions>${JSON.stringify({ stage: "collect", suggestions })}</itdesk_suggestions>`;
  }
  for (const part of content.match(/.{1,18}|\n/g) || []) {
    if (options.signal?.aborted) throw new AppError(499, "AI_CANCELLED", "回答已停止");
    await options.onDelta?.(part);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  return { content, model: "local-demo", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

export async function streamCompletion(settings: AiSettings, messages: AiProviderMessage[], options: AiCompletionOptions = {}): Promise<AiCompletion> {
  if (!settings.enabled) throw new AppError(503, "AI_DISABLED", "AI 助手暂未启用，你可以直接提交工单");
  if (options.demo) return demoCompletion(messages, options);
  if (!settings.apiKey?.trim() || !settings.baseUrl.trim() || !settings.model.trim()) throw new AppError(503, "AI_NOT_CONFIGURED", "AI 模型尚未配置，请联系管理员；你仍可以直接提交工单");
  if (!settings.supportsVision && messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))) {
    throw new AppError(400, "AI_VISION_UNAVAILABLE", "当前模型未启用图片理解，请描述截图中的报错或联系管理员配置图片模型");
  }
  const url = parseProviderUrl(settings.baseUrl);
  const controller = new AbortController();
  const onAbort = () => controller.abort(new AppError(499, "AI_CANCELLED", "回答已停止"));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timeout = setTimeout(() => controller.abort(new AppError(504, "AI_TIMEOUT", "模型回答超时，请重试或直接提交工单")), Math.min(180, Math.max(5, settings.timeoutSeconds)) * 1000);
  try {
    const address = await Promise.race([
      providerAddress(url),
      new Promise<never>((_, reject) => { if (controller.signal.aborted) reject(controller.signal.reason); else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }); })
    ]);
    if (controller.signal.aborted) throw controller.signal.reason;
    // 固定已检查的 DNS 地址，避免 DNS 重绑定；TLS SNI/证书校验仍使用原始主机名。
    const body = JSON.stringify(buildProviderPayload(settings, messages));
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(url, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", accept: "text/event-stream, application/json", authorization: `Bearer ${settings.apiKey}`, "content-length": Buffer.byteLength(body) },
        lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      }, resolve);
      request.on("error", reject);
      request.end(body);
    });
    try {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) throw publicUpstreamError(response.statusCode || 502);
      return await readCompletion(response, options, settings.model, controller.signal);
    } finally { response.destroy(); }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof AppError) throw error;
    throw new AppError(502, "AI_CONNECTION_FAILED", "无法连接模型服务，请稍后重试或联系管理员");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function testAiConnection(settings: AiSettings) {
  const started = Date.now();
  const result = await streamCompletion({ ...settings, enabled: true, maxOutputTokens: 128, timeoutSeconds: Math.min(settings.timeoutSeconds, 30) }, [
    { role: "system", content: `你是${AI_ASSISTANT_NAME}，请简短回答。` },
    { role: "user", content: "这是一条管理员连接测试，请只回复：连接成功。" }
  ]);
  return { success: true, model: result.model, latencyMs: Date.now() - started, usage: result.usage, message: "模型 API 连接成功" };
}
