import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo root has its own lockfile (Electron app); pin file tracing to the
  // `web/` project so a standalone Docker build never pulls root artefacts.
  outputFileTracingRoot: process.cwd(),
  // Enable `standalone` output for the Docker/VPS deployment image.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // `@shared/*` maps to the repo-root `src/shared/` contract imported by both
  // the API (src/server) and this web app.
  turbopack: {
    resolveAlias: {
      "@shared": "../src/shared",
    },
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@shared": "../src/shared",
    };
    return config;
  },
};

export default nextConfig;
