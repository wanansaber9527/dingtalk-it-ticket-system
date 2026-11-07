import { getCurrentUser } from "@/src/server/auth";
import { AppError, fail, ok } from "@/src/lib/http";
import { AiService } from "@/src/server/services/aiService";
import { aiJson, checkAiMutationOrigin } from "@/src/server/ai/http";
import type { AiStreamEvent } from "@/src/lib/ai";
import { isLocalAiDemoAvailable } from "@/src/server/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type Context = { params: Promise<{ path?: string[] }> };
const missing = () => new AppError(404, "NOT_FOUND", "接口不存在");

async function handle(request: Request, context: Context) {
  try {
    checkAiMutationOrigin(request);
    const user = await getCurrentUser(request);
    const path = (await context.params).path || [];
    const method = request.method;
    const service = new AiService();
    const url = new URL(request.url);
    if (method === "GET" && path.join("/") === "bootstrap") return ok(await service.bootstrap(user));
    if (method === "GET" && path.join("/") === "ticket-context") return ok(await service.ticketContext(url.searchParams.get("ticketId") || "", user));
    if (path[0] !== "conversations") throw missing();
    if (path.length === 1 && method === "GET") return ok(await service.list(user, url.searchParams.get("q") || ""));
    if (path.length === 1 && method === "POST") return ok(await service.create(await aiJson(request), user), { status: 201 });
    const id = path[1];
    if (!id) throw missing();
    if (path.length === 2 && method === "GET") return ok(await service.detail(id, user));
    if (path.length === 2 && method === "PATCH") return ok(await service.update(id, await aiJson(request), user));
    if (path.length === 2 && method === "DELETE") return ok(await service.remove(id, user));
    if (path.length !== 3) throw missing();
    if (path[2] === "draft" && method === "POST") {
      const body = await aiJson(request) as { demo?: boolean };
      if (body.demo !== undefined && typeof body.demo !== "boolean") throw new AppError(400, "AI_INVALID_INPUT", "模拟模式参数无效");
      if (body.demo && !isLocalAiDemoAvailable()) throw new AppError(403, "AI_DEMO_FORBIDDEN", "模拟模式仅限本地测试");
      return ok(await service.createDraft(id, user, { demo: body.demo }));
    }
    if (path[2] === "draft" && method === "PUT") return ok(await service.updateDraft(id, await aiJson(request), user));
    if (path[2] === "submit" && method === "POST") return ok(await service.submit(id, await aiJson(request), user));
    if (path[2] !== "messages" || method !== "POST") throw missing();
    const prepared = await service.prepareMessage(id, await aiJson(request), user);
    const encoder = new TextEncoder();
    const abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const emit = (event: AiStreamEvent) => { if (!closed) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { closed = true; abort.abort(); } } };
        const heartbeat = setInterval(() => { if (!closed) { try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { closed = true; abort.abort(); } } }, 15000);
        void service.respond(prepared, emit, AbortSignal.any([request.signal, abort.signal])).catch(() => emit({ type: "error", message: "回答暂时中断，请刷新查看已保存的对话。" })).finally(() => { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } });
      },
      cancel() { abort.abort(); }
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", "connection": "keep-alive" } });
  } catch (error) { return fail(error); }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
