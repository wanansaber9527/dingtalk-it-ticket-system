// 中文注释：系统首页入口，默认跳转到员工提交工单页面。
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/tickets/new");
}
