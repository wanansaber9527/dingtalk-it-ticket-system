"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { RobotOutlined, FormOutlined, ProfileOutlined, SettingOutlined, ToolOutlined } from "@ant-design/icons";
import { apiGet } from "@/src/lib/clientApi";
import { hasUserRole } from "@/src/lib/userRoles";
import { LocalTestIdentity } from "@/components/LocalTestIdentity";
import { UserAvatar } from "@/components/UserAvatar";
import { ServiceMark } from "@/components/ServiceMark";

type CurrentUser = {
  name: string;
  avatar?: string | null;
  dingtalkUserId: string;
  departmentName?: string | null;
  roleAssignments: { role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN" }[];
};
const baseNav = [
  { href: "/ai-assistant", label: "AI 助手", mobileLabel: "AI 助手", icon: <RobotOutlined /> },
  { href: "/tickets/new", label: "提交工单", mobileLabel: "提交", icon: <FormOutlined /> },
  { href: "/tickets/my", label: "我的工单", mobileLabel: "我的", icon: <ProfileOutlined /> }
];
function isDingTalkBrowser() { return typeof navigator !== "undefined" && /DingTalk|AliApp\(DingTalk/i.test(navigator.userAgent); }

export function EmployeeShell({ title, children, hideHeading = false }: { title: string; children: React.ReactNode; hideHeading?: boolean }) {
  const pathname = usePathname();
  const [me, setMe] = useState<CurrentUser | null>(null);
  useEffect(() => { apiGet<CurrentUser>("/api/me").then(setMe).catch(() => setMe(null)); }, []);
  const nav = useMemo(() => {
    const items = [...baseNav];
    if (me && hasUserRole(me, ["IT_HANDLER"])) items.push({ href: "/handler/tickets", label: "处理工作台", mobileLabel: "处理", icon: <ToolOutlined /> });
    if ((isDingTalkBrowser() || process.env.NEXT_PUBLIC_LOCAL_DEMO === "true") && me && hasUserRole(me, ["SUPER_ADMIN"])) items.push({ href: "/admin", label: "管理后台", mobileLabel: "后台", icon: <SettingOutlined /> });
    return items;
  }, [me]);
  const isActive = (href: string) => pathname.startsWith(href) || (href === "/tickets/my" && /^\/tickets\/(?!new|my)[^/]+/.test(pathname));
  const narrow = pathname === "/tickets/new";
  const description = title === "提交工单" ? "描述遇到的问题，让我们为你提供支持。" : title === "处理工单" ? "集中跟进服务请求，及时响应每一个问题。" : title === "我的工单" ? "服务进度与处理记录，清晰可见。" : "描述问题，由趣然IT工单智能助手协助排查。";
  return <main className="mobile-shell employee-workspace">
    <header className="mobile-header">
      <div className="workspace-header-inner">
        <Link href="/ai-assistant" className="employee-brand"><ServiceMark /><strong>趣然工单系统</strong></Link>
        <nav className="employee-desktop-nav" aria-label="服务工作台导航">{nav.map(item => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} className={isActive(item.href) ? "active" : ""}>{item.label}</Link>)}</nav>
        <div className="employee-account"><LocalTestIdentity userId={me?.dingtalkUserId} /><div className="current-user"><UserAvatar user={me} size={34} /><div className="current-user-copy"><strong title={me?.name}>{me?.name || "正在加载"}</strong><span title={me?.departmentName || undefined}>{me?.departmentName || "IT 服务工作台"}</span></div></div></div>
      </div>
    </header>
    <section className={`mobile-content${narrow ? " page-narrow" : ""}`}>
      {!hideHeading && <div className="employee-page-heading"><div className="page-context">服务工作台<span>/</span>{title}</div><h1>{title}</h1><p>{description}</p></div>}
      {children}
    </section>
    <nav aria-label="员工移动导航" className="mobile-nav" style={{ "--nav-count": nav.length } as CSSProperties}>{nav.map(item => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} className={isActive(item.href) ? "active" : ""}>{item.icon}<span>{item.mobileLabel}</span></Link>)}</nav>
  </main>;
}
