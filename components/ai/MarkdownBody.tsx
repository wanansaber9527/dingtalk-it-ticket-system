import React from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function safeMarkdownUrl(value: string) {
  const safe = defaultUrlTransform(value);
  if (!safe || /[\u0000-\u0020\u007f\\]/.test(safe)) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(safe)) return safe;
  if (/^\/(?!\/)/.test(safe) || safe.startsWith("#")) return safe;
  return "";
}

const components: Components = {
  a: ({ href, children, title }) => {
    const safe = safeMarkdownUrl(href || "");
    return safe ? <a href={safe} title={title} target={safe.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a> : <span>{children}</span>;
  },
  // 图片仍使用受权限控制的附件组件。模型回复不能自动加载第三方图片。
  img: ({ alt }) => <span className="ai-markdown-image-label">{alt ? `［图片：${alt}］` : "［图片］"}</span>,
  table: ({ children }) => <div className="ai-markdown-table-scroll" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0} aria-label="代码块，可横向滚动">{children}</pre>,
};

/** Render untrusted model text as Markdown nodes; never interpret embedded HTML. */
export function MarkdownBody({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl} components={components}>{content}</Markdown>;
}
