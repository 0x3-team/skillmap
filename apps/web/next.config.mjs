import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(appDir, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // SkillMap does not use next/image. Keep the generic optimizer disabled so
    // direct /_next/image requests cannot reach Next's optional Sharp runtime.
    unoptimized: true
  },
  turbopack: {
    // Server-only web modules share contract and import-policy code with the
    // root package. Keep Turbopack's file boundary at the monorepo root so a
    // production build can package those imports without duplicating policy.
    root: repoDir
  }
};

export default nextConfig;
