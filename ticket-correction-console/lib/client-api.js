import { withBasePath } from "./public-config.js";

export async function apiRequest(path, options = {}) {
  const response = await fetch(withBasePath(path), {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("服务返回了无法识别的响应");
  }

  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || "操作失败");
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload.data;
}
