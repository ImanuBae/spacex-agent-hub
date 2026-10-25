import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const catalogUrl = (process.env.CATALOG_API_URL || "http://127.0.0.1:4001").replace(/\/$/, "");
    return [{ source: "/api/v1/:path*", destination: `${catalogUrl}/api/v1/:path*` }];
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
