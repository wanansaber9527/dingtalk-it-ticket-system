"use client";

import React from "react";
import { ArrowUpOutlined } from "@ant-design/icons";

const COMPOSER_LIMIT = 12000;

function isReplyTemplate(text: string) {
  return /【[^【】\r\n]+】/.test(text);
}

export function appendFollowupSuggestion(current: string, suggestion: string): string | null {
  const text = suggestion.trim();
  if (!text) return null;
  const next = current ? `${current}${current.endsWith("\n") ? "" : "\n"}${text}` : text;
  return next.length <= COMPOSER_LIMIT ? next : null;
}

export function FollowupSuggestions({ role, status, suggestions, disabled, onSelect }: {
  role: string;
  status: string;
  suggestions?: readonly string[];
  disabled: boolean;
  onSelect: (suggestion: string) => void;
}) {
  if (role !== "assistant" || status !== "COMPLETE" || !Array.isArray(suggestions) || suggestions.length !== 2 || suggestions.some((item) => typeof item !== "string" || !item.trim())) return null;
  const hasTemplate = suggestions.some(isReplyTemplate);
  return <div className="ai-followup-suggestions" role="group" aria-label="本条回答的继续对话建议">
    <p>你可以这样继续<span>{hasTemplate ? "点击填入 · 填写【…】后发送" : "点击填入"}</span></p>
    {suggestions.map((suggestion, index) => <button
      key={`${index}-${suggestion}`}
      type="button"
      disabled={disabled}
      aria-label={`将建议填入输入框：${suggestion}${isReplyTemplate(suggestion) ? "；请填写【…】中的内容后再发送" : ""}`}
      title={isReplyTemplate(suggestion) ? "填入输入框，填写【…】后自行发送" : "填入输入框，不会自动发送"}
      onClick={() => { if (!disabled) onSelect(suggestion); }}
    ><ArrowUpOutlined aria-hidden="true" /><span>{suggestion}</span></button>)}
  </div>;
}
