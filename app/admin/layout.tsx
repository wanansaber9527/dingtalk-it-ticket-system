// 中文注释：管理员后台页面，展示和操作 IT 工单系统管理能力。
import { AdminShell } from "@/components/admin/AdminShell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
