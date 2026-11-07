"use client";

// 中文注释：管理员后台通用组件，承载后台导航和页面框架。

import {
  BellOutlined,
  RobotOutlined,
  DashboardOutlined,
  FolderOutlined,
  FormOutlined,
  HomeOutlined,
  TeamOutlined,
  MenuOutlined,
  ArrowRightOutlined
} from "@ant-design/icons";
import { Button, Drawer, Layout, Menu, Result, Skeleton } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/src/lib/clientApi";
import { hasUserRole } from "@/src/lib/userRoles";
import { UserAvatar } from "@/components/UserAvatar";
import { LocalTestIdentity } from "@/components/LocalTestIdentity";
import { ServiceMark } from "@/components/ServiceMark";

const { Sider, Content } = Layout;

type CurrentUser = {
  name: string;
  avatar?: string | null;
  dingtalkUserId: string;
  departmentName?: string;
  roleAssignments: { role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN" }[];
};

const items = [
  { key: "/admin", icon: <DashboardOutlined />, label: <Link href="/admin">首页看板</Link> },
  { key: "/admin/tickets", icon: <FormOutlined />, label: <Link href="/admin/tickets">工单管理</Link> },
  { key: "/admin/categories", icon: <FolderOutlined />, label: <Link href="/admin/categories">分类配置</Link> },
  { key: "/admin/ai-assistant", icon: <RobotOutlined />, label: <Link href="/admin/ai-assistant">大模型配置</Link> },
  { key: "/admin/notifications", icon: <BellOutlined />, label: <Link href="/admin/notifications">通知记录</Link> },
  { key: "/admin/users", icon: <TeamOutlined />, label: <Link href="/admin/users">人员与权限</Link> },
  { key: "/ai-assistant", icon: <HomeOutlined />, label: <Link href="/ai-assistant">员工端</Link> }
];

function selectedKey(pathname: string) {
  const match = [...items]
    .filter((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return match?.key || "/admin";
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    apiGet<CurrentUser>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const isSuperAdmin = me ? hasUserRole(me, ["SUPER_ADMIN"]) : false;
  const isHandler = me ? hasUserRole(me, ["IT_HANDLER"]) : false;
  const visibleItems = isSuperAdmin ? items : items.filter((item) => ["/admin/tickets", "/ai-assistant"].includes(item.key));
  const allowed = Boolean(isSuperAdmin || (isHandler && pathname.startsWith("/admin/tickets")));
  const brand = <div className="admin-brand"><ServiceMark /><div><strong>趣然工单系统</strong><span>IT SERVICE DESK</span></div></div>;
  const navigation = <Menu theme="light" mode="inline" selectedKeys={[selectedKey(pathname)]} items={visibleItems} onClick={() => setMenuOpen(false)} />;

  return (
    <Layout className="page-shell">
      <Sider width={232} className="admin-sider">
        {brand}
        <div className="nav-section-label">服务管理</div>
        {navigation}
        <div className="sidebar-footer"><div className="sidebar-caption">企业 IT 服务</div><Link href="/tickets/new">提交新的服务请求 <ArrowRightOutlined /></Link></div>
      </Sider>
      <Drawer className="mobile-admin-drawer" title={brand} placement="left" open={menuOpen} onClose={() => setMenuOpen(false)} width={280}>{navigation}</Drawer>
      <Layout className="admin-main-layout">
        <header className="admin-topbar">
          <div className="topbar-location"><Button type="text" className="mobile-menu-button" aria-label="打开导航" icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} /><span>工作空间</span><span className="breadcrumb-separator">/</span><strong>{pathname === "/admin" ? "首页看板" : pathname === "/admin/users/sync-logs" ? "人员同步日志" : pathname.startsWith("/admin/tickets/") ? "工单详情" : items.find((item) => item.key === selectedKey(pathname))?.label}</strong></div>
          <div className="topbar-account"><LocalTestIdentity userId={me?.dingtalkUserId} /><div className="current-user"><UserAvatar size={38} user={me} /><div className="current-user-copy"><strong title={me?.name}>{me?.name || "正在加载"}</strong><span title={me?.departmentName || undefined}>{me?.departmentName || (isSuperAdmin ? "系统管理员" : "处理工作台")}</span></div></div></div>
        </header>
        <Content className="admin-content">
          {loading ? (
            <div className="content-band" style={{ minHeight: 260 }}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </div>
          ) : allowed ? (
            children
          ) : (
            <div className="content-band">
              <Result status="403" title="无管理员权限，禁止访问后台。" subTitle="请联系超级管理员开通后台权限。" />
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
