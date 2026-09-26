import type { NextConfig } from "next";

const apiRewrite = process.env.API_REWRITE?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.trycloudflare.com", "*.loca.lt"],
  async rewrites() {
    if (!apiRewrite) return [];
    return [{ source: "/api/:path*", destination: `${apiRewrite}/api/:path*` }];
  },
};

export default nextConfig;
