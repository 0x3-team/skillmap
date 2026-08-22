import { defineCloudflareConfig, type OpenNextConfig } from "@opennextjs/cloudflare";

const config = {
  ...defineCloudflareConfig(),
  buildCommand: "node scripts/build-opennext.mjs"
} satisfies OpenNextConfig;

export default config;
