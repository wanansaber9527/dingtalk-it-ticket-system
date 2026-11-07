// 历史附件链接直接复用鉴权读取，避免 HTTPS 反向代理下产生跨源内部 rewrite。
export { GET } from "@/app/api/uploads/[fileName]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
