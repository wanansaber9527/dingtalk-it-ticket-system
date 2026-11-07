"use client";

import { memo } from "react";
import { MarkdownBody } from "./MarkdownBody";
import styles from "./MessageContent.module.css";

export const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return <div className={styles.content}><MarkdownBody content={content} /></div>;
});
