import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredBasePath = process.env.NEXT_PUBLIC_CORRECTION_BASE_PATH || "/ticket-correction-console";
const basePath = configuredBasePath === "/" ? "" : `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`;
const developmentScriptPolicy =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  developmentScriptPolicy,
  "style-src 'self' 'unsafe-inline'"
].join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  basePath,
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }
        ]
      }
    ];
  }
};

export default nextConfig;
