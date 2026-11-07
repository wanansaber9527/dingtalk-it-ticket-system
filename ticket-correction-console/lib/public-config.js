function normalizeBasePath(value) {
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export const CORRECTION_BASE_PATH = normalizeBasePath(
  process.env.NEXT_PUBLIC_CORRECTION_BASE_PATH || "/ticket-correction-console"
);

export function withBasePath(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${CORRECTION_BASE_PATH}${path}`;
}
