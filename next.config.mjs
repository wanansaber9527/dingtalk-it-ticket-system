// 中文注释：Next.js 运行配置，当前保持轻量配置以便本地和部署环境共用。
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  serverExternalPackages: ["sharp", "heic-decode", "libheif-js", "bmp-js"],
  distDir: process.env.LOCAL_NEXT_DIST_DIR || ".next",
  // 附件通过带权限校验的接口展示，禁用独立图片优化入口。
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  }
};

export default nextConfig;
