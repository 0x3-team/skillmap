import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sources = Object.fromEntries(
  await Promise.all(
    [
      "app/layout.tsx",
      "app/security/page.tsx",
      "app/support/page.tsx",
      "components/skillmap/landing-page.tsx",
      "components/skillmap/dashboard-client.tsx",
      "components/skillmap/trust-page.tsx",
      "components/ui/number.tsx",
      "scripts/browser-smoke.mjs"
    ].map(async (file) => [file, await readFile(join(appDir, file), "utf8")])
  )
);

const forbidden = [
  ["components/skillmap/landing-page.tsx", /on(?:Click|Select)\s*(?::|=)\s*(?:\{\s*)?\(\)\s*=>\s*undefined/, "clickable no-op"],
  ["components/skillmap/dashboard-client.tsx", /on(?:Click|Select|PromptChange)\s*(?::|=)\s*(?:\{\s*)?\(\)\s*=>\s*undefined/, "clickable no-op"],
  ["components/ui/number.tsx", /useMotionValue\(reduce\s*\?/, "render-time reduced-motion hydration branch"],
  ["app/layout.tsx", /Hosted Skill Intelligence/i, "unimplemented hosted product claim"],
  ["components/skillmap/landing-page.tsx", /A hosted service|Hosted skill registry|Hosted value|Teams can see/i, "present-tense hosted or team claim"],
  ["components/skillmap/dashboard-client.tsx", /Hosted SkillMap requests|Connector is \$\{/i, "live connector claim"]
];

const failures = [];
for (const [file, pattern, label] of forbidden) {
  if (pattern.test(sources[file])) failures.push(`${file}: ${label}`);
}

for (const engine of ["chromium", "firefox", "webkit"]) {
  if (!new RegExp(`\\b${engine}\\b`).test(sources["scripts/browser-smoke.mjs"])) {
    failures.push(`scripts/browser-smoke.mjs: missing ${engine} coverage`);
  }
}

if (!/recorded snapshot demo/i.test(sources["components/skillmap/dashboard-client.tsx"])) {
  failures.push("dashboard route interaction is not explicitly labeled as a recorded demo");
}

if (!/Snapshot source/.test(sources["components/skillmap/dashboard-client.tsx"])) {
  failures.push("dashboard has no visible mobile snapshot-source label");
}

for (const file of ["components/skillmap/landing-page.tsx", "components/skillmap/trust-page.tsx"]) {
  if (!/href="\/support"/.test(sources[file])) failures.push(`${file}: support route is missing from product-information navigation`);
}

const support = sources["app/support/page.tsx"];
for (const boundary of [/no hosted account/i, /no .*response-time SLA/i, /Do not include raw prompts/i, /Never delete locks/i]) {
  if (!boundary.test(support)) failures.push(`app/support/page.tsx: missing support boundary ${boundary}`);
}

const security = sources["app/security/page.tsx"];
for (const boundary of [
  /redirect fragment/i,
  /origin-scoped sessionStorage/i,
  /x-skillmap-capability/i,
  /x-skillmap-csrf/i,
  /credentials: omit/i,
  /exact loopback Host/i,
  /exact same Origin/i,
  /No permissive CORS headers/i,
  /Legacy skillmap_cap_\* and skillmap_csrf_\* cookies are rejected as authorization and selectively expired/i
]) {
  if (!boundary.test(security)) failures.push(`app/security/page.tsx: missing connector security boundary ${boundary}`);
}
for (const staleClaim of [/ephemeral capability cookie/i, /double-submit CSRF/i]) {
  if (staleClaim.test(security)) failures.push(`app/security/page.tsx: stale connector security claim ${staleClaim}`);
}

if (failures.length > 0) {
  throw new Error(`UI truth contract failed:\n- ${failures.join("\n- ")}`);
}

console.log("UI truth contract passed");
