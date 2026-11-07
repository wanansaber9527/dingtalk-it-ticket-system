// 系统首页进入 AI 助手，提交工单仍保留独立入口。
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/ai-assistant");
}
