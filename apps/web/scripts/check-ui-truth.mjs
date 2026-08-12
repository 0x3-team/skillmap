import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sources = Object.fromEntries(
  await Promise.all(
    [
      "app/layout.tsx",
      "app/privacy/page.tsx",
      "app/release-status/page.tsx",
      "app/robots.ts",
      "app/security/page.tsx",
      "app/submit/page.tsx",
      "app/submit/submission-form.tsx",
      "app/support/page.tsx",
      "app/trust/auditing/page.tsx",
      "app/trust/grading/page.tsx",
      "components/skillmap/landing-page.tsx",
      "components/skillmap/dashboard-client.tsx",
      "components/skillmap/trust-page.tsx",
      "components/ui/number.tsx",
      "lib/supabase/database.runtime.types.ts",
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

const landing = sources["components/skillmap/landing-page.tsx"];
for (const boundary of [
  /action="\/skills" method="get"/i,
  /name="q"/i,
  /Free curated trust alpha · local candidate/i,
  /Free curated trust alpha · private pilot/i,
  /Free curated trust alpha · public alpha/i,
  /no billing, checkout, subscription, entitlement, paywall, or Stripe dependency/i,
  /recorded local fixture/i,
  /not live catalog data/i
]) {
  if (!boundary.test(landing)) failures.push(`components/skillmap/landing-page.tsx: missing homepage truth boundary ${boundary}`);
}

const support = sources["app/support/page.tsx"];
for (const boundary of [/locally validated free-account(?: (?:flow|spine)|, submission, evidence, and suspicious-listing report spine)/i, /no remote deployment.*response-time SLA/i, /Do not include raw prompts/i, /Never delete locks/i]) {
  if (!boundary.test(support)) failures.push(`app/support/page.tsx: missing support boundary ${boundary}`);
}

const privacy = sources["app/privacy/page.tsx"];
for (const boundary of [/application schema stores the authenticated account identifier/i, /Supabase Auth retains the account email, GitHub identity\/provider metadata, and session records/i, /No billing profile, payment method, entitlement, or Stripe record/i]) {
  if (!boundary.test(privacy)) failures.push(`app/privacy/page.tsx: missing hosted privacy boundary ${boundary}`);
}

const releaseStatus = sources["app/release-status/page.tsx"];
if (!/Supabase-backed public catalog/i.test(releaseStatus)) {
  failures.push("app/release-status/page.tsx: missing implemented hosted catalog boundary");
}

const releaseTitleBranches = /title=\{hosted\s*\?\s*`(?<hosted>[\s\S]*?)`\s*:\s*"(?<local>[^"]+)"\}/.exec(releaseStatus)?.groups;
const releaseIntroBranches = /intro=\{hosted\s*\?\s*`(?<hosted>[\s\S]*?)`\s*:\s*"(?<local>[^"]+)"\}/.exec(releaseStatus)?.groups;
const releaseDeploymentBranches = /<p>\{hosted\s*\?\s*"(?<hosted>[^"]+)"\s*:\s*"(?<local>[^"]+)"\}<\/p>/.exec(releaseStatus)?.groups;
if (!releaseTitleBranches || !releaseIntroBranches || !releaseDeploymentBranches) {
  failures.push("app/release-status/page.tsx: hosted and local release branches are not independently inspectable");
} else {
  for (const [branch, value, boundaries] of [
    ["hosted title", releaseTitleBranches.hosted, [/configured as a.*releaseStageLabel/i]],
    ["local title", releaseTitleBranches.local, [/validated locally and is not deployed/i]],
    ["hosted intro", releaseIntroBranches.hosted, [/operator deployment receipt remains the authority/i, /exact migration, OAuth, backup, and live-smoke state/i]],
    ["local intro", releaseIntroBranches.local, [/pushed, merged, and accepted by scoped remote CI/i, /No remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed/i]],
    ["hosted deployment", releaseDeploymentBranches.hosted, [/exact verified-live state belongs to a deployment receipt/i, /source merge\/CI receipts are not backup-retention, cross-account, worker, rollback, pilot, or indexing proof/i, /no billing, checkout, subscription, entitlement, metering, paywall, or Stripe dependency/i]],
    ["local deployment", releaseDeploymentBranches.local, [/Pushed source, a merge, local validation, and scoped remote CI are not deployment, live OAuth/i, /no billing, checkout, subscription, entitlement, metering, paywall, or Stripe dependency/i]]
  ]) {
    for (const boundary of boundaries) {
      if (!boundary.test(value)) failures.push(`app/release-status/page.tsx: missing ${branch} boundary ${boundary}`);
    }
  }
}

const robots = sources["app/robots.ts"];
for (const boundary of [/revalidate\s*=\s*0/, /isPublicIndexingEnabled\(\)/, /allow:\s*"\/"/, /disallow:\s*"\/"/]) {
  if (!boundary.test(robots)) failures.push(`app/robots.ts: missing runtime indexing boundary ${boundary}`);
}

for (const [file, boundaries] of Object.entries({
  "app/submit/page.tsx": [/does not execute repository content/i, /does not.*publish a listing.*current grade/i, /no billing/i],
  "app/submit/submission-form.tsx": [/Correct the highlighted field/i, /other entries and request ID remain/i, /aria-invalid/i, /operator review required/i, /no billing/i],
  "app/trust/auditing/page.tsx": [/seed versions remain marked not run/i, /No remote audit service/i, /does not follow instructions found in a skill/i],
  "app/trust/grading/page.tsx": [/seed versions remain ungraded/i, /no letter grade is presented/i, /popularity or payment/i]
})) {
  for (const boundary of boundaries) {
    if (!boundary.test(sources[file])) failures.push(`${file}: missing methodology truth boundary ${boundary}`);
  }
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

const databaseRuntimeTypes = sources["lib/supabase/database.runtime.types.ts"];
for (const boundary of [
  /Database as GeneratedDatabase.*database[.]types/,
  /Omit<GeneratedDatabase, "__InternalSupabase" \| "api" \| "private">/,
  /RuntimeDatabaseSchemaAssertion/,
  /type NullableFields/,
  /get_skill_submission_operator_detail/,
  /get_skill_submission_queue_summary/,
  /list_skill_submission_operator_queue/,
  /claimed_at/,
  /oldest_queued_at/,
  /audit_receipt/,
  /OperatorSubmissionDetailNonNullableJsonKey/,
  /ExpectedOperatorSubmissionQueueSummaryNullableKey/,
  /ExpectedOperatorSubmissionQueueNullableKey/,
  /ExpectedOperatorSubmissionDetailNullableKey/,
  /OperatorSubmissionExactNullabilityAssertions/,
  /NullableKeys<OperatorSubmissionQueueSummary>/,
  /NullableKeys<OperatorSubmissionQueueRow>/,
  /NullableKeys<OperatorSubmissionDetail>/,
  /NonNullableKeys<OperatorSubmissionQueueSummary>/,
  /NonNullableKeys<OperatorSubmissionQueueRow>/,
  /NonNullableKeys<OperatorSubmissionDetail>/
]) {
  if (!boundary.test(databaseRuntimeTypes)) {
    failures.push(`lib/supabase/database.runtime.types.ts: missing generated RPC nullability boundary ${boundary}`);
  }
}

if (failures.length > 0) {
  throw new Error(`UI truth contract failed:\n- ${failures.join("\n- ")}`);
}

console.log("UI truth contract passed");
