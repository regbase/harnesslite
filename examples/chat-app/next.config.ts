import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["fs-agent", "@fs-agent/supabase"],
  serverExternalPackages: [
    "just-bash",
    "bash-tool",
    // Optional native deps of just-bash; webpack must not parse .node binaries.
    "@mongodb-js/zstd",
    "node-liblzma",
  ],
  webpack: (config, { isServer }) => {
    // Next only finalizes serverExternalPackages for node_modules/*.js; optional
    // native addons resolve to *.node and still get parsed unless we externalize them.
    if (isServer) {
      const prev = config.externals;
      config.externals = [
        ...(Array.isArray(prev) ? prev : prev != null ? [prev] : []),
        (
          ctx: { request?: string },
          callback: (err?: Error | null, result?: string) => void,
        ) => {
          const request = ctx.request;
          if (!request) {
            callback();
            return;
          }
          if (
            request === "@mongodb-js/zstd" ||
            request.startsWith("@mongodb-js/zstd/")
          ) {
            callback(undefined, `commonjs ${request}`);
            return;
          }
          if (
            request.endsWith(".node") &&
            request.includes("mongodb-js") &&
            request.includes("zstd")
          ) {
            callback(undefined, `commonjs ${request}`);
            return;
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
