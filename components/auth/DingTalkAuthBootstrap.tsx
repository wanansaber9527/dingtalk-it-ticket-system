"use client";

// 中文注释：钉钉 H5 免登引导组件，正式环境下自动换取免登 code 并写入登录 cookie。

import { useEffect } from "react";

type DingTalkJsApi = {
  ready: (callback: () => void) => void;
  error?: (callback: (error: unknown) => void) => void;
  runtime?: {
    permission?: {
      requestAuthCode?: (options: {
        corpId: string;
        onSuccess: (result: { code: string }) => void;
        onFail: (error: unknown) => void;
      }) => void;
    };
  };
};

declare global {
  interface Window {
    dd?: DingTalkJsApi;
  }
}

const AUTHING_KEY = "itdesk_dingtalk_authing";
const DEFAULT_JSAPI_URL = "https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.41/dingtalk.open.js";

function isDingTalkBrowser() {
  return /DingTalk/i.test(window.navigator.userAgent);
}

function loadScript(src: string) {
  // 中文注释：动态加载钉钉 JSAPI，避免普通浏览器访问时额外阻塞首屏。
  return new Promise<void>((resolve, reject) => {
    if (window.dd?.runtime?.permission?.requestAuthCode) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("钉钉 JSAPI 加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("钉钉 JSAPI 加载失败"));
    document.head.appendChild(script);
  });
}

function requestAuthCode(corpId: string) {
  return new Promise<string>((resolve, reject) => {
    const request = window.dd?.runtime?.permission?.requestAuthCode;
    if (!request) {
      reject(new Error("当前钉钉 JSAPI 不支持免登 code 获取"));
      return;
    }
    window.dd?.ready(() => {
      request({
        corpId,
        onSuccess: (result) => resolve(result.code),
        onFail: reject
      });
    });
    window.dd?.error?.(reject);
  });
}

export function DingTalkAuthBootstrap() {
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const corpId = process.env.NEXT_PUBLIC_DINGTALK_CORP_ID;
      if (!corpId || !isDingTalkBrowser() || window.location.pathname.startsWith("/api/")) return;

      const currentUser = await fetch("/api/me", { credentials: "include" });
      if (currentUser.ok || currentUser.status !== 401 || cancelled) return;
      if (window.sessionStorage.getItem(AUTHING_KEY) === "1") return;

      window.sessionStorage.setItem(AUTHING_KEY, "1");
      try {
        await loadScript(process.env.NEXT_PUBLIC_DINGTALK_JSAPI_URL || DEFAULT_JSAPI_URL);
        const code = await requestAuthCode(corpId);
        const login = await fetch("/api/dingtalk/callback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code })
        });
        if (!login.ok) throw new Error("钉钉免登失败");
        window.sessionStorage.removeItem(AUTHING_KEY);
        window.location.reload();
      } catch (error) {
        window.sessionStorage.removeItem(AUTHING_KEY);
        console.error(error);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
