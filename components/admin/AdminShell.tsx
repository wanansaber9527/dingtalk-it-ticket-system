"use client";

// 中文注释：管理员后台通用组件，承载后台导航和页面框架。

import {
  BellOutlined,
  BookOutlined,
  DashboardOutlined,
  FolderOutlined,
  FormOutlined,
  HomeOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { Layout, Menu, Result, Spin, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/src/lib/clientApi";
import { hasUserRole } from "@/src/lib/userRoles";

const { Sider, Content } = Layout;

type CurrentUser = {
  roleAssignments: { role: "EMPLOYEE" | "IT_HANDLER" | "SUPER_ADMIN" }[];
};

const items = [
  { key: "/admin", icon: <DashboardOutlined />, label: <Link href="/admin">首页看板</Link> },
  { key: "/admin/tickets", icon: <FormOutlined />, label: <Link href="/admin/tickets">工单管理</Link> },
  { key: "/admin/categories", icon: <FolderOutlined />, label: <Link href="/admin/categories">分类配置</Link> },
  { key: "/admin/knowledge-base", icon: <BookOutlined />, label: <Link href="/admin/knowledge-base">知识库</Link> },
  { key: "/admin/notifications", icon: <BellOutlined />, label: <Link href="/admin/notifications">通知记录</Link> },
  { key: "/admin/users", icon: <TeamOutlined />, label: <Link href="/admin/users">权限管理</Link> },
  { key: "/tickets/new", icon: <HomeOutlined />, label: <Link href="/tickets/new">员工端</Link> }
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

  useEffect(() => {
    apiGet<CurrentUser>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const isSuperAdmin = me ? hasUserRole(me, ["SUPER_ADMIN"]) : false;
  const isHandler = me ? hasUserRole(me, ["IT_HANDLER"]) : false;
  const visibleItems = isSuperAdmin ? items : items.filter((item) => ["/admin/tickets", "/tickets/new"].includes(item.key));
  const allowed = Boolean(isSuperAdmin || (isHandler && pathname.startsWith("/admin/tickets")));

  return (
    <Layout className="page-shell">
      <Sider width={236} className="admin-sider">
        <div className="admin-brand">
          <Typography.Text strong className="admin-brand-title">
            趣然工单系统
          </Typography.Text>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            管理后台
          </div>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey(pathname)]} items={visibleItems} style={{ borderInlineEnd: 0, paddingTop: 10 }} />
      </Sider>
      <Layout className="admin-main-layout">
        <Content className="admin-content">
          {loading ? (
            <div className="content-band" style={{ minHeight: 260, display: "grid", placeItems: "center" }}>
              <Spin />
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
