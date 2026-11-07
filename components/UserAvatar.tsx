"use client";

import { useState, type CSSProperties } from "react";
import { Avatar, type AvatarProps } from "antd";
import { UserOutlined } from "@ant-design/icons";
import type { UserRole } from "@prisma/client";

// 与 /api/me 返回的身份字段保持一致，由页面布局统一加载当前用户。
export type UserIdentity = {
  id?: string;
  dingtalkUserId: string;
  name: string;
  avatar?: string | null;
  departmentName?: string | null;
  position?: string | null;
  roleAssignments: { role: UserRole }[];
};

export type UserAvatarProps = {
  user?: Pick<UserIdentity, "name" | "avatar"> | null;
  size?: AvatarProps["size"];
  className?: string;
  style?: CSSProperties;
};

function avatarSource(value?: string | null) {
  const source = value?.trim();
  if (!source) return undefined;
  if (source.startsWith("/") && !source.startsWith("//") && !source.includes("\\")) return source;
  try {
    const url = new URL(source);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function nameInitials(name: string) {
  if (!name) return "";
  if (/\p{Script=Han}/u.test(name)) return Array.from(name)[0];
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${Array.from(words[0])[0]}${Array.from(words[words.length - 1])[0]}`.toLocaleUpperCase();
  return Array.from(name).slice(0, 2).join("").toLocaleUpperCase();
}

export function UserAvatar({ user, size = 36, className, style }: UserAvatarProps) {
  const name = user?.name?.trim() || "";
  const source = avatarSource(user?.avatar);
  const [failedSource, setFailedSource] = useState<string>();
  const initials = nameInitials(name);
  const label = name ? `${name}的头像` : "用户头像";

  return (
    <span role="img" aria-label={label} title={name || undefined} style={{ display: "inline-flex", flexShrink: 0 }}>
      <Avatar
        size={size}
        src={source && source !== failedSource ? source : undefined}
        alt={label}
        className={["user-avatar", className].filter(Boolean).join(" ")}
        style={{ flexShrink: 0, fontWeight: 600, ...style }}
        icon={initials ? undefined : <UserOutlined aria-hidden="true" />}
        onError={() => { setFailedSource(source); return true; }}
      >
        {initials || undefined}
      </Avatar>
    </span>
  );
}
