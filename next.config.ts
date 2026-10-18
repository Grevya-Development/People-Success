import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Lets the E2E server (local Supabase) run beside the normal dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  serverExternalPackages: ["postgres"],
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
    // Document uploads go through Server Actions; files are capped at 25 MB server-side,
    // plus room for multipart overhead.
    serverActions: { bodySizeLimit: "26mb" },
    proxyClientMaxBodySize: "26mb",
  },
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
