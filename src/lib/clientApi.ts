// 中文注释：通用基础库，封装 Prisma、HTTP 响应、标签映射和前端请求方法。
export async function apiGet<T>(url: string) {
  return apiRequest<T>(url);
}

export async function apiPost<T>(url: string, body?: unknown) {
  return apiRequest<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiPut<T>(url: string, body?: unknown) {
  return apiRequest<T>(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiDelete<T>(url: string) {
  return apiRequest<T>(url, {
    method: "DELETE"
  });
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.success) {
    throw new Error(json.message || "请求失败");
  }
  return json.data as T;
}
