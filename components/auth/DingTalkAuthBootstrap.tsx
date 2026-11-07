"use client";

// 钉钉 H5 免登：每次挂载独立执行，离开页面会取消请求，失败后可明确重试。
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";

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
  interface Window { dd?: DingTalkJsApi }
}

const LEGACY_AUTHING_KEY = "itdesk_dingtalk_authing";
const DEFAULT_JSAPI_URL = "https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.41/dingtalk.open.js";
const AUTH_TIMEOUT_MS = 15_000;

function isDingTalkBrowser() {
  return /DingTalk/i.test(window.navigator.userAgent);
}

function abortError() {
  return new DOMException("登录请求已取消", "AbortError");
}

function loadScript(src: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    if (window.dd?.runtime?.permission?.requestAuthCode) { resolve(); return; }
    const url = new URL(src, document.baseURI).href;
    let script = Array.from(document.scripts).find((item) => item.src === url);
    if (script?.dataset.itdeskState === "failed" || script?.dataset.itdeskState === "loaded") {
      script.remove();
      script = undefined;
    }
    const created = !script;
    const element = script || document.createElement("script");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) {
        element.dataset.itdeskState = "failed";
        // 超时或取消后移除无效脚本，下一次重试不会等待已经错过的 load 事件。
        element.remove();
        reject(error);
      } else {
        element.dataset.itdeskState = "loaded";
        resolve();
      }
    };
    const onLoad = () => finish(window.dd?.runtime?.permission?.requestAuthCode ? undefined : new Error("钉钉登录组件未就绪，请重试"));
    const onError = () => finish(new Error("钉钉登录组件加载失败，请检查网络后重试"));
    const onAbort = () => finish(abortError());
    const timeout = setTimeout(() => finish(new Error("钉钉登录组件加载超时，请重试")), AUTH_TIMEOUT_MS);
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (created) {
      element.src = url;
      element.async = true;
      element.dataset.itdeskState = "loading";
      document.head.appendChild(element);
    }
  });
}

function requestAuthCode(corpId: string, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const api = window.dd;
    const permission = api?.runtime?.permission;
    if (!api || !permission?.requestAuthCode) { reject(new Error("当前钉钉版本不支持免登，请更新钉钉后重试")); return; }
    let settled = false;
    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(code!);
    };
    const onAbort = () => finish(abortError());
    const timeout = setTimeout(() => finish(new Error("钉钉登录授权超时，请重试")), AUTH_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      api.ready(() => {
        if (settled || signal.aborted) return;
        try {
          permission.requestAuthCode!({
            corpId,
            onSuccess: (result) => typeof result?.code === "string" && result.code.trim()
              ? finish(undefined, result.code)
              : finish(new Error("钉钉未返回有效登录授权，请重试")),
            onFail: () => finish(new Error("钉钉登录授权失败，请重试"))
          });
        } catch { finish(new Error("钉钉登录授权失败，请重试")); }
      });
      api.error?.(() => finish(new Error("钉钉登录初始化失败，请重试")));
    } catch { finish(new Error("钉钉登录初始化失败，请重试")); }
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal) {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, AUTH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch {
    if (signal.aborted) throw abortError();
    throw new Error(timedOut ? "登录请求超时，请重试" : "登录服务连接失败，请检查网络后重试");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function DingTalkAuthBootstrap() {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const corpId = process.env.NEXT_PUBLIC_DINGTALK_CORP_ID;
    if (!corpId || !isDingTalkBrowser() || window.location.pathname.startsWith("/api/")) return;
    const controller = new AbortController();
    busyRef.current = true;
    setBusy(true);
    // 旧版本的持久锁不再参与判断；刷新/崩溃留下的值不能阻断新登录。
    try { window.sessionStorage.removeItem(LEGACY_AUTHING_KEY); } catch { /* 浏览器禁用存储不影响登录 */ }

    async function bootstrap() {
      try {
        const currentUser = await fetchWithTimeout("/api/me", { credentials: "include" }, controller.signal);
        if (controller.signal.aborted) return;
        if (currentUser.ok) { setError(null); return; }
        if (currentUser.status !== 401) throw new Error(currentUser.status === 403 ? "当前账号不可用，请联系管理员" : "暂时无法检查登录状态，请重试");
        await loadScript(process.env.NEXT_PUBLIC_DINGTALK_JSAPI_URL || DEFAULT_JSAPI_URL, controller.signal);
        const code = await requestAuthCode(corpId!, controller.signal);
        const login = await fetchWithTimeout("/api/dingtalk/callback", {
          method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ code })
        }, controller.signal);
        if (!login.ok) throw new Error("钉钉免登失败，请重试");
        // 确认 cookie 已生效再刷新，避免 cookie 被阻止时不断换码和刷新。
        const verified = await fetchWithTimeout("/api/me", { credentials: "include" }, controller.signal);
        if (!verified.ok) throw new Error("登录信息未生效，请重试或联系管理员");
        if (!controller.signal.aborted) { setError(null); window.location.reload(); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "钉钉免登失败，请重试");
      } finally {
        if (!controller.signal.aborted) { busyRef.current = false; setBusy(false); }
      }
    }
    void bootstrap();
    return () => { controller.abort(); busyRef.current = false; };
  }, [attempt]);

  if (!error) return null;
  return <Alert banner type="error" showIcon message={error} action={
    <Button size="small" loading={busy} onClick={() => {
      if (busyRef.current) return;
      busyRef.current = true;
      setAttempt((value) => value + 1);
    }}>重试登录</Button>
  } />;
}
