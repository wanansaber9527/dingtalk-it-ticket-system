"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

// SSR 与首次 hydration 保持一致；浏览器接管后再预挂载依赖 Portal 的内容。
export function useClientReady() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
