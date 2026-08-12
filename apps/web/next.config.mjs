import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

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
    root: appDir
  }
};

export default nextConfig;
