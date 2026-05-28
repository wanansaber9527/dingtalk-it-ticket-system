"use client";

// 中文注释：员工端工单通用组件，复用移动端布局和状态展示。

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { BookOutlined, FormOutlined, ProfileOutlined, SettingOutlined, ToolOutlined } from "@ant-design/icons";
import { apiGet } from "@/src/lib/clientApi";
import { hasUserRole } from "@/src/lib/userRoles";

type CurrentUser = {
  roleAssignments: { role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN" }[];
};

const baseNav = [
  { href: "/tickets/new", label: "提交", icon: <FormOutlined /> },
  { href: "/tickets/my", label: "我的", icon: <ProfileOutlined /> },
  { href: "/knowledge-base", label: "知识库", icon: <BookOutlined /> }
];

function isDingTalkBrowser() {
  if (typeof navigator === "undefined") return false;
  return /DingTalk|AliApp\(DingTalk/i.test(navigator.userAgent);
}

export function EmployeeShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<CurrentUser | null>(null);

  useEffect(() => {
    apiGet<CurrentUser>("/api/me").then(setMe).catch(() => setMe(null));
  }, []);

  const nav = useMemo(() => {
    const items = [...baseNav];
    if (me && hasUserRole(me, ["IT_HANDLER"])) {
      items.push({ href: "/handler/tickets", label: "处理", icon: <ToolOutlined /> });
    }
    if (isDingTalkBrowser() && me && hasUserRole(me, ["SUPER_ADMIN"])) {
      items.push({ href: "/admin", label: "后台", icon: <SettingOutlined /> });
    }
    return items;
  }, [me]);

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <div>
          <div className="mobile-title">{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            趣然工单系统
          </div>
        </div>
      </header>
      <section className="mobile-content">{children}</section>
      <nav className="mobile-nav" style={{ "--nav-count": nav.length } as CSSProperties}>
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""}>
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
