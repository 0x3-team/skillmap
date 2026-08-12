import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  AuthApiError,
  AuthError,
  AuthInvalidJwtError,
  AuthSessionMissingError
} from "@supabase/supabase-js";
import {
  classifyVerifiedClaims,
  shouldRedirectForAuthError
} from "../lib/auth/errors.ts";
import { safeNextPath } from "../lib/auth/paths.ts";
import {
  APPROVED_ALPHA_SPDX_IDENTIFIERS,
  parseSkillSubmissionForm,
  SubmissionValidationError
} from "../lib/submissions/input.ts";
import {
  submissionListStatusPath,
  submitStatusPath
} from "../lib/submissions/status.ts";
import {
  decodeSubmissionCursor,
  encodeSubmissionCursor,
  SubmissionCursorError
} from "../lib/submissions/cursor.ts";
import {
  parseSkillReportForm,
  ReportValidationError
} from "../lib/reports/input.ts";
import {
  reportStatusPath
} from "../lib/reports/status.ts";
import {
  createReportFlash,
  parseReportFlash,
  serializeReportFlash
} from "../lib/reports/flash.ts";
import {
  createSaveFlash,
  parseSaveFlash,
  serializeSaveFlash
} from "../lib/registry/save-flash.ts";
import {
  createAccountDeletionFlash,
  parseAccountDeletionFlash,
  serializeAccountDeletionFlash
} from "../lib/account/deletion-flash.ts";
import {
  decodeReportCursor,
  encodeReportCursor,
  ReportCursorError
} from "../lib/reports/cursor.ts";
import {
  parseDimensions,
  parseFindingCounts,
  gradeCompatibilityBindingIsValid,
  parseHardGates,
  parseNullableBoundedNumber,
  parseNullableDigest,
  parsePublicChecks
} from "../lib/evidence/projection.ts";
import {
  SupabaseConfigurationError,
  getPublicSupabaseConfig,
  getSiteUrl
} from "../lib/supabase/config.ts";
import { assertHostedReleaseConfiguration } from "../scripts/check-hosted-release-config.mts";
import {
  SavedSkillsCursorError,
  canonicalizeUtcTimestamp,
  decodeSavedSkillsCursor,
  encodeSavedSkillsCursor
} from "../lib/registry/saved-cursor.ts";
import {
  assertPublicSkillRelationshipLimit,
  CatalogDataError,
  CatalogInputError,
  CatalogQueryError,
  MAX_PUBLIC_SKILL_RELATIONSHIPS
} from "../lib/registry/errors.ts";
import {
  buildCurrentPublicSkillLinks,
  buildExactGitHubSourceUrl
} from "../lib/registry/public-links.ts";
import {
  CatalogFetchAbortError,
  createBoundedCatalogFetch
} from "../lib/security/bounded-fetch.ts";
import {
  PRIVATE_ALPHA_ROBOTS_VALUE,
  buildContentSecurityPolicy,
  buildResponseSecurityHeaders,
  getApprovedSupportUrl,
  getReleaseStage,
  getSupabaseConnectSources,
  isHostedReleaseStage,
  isPublicIndexingEnabled,
  releaseStageLabel
} from "../lib/security/policy.ts";
import { classifyPublicCatalogFailure } from "../lib/security/public-catalog-errors.ts";
import {
  applyRetryAfterHeader,
  getDeviceAuthSourceIdentity,
  InMemoryFixedWindowRateLimiter,
  applyRateLimitHeaders,
  getAnonymousClientIdentity,
  getAnonymousClientKey,
  isValidIpAddress,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest,
  isPublicDeviceAuthInitiationRequest,
  PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY
} from "../lib/security/rate-limit.ts";
import { gateDeviceAuthRequest } from "../cloudflare/device-auth-edge-gate.ts";
import {
  HOSTED_API_ERROR_SCHEMA_ID,
  validateHostedApiErrorResponse
} from "../lib/contracts/generated/hosted-api-response-validator.ts";
import { createHostedApiErrorPayload } from "../lib/contracts/hosted-api-response.ts";

const APP_ORIGIN = "https://skillmap.invalid";
const SKILL_ID = `skl_${"0".repeat(31)}1`;

test("Next 16 hosted request boundary has one Edge middleware surface and preserves API protection", async () => {
  const proxyUrl = new URL("../proxy.ts", import.meta.url);
  const middlewareUrl = new URL("../middleware.ts", import.meta.url);
  await assert.rejects(() => access(proxyUrl), /ENOENT/);
  const middleware = await readFile(middlewareUrl, "utf8");
  assert.match(middleware, /export async function middleware\(request: NextRequest\)/);
  assert.doesNotMatch(middleware, /export\s+(?:async\s+)?function\s+proxy\b/);
  assert.match(
    middleware,
    /matcher:\s*\["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\|\.\*\\\\\.\(\?:svg\|png\|jpg\|jpeg\|gif\|webp\)\$\)\.\*\)"\]/
  );
  assert.match(middleware, /catalogError\(\s*429,\s*"RATE_LIMITED",\s*"Too many catalog requests\. Try again shortly\.",\s*true\s*\)/s);
  assert.doesNotMatch(middleware, /NextResponse\.json\(/);
  assert.match(middleware, /applyRateLimitHeaders\(response, decision\)/);
  assert.match(middleware, /applyRetryAfterHeader\(response, decision\)/);
  assert.match(middleware, /Cache-Control.*private, no-store, max-age=0/);
  assert.match(middleware, /createServerClient<Database>/);
  assert.match(middleware, /supabase\.auth\.getClaims\(\)/);
  assert.match(middleware, /buildContentSecurityPolicy/);
  assert.match(middleware, /buildResponseSecurityHeaders/);
  assert.match(middleware, /crypto\.subtle\.digest/);
  assert.match(middleware, /rate-limit-core/);
  assert.match(middleware, /isPublicDeviceAuthInitiationRequest/);
  assert.match(middleware, /readDeviceAuthEdgeDecision/);
  assert.doesNotMatch(middleware, /publicDeviceAuthInitiationLimiter/);
  assert.ok(
    middleware.indexOf("readDeviceAuthEdgeDecision(request.headers)")
      < middleware.indexOf("let response = createPassthroughResponse(request, nonce, contentSecurityPolicy)"),
    "the edge source decision must be read before the request reaches the downstream route"
  );
  assert.match(middleware, /createHostedApiErrorPayload/);
  assert.doesNotMatch(middleware, /@\/lib\/registry\/api\.server/);
  assert.doesNotMatch(middleware, /node:(?:crypto|net)|Ajv2020|new Function|\beval\s*\(/);
  assert.doesNotMatch(middleware, /(?:writeFile|mkdir|rename|unlink|rmSync|execFile|spawn)\s*\(/);
  const workerEntry = await readFile(new URL("../cloudflare-worker.ts", import.meta.url), "utf8");
  assert.match(workerEntry, /gateDeviceAuthRequest/);
  assert.match(workerEntry, /import \{ DurableObject \} from "cloudflare:workers"/);
  assert.match(workerEntry, /export class DeviceAuthIpRateLimiter extends DurableObject/);
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"main":\s*"cloudflare-worker\.ts"/);
  assert.match(wrangler, /"DEVICE_AUTH_IP_RATE_LIMITER"/);
  assert.match(wrangler, /"new_sqlite_classes":\s*\["DeviceAuthIpRateLimiter"\]/);
});

test("hosted runtime disables the unused Next image optimizer", async () => {
  const config = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /images:\s*\{\s*[\s\S]*?unoptimized:\s*true\s*[\s\S]*?\}/);

  const sourceUrls = [
    ...await collectTsxFiles(new URL("../app/", import.meta.url)),
    ...await collectTsxFiles(new URL("../components/", import.meta.url))
  ];
  for (const sourceUrl of sourceUrls) {
    const source = await readFile(sourceUrl, "utf8");
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]next\/image['"]/, `${sourceUrl.pathname} re-enables the disabled optimizer boundary`);
  }
});

test("streaming fallback announces without creating a second main landmark", async () => {
  const source = await readFile(new URL("../app/loading.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<main\b/);
  assert.match(source, /id="main-content"/);
  assert.match(source, /tabIndex=\{-1\}/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /aria-busy=/);
});

test("hosted routes share one keyboard skip target across every main outcome", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const skipLink = await readFile(new URL("../components/skillmap/hosted-skip-link.tsx", import.meta.url), "utf8");
  assert.match(layout, /import \{ HostedSkipLink \}/);
  assert.match(layout, /<HostedSkipLink \/>/);
  assert.match(skipLink, /href="#main-content"/);
  assert.match(skipLink, />\s*Skip to main content\s*</);
  assert.match(skipLink, /focus:translate-y-0/);

  const sourceUrls = [
    ...await collectTsxFiles(new URL("../app/", import.meta.url)),
    ...await collectTsxFiles(new URL("../components/", import.meta.url))
  ];
  let mainCount = 0;
  for (const sourceUrl of sourceUrls) {
    const source = await readFile(sourceUrl, "utf8");
    for (const opening of source.match(/<main\b[^>]*>/g) ?? []) {
      mainCount += 1;
      assert.match(opening, /\bid="main-content"/, `${sourceUrl.pathname} has a main without the hosted target ID`);
      assert.match(opening, /\btabIndex=\{-1\}/, `${sourceUrl.pathname} has a main that cannot receive skip-link focus`);
    }
  }
  assert.ok(mainCount >= 20, `Hosted main coverage unexpectedly shrank to ${mainCount} outcomes.`);
});

test("hosted home exposes a truthful account control below the sm breakpoint", async () => {
  const source = await readFile(new URL("../components/skillmap/landing-page.tsx", import.meta.url), "utf8");
  const unavailableOpening = source.match(/<span data-account-control="unavailable"[^>]*>/)?.[0];
  const accountOpening = source.match(/<Link data-account-control=\{accountState\}[^>]*>/)?.[0];
  assert.ok(unavailableOpening, "Hosted home omitted its unavailable account state.");
  assert.match(unavailableOpening, /role="status"/);
  assert.match(unavailableOpening, /aria-live="polite"/);
  assert.ok(accountOpening, "Hosted home omitted its direct account or sign-in action.");
  assert.match(unavailableOpening, /className="inline-flex/);
  assert.doesNotMatch(unavailableOpening, /className="[^"]*\bhidden\b/);
  assert.match(accountOpening, /className="inline-flex/);
  assert.doesNotMatch(accountOpening, /className="[^"]*\bhidden\b/);
  assert.match(source, /accountState === "authenticated" \? "Account" : "Sign in"/);
  assert.match(source, />Account unavailable<\/span>/);
});

test("public catalog, privacy, and security pages publish route-specific metadata", async () => {
  for (const [relativePath, canonicalPath, title] of [
    ["../app/skills/page.tsx", "/skills", "Skill library | SkillMap"],
    ["../app/privacy/page.tsx", "/privacy", "Privacy | SkillMap"],
    ["../app/security/page.tsx", "/security", "Security | SkillMap"]
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /buildPublicPageMetadata\(\{/);
    assert.match(source, new RegExp(`title: "${title.replace(/[|]/g, "\\|")}"`));
    assert.match(source, new RegExp(`path: "${canonicalPath}"`));
    assert.match(source, /description: "[^"\n]{40,}"/);
  }
  const privacy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(privacy, /title="Know what stays local and what the hosted service stores[.]"/);
  assert.match(privacy, /Hosted accounts, saves, submissions, and private reports cross a separate, explicitly disclosed service boundary[.]/);
  assert.doesNotMatch(privacy, /title="Private input stays local by default[.]"/);
});

test("safe next paths remain same-origin after URL normalization", () => {
  const valid = "/skills/0x3-team/skill-audit?q=quality#evidence";
  assert.equal(safeNextPath(valid), valid);
  assert.equal(new URL(safeNextPath(valid), APP_ORIGIN).origin, APP_ORIGIN);

  for (const hostile of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/%5cevil.example/",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2e%2e//evil.example",
    "/a/%2e%2e//evil.example",
    "/%"
  ]) {
    const sanitized = safeNextPath(hostile);
    assert.equal(sanitized, "/account", hostile);
    assert.equal(new URL(sanitized, APP_ORIGIN).origin, APP_ORIGIN, hostile);
  }
  assert.equal(safeNextPath("https://evil.example/", "https://evil.example/"), "/account");
});

test("submission input admits one exact canonical public-source intent", () => {
  const form = validSubmissionForm();
  form.set("state", "published");
  form.set("submitter_user_id", "attacker-controlled");
  assert.deepEqual(parseSkillSubmissionForm(form), {
    repository_url: "https://github.com/0x3-team/skillmap",
    source_commit: "a".repeat(40),
    source_path: "skills/example/SKILL.md",
    version_label: "v1.0.0",
    license_claim: "MIT",
    idempotency_key: "123e4567-e89b-42d3-a456-426614174000"
  });
  assert.equal(APPROVED_ALPHA_SPDX_IDENTIFIERS.includes("MIT"), true);
  assert.equal(APPROVED_ALPHA_SPDX_IDENTIFIERS.includes("Definitely-Not-SPDX"), false);
});

test("submission input rejects mutable, ambiguous, duplicated, and unacknowledged values before mutation", () => {
  const cases = [
    ["repositoryUrl", (form) => form.set("repositoryUrl", "https://github.com/0x3-team/SkillMap")],
    ["repositoryUrl", (form) => form.set("repositoryUrl", "https://github.com/0x3-team/skillmap.git")],
    ["repositoryUrl", (form) => form.set("repositoryUrl", "https://github.com/0x3-team/skillmap?ref=main")],
    ["sourceCommit", (form) => form.set("sourceCommit", "main")],
    ["sourcePath", (form) => form.set("sourcePath", "../SKILL.md")],
    ["sourcePath", (form) => form.set("sourcePath", "skills//SKILL.md")],
    ["licenseClaim", (form) => form.set("licenseClaim", "MIT OR Apache-2.0")],
    ["idempotencyKey", (form) => form.set("idempotencyKey", "not-a-uuid")],
    ["authorizationAcknowledgement", (form) => form.delete("authorizationAcknowledgement")],
    ["untrustedContentAcknowledgement", (form) => form.delete("untrustedContentAcknowledgement")],
    ["sourceCommit", (form) => form.append("sourceCommit", "b".repeat(40))]
  ];
  for (const [field, mutate] of cases) {
    const form = validSubmissionForm();
    mutate(form);
    assert.throws(
      () => parseSkillSubmissionForm(form),
      (error) => error instanceof SubmissionValidationError && error.field === field,
      field
    );
  }
});

test("submission redirect builders emit bounded same-origin statuses only", () => {
  assert.equal(
    submitStatusPath("invalid", { field: "sourceCommit", submissionId: "javascript:alert(1)" }),
    "/submit?status=invalid&field=sourceCommit"
  );
  assert.equal(
    submissionListStatusPath("queued", `sub_${"a".repeat(32)}`),
    `/account/submissions?status=queued&submission=sub_${"a".repeat(32)}`
  );
});

test("submission pagination cursors are canonical, bounded, and account-free", () => {
  const cursor = encodeSubmissionCursor({
    createdAt: "2026-07-12T22:30:00.123456+00:00",
    submissionId: `sub_${"a".repeat(32)}`
  });
  assert.deepEqual(decodeSubmissionCursor(cursor), {
    kind: "skill-submissions",
    v: 1,
    createdAt: "2026-07-12T22:30:00.123456Z",
    submissionId: `sub_${"a".repeat(32)}`
  });
  assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /user|email|account/i);
  for (const malformed of ["not+a+cursor", "a".repeat(513), "e30"]) {
    assert.throws(() => decodeSubmissionCursor(malformed), SubmissionCursorError);
  }
});

test("submission server action mints attestations only after acknowledgement validation", async () => {
  const source = await readFile(new URL("../app/submit/actions.ts", import.meta.url), "utf8");
  const formSource = await readFile(new URL("../app/submit/submission-form.tsx", import.meta.url), "utf8");
  assert.match(source, /parseSkillSubmissionForm\(formData\)/);
  assert.match(source, /return \{ status: "invalid", field: error[.]field, message: error[.]message \}/);
  assert.match(source, /submission_policy_version:\s*"public-alpha-draft\/v1"/);
  assert.match(source, /authority_confirmed:\s*true/);
  assert.match(source, /untrusted_processing_accepted:\s*true/);
  assert.doesNotMatch(source, /submitter_user_id\s*:/);
  assert.doesNotMatch(source, /\bstate\s*:\s*"(?:queued|processing|withdrawn)"/);
  assert.match(source, /if \(error[.]code === "P0001"\) \{\s*return \{\s*status: "quota"/);
  assert.doesNotMatch(source, /if \(error[.]code === "P0001"\) redirect/);
  assert.match(source, /context[.]state === "unavailable"[\s\S]*status: "auth-unavailable"/);
  assert.match(formSource, /event[.]preventDefault\(\)/);
  assert.match(formSource, /new FormData\(form\)/);
  assert.match(formSource, /setValidation\(result\)/);
  assert.match(formSource, /import \{ unstable_rethrow \} from "next\/navigation"/);
  assert.match(formSource, /catch \(error\) \{\s*unstable_rethrow\(error\);\s*setValidation\(/);
  assert.match(formSource, /status: "service-unavailable"/);
  assert.match(formSource, /finally \{\s*setPending\(false\)/);
  assert.match(formSource, /noticeRef[.]current[?][.]focus\(\)/);
  assert.match(formSource, /Your other entries and request ID remain in this form/);
  assert.match(formSource, /Your entries and request ID remain in this form so you can retry safely/);
  assert.match(formSource, /Submission quota reached/);
  assert.match(formSource, /Authentication could not be verified/);
  assert.match(formSource, /value=\{requestId\}/);
  assert.match(formSource, /aria-invalid=\{Boolean\(errorFor\("sourcePath"\)\)\}/);
});

test("public source and owner-result links stay exact, encoded, and current-version bound", () => {
  const commit = "a".repeat(40);
  assert.equal(
    buildExactGitHubSourceUrl({
      repositoryUrl: "https://github.com/0x3-team/skillmap",
      commit,
      path: "skills/example skill/SKILL.md"
    }),
    `https://github.com/0x3-team/skillmap/blob/${commit}/skills/example%20skill/SKILL.md`
  );
  for (const source of [
    { repositoryUrl: "https://user@github.com/0x3-team/skillmap", commit, path: "SKILL.md" },
    { repositoryUrl: "https://github.com/0x3-team/skillmap?ref=main", commit, path: "SKILL.md" },
    { repositoryUrl: "https://github.com/0x3-team/skillmap", commit: "main", path: "SKILL.md" },
    { repositoryUrl: "https://github.com/0x3-team/skillmap", commit, path: "../SKILL.md" }
  ]) assert.equal(buildExactGitHubSourceUrl(source), null);

  const versionId = `skv_${"b".repeat(32)}`;
  const route = { publisherHandle: "0x3-team", slug: "skill-audit", versionId };
  assert.deepEqual(buildCurrentPublicSkillLinks(route, versionId), {
    detail: "/skills/0x3-team/skill-audit",
    audit: "/skills/0x3-team/skill-audit/audit",
    grade: "/skills/0x3-team/skill-audit/grade"
  });
  assert.equal(buildCurrentPublicSkillLinks(route, `skv_${"c".repeat(32)}`), null);
  assert.equal(buildCurrentPublicSkillLinks({ ...route, publisherHandle: "../owner" }, versionId), null);
});

test("hosted product surfaces expose truthful trust, route, auth, and semantic evidence affordances", async () => {
  const [catalog, detail, submissions, reports, evidence, header, landing, gettingStarted] = await Promise.all([
    readFile(new URL("../app/skills/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/skills/[publisher]/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/submissions/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/reports/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/public-evidence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/catalog-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/landing-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/getting-started/page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(catalog, /Catalog size and evidence state reflect the current environment/);
  assert.doesNotMatch(catalog, /first-party seed set/i);
  assert.match(detail, /buildExactGitHubSourceUrl\(skill[.]source\)/);
  assert.match(detail, /skill[.]source[.]path/);
  assert.match(detail, /skill[.]publisher[.]verificationState/);
  assert.match(detail, /skill[.]lifecycleState/);
  assert.match(detail, /skill[.]currentVersion[.]publishedAt/);
  assert.match(detail, /skill[.]updatedAt/);
  assert.match(detail, /Freshness signals/);
  assert.match(detail, /does not calculate an automatic fresh or current verdict from elapsed time/);
  assert.match(detail, /skill[.]currentVersion[.]grade[.]receipt[.]gradedAt/);
  assert.match(detail, /View exact source at commit/);
  assert.match(submissions, /buildCurrentPublicSkillLinks/);
  assert.match(submissions, /View published listing/);
  assert.match(submissions, /View audit evidence/);
  assert.match(submissions, /View grade evidence/);
  assert.match(submissions, /Updated \{formatDate\(submission[.]updatedAt\)\}/);
  assert.match(reports, /buildCurrentPublicSkillLinks/);
  assert.match(reports, /View reported listing/);
  assert.match(evidence, /Every gate must pass before this version can receive a current letter grade/);
  assert.match(evidence, /Rubric dimensions/);
  assert.match(evidence, /<details/);
  assert.match(evidence, /Show machine \{title\}/);
  assert.match(header, /resolveHostedAccountState/);
  assert.match(header, /Account unavailable/);
  assert.match(header, /role="status"/);
  assert.match(header, /aria-live="polite"/);
  assert.match(landing, /accountState === "authenticated" \? "Account" : "Sign in"/);
  assert.match(landing, /Listings without current receipts remain visibly not run, not tested, and ungraded/);
  assert.doesNotMatch(landing, /Current seeds remain/i);
  assert.match(gettingStarted, /Hosted visitor workflow/);
  assert.match(gettingStarted, /Hosted submitter workflow/);
  assert.match(gettingStarted, /<ol/);
  assert.match(gettingStarted, /only the reviewed operator workflow can publish/);
});

test("report form preserves safe values and request identity for recoverable failures", async () => {
  const [form, action] = await Promise.all([
    readFile(new URL("../app/skills/[publisher]/[slug]/report-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/skills/[publisher]/[slug]/report-actions.ts", import.meta.url), "utf8")
  ]);
  assert.match(form, /event[.]preventDefault\(\)/);
  assert.match(form, /new FormData\(event[.]currentTarget\)/);
  assert.match(form, /value=\{requestId\}/);
  assert.match(form, /import \{ unstable_rethrow \} from "next\/navigation"/);
  assert.match(form, /catch \(error\) \{\s*unstable_rethrow\(error\);\s*actionResult = \{ status: "service-unavailable" \}/);
  assert.match(form, /actionResult = \{ status: "service-unavailable" \}/);
  assert.match(form, /finally \{\s*setPending\(false\)/);
  assert.match(form, /setResult\(actionResult\)/);
  assert.match(form, /aria-invalid=\{invalidField === "message"\}/);
  assert.match(form, /Your category, message, and request ID remain in this form/);
  assert.match(action, /return \{ status: "invalid", field: error[.]field, message: error[.]message \}/);
  assert.match(action, /return \{ status: "cooldown" \}/);
  assert.match(action, /reportSuspiciousListingProgressive/);
  assert.match(action, /createReportFlash\(formData, result, token\)/);
  assert.match(action, /httpOnly: true/);
  assert.match(action, /sameSite: "strict"/);
  assert.doesNotMatch(action, /if \(error[.]code === "P0001"\) redirect/);
});

test("progressive report flash is same-browser, bounded, and preserves safe retry state", () => {
  const form = validReportForm();
  const token = "123e4567-e89b-42d3-a456-426614174000";
  const flash = createReportFlash(form, { status: "cooldown" }, token);
  assert.deepEqual(flash, {
    token,
    status: "cooldown",
    field: null,
    reportId: null,
    category: "security",
    message: "The current listing requests an unexpected high-risk permission.",
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    returnPath: "/skills/0x3-team/skill-audit"
  });
  const serialized = serializeReportFlash(flash);
  assert.deepEqual(parseReportFlash(serialized, token, flash.returnPath), flash);
  assert.equal(parseReportFlash(serialized, "223e4567-e89b-42d3-a456-426614174000", flash.returnPath), null);
  assert.equal(parseReportFlash(serialized, token, "/skills/other-team/other-skill"), null);
  assert.equal(parseReportFlash(JSON.stringify({ ...flash, forged: true }), token, flash.returnPath), null);
});

test("saved-skill and account-deletion flashes are exact same-browser receipts", () => {
  const token = "123e4567-e89b-42d3-a456-426614174000";
  const saveFlash = createSaveFlash("saved", SKILL_ID, "/skills/0x3-team/skill-audit", token);
  assert.deepEqual(saveFlash, {
    returnPath: "/skills/0x3-team/skill-audit",
    skillId: SKILL_ID,
    status: "saved",
    token
  });
  const serializedSave = serializeSaveFlash(saveFlash);
  assert.deepEqual(parseSaveFlash(serializedSave, token, saveFlash.returnPath), saveFlash);
  assert.equal(parseSaveFlash(serializedSave, "223e4567-e89b-42d3-a456-426614174000", saveFlash.returnPath), null);
  assert.equal(parseSaveFlash(serializedSave, token, "/account"), null);
  assert.equal(parseSaveFlash(JSON.stringify({ ...saveFlash, forged: true }), token, saveFlash.returnPath), null);

  const deletionFlash = createAccountDeletionFlash(token);
  assert.deepEqual(deletionFlash, { status: "account-deleted", token });
  const serializedDeletion = serializeAccountDeletionFlash(deletionFlash);
  assert.deepEqual(parseAccountDeletionFlash(serializedDeletion, token), deletionFlash);
  assert.equal(parseAccountDeletionFlash(serializedDeletion, "223e4567-e89b-42d3-a456-426614174000"), null);
  assert.equal(parseAccountDeletionFlash(JSON.stringify({ ...deletionFlash, forged: true }), token), null);
});

test("report and account deletion flash cookies depend on the shared siteOriginUsesHttps contract", async () => {
  const [reportActionsSource, accountActionSource] = await Promise.all([
    readFile(new URL("../app/skills/[publisher]/[slug]/report-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/account/data-actions.ts", import.meta.url), "utf8")
  ]);

  const reportWriter = parseCookieBoundary(reportActionsSource, "REPORT_FLASH_COOKIE");
  const deleteWriter = parseCookieBoundary(accountActionSource, "ACCOUNT_DELETION_FLASH_COOKIE");
  const reportSecureIdentifier = extractSecureDecisionIdentifier(reportActionsSource, reportWriter.secure);
  const accountSecureIdentifier = extractSecureDecisionIdentifier(accountActionSource, deleteWriter.secure);

  assert.equal(reportWriter.httpOnly, true);
  assert.equal(reportWriter.sameSite, "strict");
  assert.equal(reportWriter.maxAge, 120);
  assert.equal(reportWriter.path, "flash.returnPath");
  assert.equal(reportWriter.secure, reportSecureIdentifier);

  assert.equal(deleteWriter.httpOnly, true);
  assert.equal(deleteWriter.sameSite, "strict");
  assert.equal(deleteWriter.maxAge, 120);
  assert.equal(deleteWriter.path, '"/sign-in"');
  assert.equal(deleteWriter.secure, accountSecureIdentifier);

  assert.match(reportActionsSource, /from ["']@\/lib\/supabase\/config["']/);
  assert.match(accountActionSource, /from ["']@\/lib\/supabase\/config["']/);
  assert.match(reportActionsSource, /siteOriginUsesHttps/);
  assert.match(accountActionSource, /siteOriginUsesHttps/);
  assert.match(reportActionsSource, new RegExp(`const\\s+${escapeRegExp(reportSecureIdentifier)}\\s*=\\s*siteOriginUsesHttps\\s*\\(`));
  assert.match(accountActionSource, new RegExp(`const\\s+${escapeRegExp(accountSecureIdentifier)}\\s*=\\s*siteOriginUsesHttps\\s*\\(`));
  assert.match(reportActionsSource, new RegExp(`secure:\\s*${escapeRegExp(reportSecureIdentifier)}\\b`));
  assert.match(accountActionSource, new RegExp(`secure:\\s*${escapeRegExp(accountSecureIdentifier)}\\b`));
  assert.equal(reportActionsSource.includes("function publicOriginUsesHttps"), false);
  assert.equal(accountActionSource.includes("function publicOriginUsesHttps"), false);
  assert.match(
    reportActionsSource,
    new RegExp(`const\\s+${escapeRegExp(reportSecureIdentifier)}\\s*=\\s*siteOriginUsesHttps\\(\\)`)
  );
  assert.match(
    accountActionSource,
    new RegExp(`const\\s+${escapeRegExp(accountSecureIdentifier)}\\s*=\\s*siteOriginUsesHttps\\(\\)`)
  );

  const configModule = await import("../lib/supabase/config.ts");
  const siteOriginUsesHttps = configModule.siteOriginUsesHttps;
  if (typeof siteOriginUsesHttps !== "function") {
    assert.fail("lib/supabase/config.ts must export siteOriginUsesHttps for hosted boundary enforcement");
  }

  const contractCases = [
    {
      description: "valid hosted HTTPS",
      env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://skillmap.invalid" },
      expectation: true
    },
    {
      description: "valid loopback local use",
      env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" },
      expectation: false
    },
    {
      description: "missing production origin",
      env: { NODE_ENV: "production" },
      expectation: SupabaseConfigurationError
    },
    {
      description: "malformed production origin",
      env: { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://skillmap.invalid/app" },
      expectation: SupabaseConfigurationError
    }
  ];
  for (const { description, env, expectation } of contractCases) {
    if (expectation === SupabaseConfigurationError) {
      assert.throws(() => siteOriginUsesHttps(env), expectation, description);
    } else {
      assert.equal(siteOriginUsesHttps(env), expectation, description);
    }
  }

  const reportDecision = extractSecureDecisionDeclaration(reportActionsSource, reportSecureIdentifier);
  const accountDecision = extractSecureDecisionDeclaration(accountActionSource, accountSecureIdentifier);
  const reportProgressiveStart = reportActionsSource.indexOf("export async function reportSuspiciousListingProgressive");
  const reportProgressiveMutation = reportActionsSource.indexOf(
    "const result = await reportSuspiciousListing(formData)",
    reportProgressiveStart
  );
  const hasExactConfirmationIndex = accountActionSource.indexOf("hasExactAccountDeletionConfirmation(formData)");
  const deletionContextIndex = accountActionSource.indexOf("deletionActionContext()");
  const deleteRpcIndex = accountActionSource.indexOf("delete_my_account");
  const signOutIndex = accountActionSource.indexOf("context.supabase.auth.signOut");

  assert.equal(reportProgressiveStart >= 0, true, "reportSuspiciousListingProgressive must exist");
  assert.equal(reportProgressiveMutation >= 0, true, "reportSuspiciousListingProgressive must await reportSuspiciousListing");
  assert.equal(reportDecision > reportProgressiveStart, true, "report secure decision must be inside reportSuspiciousListingProgressive");
  assert.equal(reportDecision < reportProgressiveMutation, true, "report secure decision must be evaluated before report mutation");
  assert.equal(hasExactConfirmationIndex < accountDecision, true, "account secure decision must be evaluated after exact confirmation");
  assert.equal(accountDecision < deletionContextIndex, true, "account secure decision must be evaluated before creating the authenticated context");
  assert.equal(accountDecision < deleteRpcIndex, true, "account secure decision must be evaluated before delete mutation");
  assert.equal(accountDecision < signOutIndex, true, "account secure decision must be evaluated before sign-out");
});

test("account submission mutation and export stay owner-filtered and bounded", async () => {
  const savedMutation = await readFile(new URL("../app/account/saved/action/route.ts", import.meta.url), "utf8");
  assert.match(savedMutation, /publicOrigin = getSiteUrl\(\)/);
  assert.match(savedMutation, /requestOrigin !== publicOrigin && fetchSite !== "same-origin"/);
  assert.match(savedMutation, /auth[.]getClaims\(\)/);
  assert.match(savedMutation, /operation !== "save" && operation !== "remove"/);
  assert.match(savedMutation, /user_id: auth[.]userId/);
  assert.match(savedMutation, /[.]eq\("user_id", auth[.]userId\)[.]eq\("skill_id", skillId\)/);
  assert.match(savedMutation, /status: 303/);
  assert.match(savedMutation, /createSaveFlash\(status, skillId, returnPath, token\)/);
  assert.match(savedMutation, /httpOnly: true/);
  assert.match(savedMutation, /sameSite: "strict"/);
  assert.doesNotMatch(savedMutation, /formData[.]get\("user|service_role|SUPABASE_SERVICE_ROLE/);

  const [accountPage, detailPage, submitPage, submissionsPage, signInPage, launchSmoke] = await Promise.all([
    readFile(new URL("../app/account/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/skills/[publisher]/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/submit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/submissions/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sign-in/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/launch-report-evidence-smoke.mjs", import.meta.url), "utf8")
  ]);
  assert.match(accountPage, /parseSaveFlash/);
  assert.match(accountPage, /from\("saved_skills"\)/);
  assert.match(detailPage, /saveFlash[?][.]skillId === skill[.]skillId/);
  assert.match(submitPage, /from\("my_skill_submissions"\)/);
  assert.match(submitPage, /data[?][.]submission_id === submissionId/);
  assert.match(submitPage, /That exact source already has a submission record/);
  assert.match(submitPage, /Open submission history/);
  assert.doesNotMatch(submitPage, /That exact source is already in your queue/);
  assert.match(launchSmoke, /smokeStage = "terminal-submission-duplicate"/);
  assert.match(launchSmoke, /smokeStage = "submission-server-quota-failure"/);
  assert.match(launchSmoke, /quotaFailureInsertedRows: 0/);
  assert.match(launchSmoke, /url[.]searchParams[.]get\("submission"\) === withdrawalId/);
  assert.match(launchSmoke, /A terminal duplicate was mislabeled as still queued/);
  assert.match(submissionsPage, /data[.]state === status/);
  assert.match(signInPage, /parseAccountDeletionFlash/);
  assert.doesNotMatch(signInPage, /browser session was cleared defensively/);
  assert.match(signInPage, /does not claim that account data or a browser session changed/);

  const withdrawal = await readFile(new URL("../app/account/submissions/actions.ts", import.meta.url), "utf8");
  assert.match(withdrawal, /\.update\(\{ state: "withdrawn" \}\)/);
  assert.match(withdrawal, /\.eq\("public_id", submissionId\)/);
  assert.match(withdrawal, /\.eq\("state", "queued"\)/);
  assert.doesNotMatch(withdrawal, /service_role|SUPABASE_SERVICE_ROLE/);

  const accountExport = await readFile(new URL("../app/account/export/route.ts", import.meta.url), "utf8");
  assert.match(accountExport, /auth\.getClaims\(\)/);
  assert.match(accountExport, /from\("saved_skills"\)/);
  assert.match(accountExport, /from\("my_skill_submissions"\)/);
  assert.match(accountExport, /from\("my_skill_reports"\)/);
  assert.match(accountExport, /select\("report_id,skill_id,version_id,category,message,state,disposition_code,resolution_reason_code,public_resolution_message,created_at,updated_at,resolved_at"\)/);
  assert.doesNotMatch(accountExport, /select\("[^"\n]*idempotency_key[^"\n]*"\)/);
  assert.match(accountExport, /MAX_EXPORT_BYTES/);
  assert.match(accountExport, /private, no-store/);
  assert.doesNotMatch(accountExport, /service_role|SUPABASE_SERVICE_ROLE/);

  const deletion = await readFile(new URL("../app/account/data-actions.ts", import.meta.url), "utf8");
  assert.match(deletion, /hasExactAccountDeletionConfirmation\(formData\)/);
  assert.match(deletion, /\.rpc\("delete_my_account"\)/);
  assert.match(deletion, /signOut\(\{ scope: "local" \}\)/);
  assert.match(deletion, /createAccountDeletionFlash\(token\)/);
  assert.match(deletion, /httpOnly: true/);
  assert.match(deletion, /sameSite: "strict"/);
  assert.doesNotMatch(deletion, /userId|user_id|service_role|SUPABASE_SERVICE_ROLE/);
});

test("account deletion copy discloses the narrow terminal revocation retention boundary", async () => {
  const [account, privacy, policy] = await Promise.all([
    readFile(new URL("../app/account/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/launch/public-alpha-policy-pack.md", import.meta.url), "utf8")
  ]);
  for (const source of [account, privacy, policy]) {
    assert.match(source, /terminal consent-withdrawal/i);
    assert.match(source, /repository URL[\s\S]+commit[\s\S]+path[\s\S]+publisher handle/i);
    assert.match(source, /retention[\s\S]+legal basis/i);
    assert.match(source, /account|auth user/i);
  }
  assert.match(privacy, /another account or handle/i);
  assert.match(policy, /another account or publisher handle/i);
});

test("suspicious-listing reports admit only one canonical same-origin account intent", () => {
  const form = validReportForm();
  form.set("reporter_user_id", "attacker-controlled");
  form.set("state", "resolved");
  assert.deepEqual(parseSkillReportForm(form), {
    skill_id: `skl_${"a".repeat(32)}`,
    version_id: `skv_${"b".repeat(32)}`,
    category: "security",
    message: "The current listing requests an unexpected high-risk permission.",
    idempotency_key: "123e4567-e89b-42d3-a456-426614174000",
    returnPath: "/skills/0x3-team/skill-audit"
  });
  assert.equal(
    reportStatusPath("/skills/0x3-team/skill-audit", "queued", { reportId: `rpt_${"c".repeat(32)}` }),
    `/skills/0x3-team/skill-audit?reportStatus=queued&report=rpt_${"c".repeat(32)}#report-listing`
  );
  assert.equal(reportStatusPath("//evil.example/steal", "queued"), "/skills");
  assert.equal(reportStatusPath("/skills/0x3-team/skill-audit", "active-limit"), "/skills/0x3-team/skill-audit?reportStatus=active-limit#report-listing");
  assert.equal(reportStatusPath("/skills/0x3-team/skill-audit", "daily-limit"), "/skills/0x3-team/skill-audit?reportStatus=daily-limit#report-listing");
});

test("suspicious-listing reports reject ambiguous IDs, categories, messages, paths, and duplicate fields", () => {
  const cases = [
    ["skillId", (form) => form.set("skillId", "skl_invalid")],
    ["versionId", (form) => form.set("versionId", "skv_invalid")],
    ["category", (form) => form.set("category", "urgent")],
    ["message", (form) => form.set("message", "too short")],
    ["message", (form) => form.set("message", " This report has leading whitespace.")],
    ["message", (form) => form.set("message", "This report contains\na forbidden line break.")],
    ["message", (form) => form.set("message", "This report contains a forbidden control.\u007f")],
    ["idempotencyKey", (form) => form.set("idempotencyKey", "not-a-uuid")],
    ["returnPath", (form) => form.set("returnPath", "https://evil.example/skills/a/b")],
    ["returnPath", (form) => form.set("returnPath", "/skills/0x3-team/skill-audit?next=evil")],
    ["category", (form) => form.append("category", "privacy")]
  ];
  for (const [field, mutate] of cases) {
    const form = validReportForm();
    mutate(form);
    assert.throws(
      () => parseSkillReportForm(form),
      (error) => error instanceof ReportValidationError && error.field === field,
      field
    );
  }
});

test("report history cursors are canonical, bounded, and account-free", () => {
  const cursor = encodeReportCursor({
    createdAt: "2026-07-13T00:30:00.123456+00:00",
    reportId: `rpt_${"d".repeat(32)}`
  });
  assert.deepEqual(decodeReportCursor(cursor), {
    kind: "skill-reports",
    v: 1,
    createdAt: "2026-07-13T00:30:00.123456Z",
    reportId: `rpt_${"d".repeat(32)}`
  });
  assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /user|email|account/i);
  for (const malformed of ["not+a+cursor", "a".repeat(513), "e30"]) {
    assert.throws(() => decodeReportCursor(malformed), ReportCursorError);
  }
});

test("public evidence projection shapes reject extra keys and invalid nullable values", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(parseFindingCounts({ critical: 0, high: 0, medium: 1, low: 0, info: 2 }), {
    critical: 0, high: 0, medium: 1, low: 0, info: 2
  });
  assert.equal(parseFindingCounts({ critical: 0, high: 0, medium: 0, low: 0, info: 0, private: 1 }), null);
  assert.notEqual(parsePublicChecks([{ code: "static-audit-complete", outcome: "passed", severity: "info", evidenceDigest: null }]), null);
  assert.equal(parsePublicChecks([{ code: "check", outcome: "passed", severity: "info", evidenceDigest: null, raw: "private" }]), null);
  assert.notEqual(parseHardGates([{ code: "source-identity", passed: true, evidenceDigest: digest }]), null);
  assert.equal(parseHardGates([{ code: "source-identity", passed: true, evidenceDigest: null }]), null);
  assert.notEqual(parseDimensions([{ code: "instruction-quality", weight: 1, score: 75, evidenceDigest: digest }]), null);
  assert.equal(parseDimensions([{ code: "instruction-quality", weight: 1, score: "75", evidenceDigest: digest }]), null);
  assert.equal(parseNullableBoundedNumber(null, 0, 100), null);
  assert.equal(parseNullableBoundedNumber("0", 0, 100), undefined);
  assert.equal(parseNullableBoundedNumber(Number.NaN, 0, 100), undefined);
  assert.equal(parseNullableDigest(null), null, "provisional evaluation suite may be absent");
  assert.equal(parseNullableDigest("not-a-digest"), undefined);
  assert.equal(gradeCompatibilityBindingIsValid("provisional", null, [
    { code: "compatibility-evidence-bound", passed: false, evidenceDigest: null }
  ]), false, "a provisional grade cannot omit compatibility evidence");
  assert.equal(gradeCompatibilityBindingIsValid("blocked", null, [
    { code: "compatibility-evidence-bound", passed: false, evidenceDigest: null }
  ]), true, "a blocked grade may explain the exact failed compatibility gate");
  assert.equal(gradeCompatibilityBindingIsValid("blocked", null, [
    { code: "source-identity", passed: false, evidenceDigest: null }
  ]), false, "an unrelated failed gate cannot authorize a missing compatibility digest");
});

test("report action and public evidence pages preserve database authority boundaries", async () => {
  const action = await readFile(new URL("../app/skills/[publisher]/[slug]/report-actions.ts", import.meta.url), "utf8");
  assert.match(action, /parseSkillReportForm\(formData\)/);
  assert.match(action, /from\("skill_reports"\)\.insert\(\{/);
  assert.match(action, /idempotency_key: report\.idempotency_key/);
  assert.match(action, /error\.code === "P0003"/);
  assert.match(action, /return \{ status: "active-limit" \}/);
  assert.match(action, /error\.code === "P0004"/);
  assert.match(action, /return \{ status: "daily-limit" \}/);
  assert.match(action, /redirect\(`\$\{flash\.returnPath\}\?reportFlash=/);
  assert.match(action, /const replay = await findReportByRequestId\(context\.supabase, report\.idempotency_key\)/);
  assert.match(action, /if \(replay && !reportPayloadMatches\(replay, report\)\) return \{ status: "service-unavailable" \}/);
  assert.match(action, /const existingId = replay\?\.reportId\s*\?\? await findQueuedReportForTarget\(context\.supabase, report\)/);
  assert.match(action, /const inserted = await findReportByRequestId\(context\.supabase, report\.idempotency_key\)/);
  assert.match(action, /!inserted \|\| !reportPayloadMatches\(inserted, report\)/);
  assert.doesNotMatch(action, /reporter_user_id\s*:|disposition_code\s*:|\bstate\s*:\s*"(?:queued|resolved)"/);
  assert.doesNotMatch(action, /service_role|SUPABASE_SERVICE_ROLE/);

  const requestIdLookup = action.slice(
    action.indexOf("async function findReportByRequestId"),
    action.indexOf("function reportPayloadMatches")
  );
  const queuedTargetLookup = action.slice(
    action.indexOf("async function findQueuedReportForTarget"),
    action.indexOf("function publicOriginUsesHttps")
  );
  assert.match(requestIdLookup, /\.select\("report_id,skill_id,version_id,category,message"\)/);
  assert.match(requestIdLookup, /\.eq\("idempotency_key", requestId\)/);
  assert.doesNotMatch(requestIdLookup, /\.eq\("message",/);
  assert.match(action, /existing\.skillId === report\.skill_id[\s\S]*existing\.versionId === report\.version_id[\s\S]*existing\.category === report\.category[\s\S]*existing\.message === report\.message/);
  assert.match(queuedTargetLookup, /\.eq\("skill_id", report\.skill_id\)/);
  assert.match(queuedTargetLookup, /\.eq\("version_id", report\.version_id\)/);
  assert.match(queuedTargetLookup, /\.eq\("category", report\.category\)/);
  assert.match(queuedTargetLookup, /\.eq\("state", "queued"\)/);
  assert.doesNotMatch(queuedTargetLookup, /\.eq\("message", report\.message\)/);

  const repository = await readFile(new URL("../lib/evidence/repository.server.ts", import.meta.url), "utf8");
  assert.match(repository, /from\("catalog_audit_evidence"\)/);
  assert.match(repository, /from\("catalog_grade_evidence"\)/);
  assert.doesNotMatch(repository, /from\("skill_(?:audit|grade)_receipts"\)/);
  const history = await readFile(new URL("../app/account/reports/page.tsx", import.meta.url), "utf8");
  assert.match(history, /from\("my_skill_reports"\)/);
  assert.doesNotMatch(history, /dangerouslySetInnerHTML/);
  const detail = await readFile(new URL("../app/skills/[publisher]/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /requestedReportStatus === "queued" \|\| requestedReportStatus === "duplicate"/);
  assert.match(detail, /from\("my_skill_reports"\)/);
  assert.match(detail, /\.eq\("report_id", requestedReportId\)/);
  assert.match(detail, /\.eq\("skill_id", skill\.skillId\)/);
  assert.match(detail, /\.eq\("version_id", skill\.currentVersion\.versionId\)/);
  assert.match(detail, /requestedReportStatus !== "queued" \|\| reportRow\.state === "queued"/);
  assert.match(detail, /verifiedReportStatus = requestedReportStatus/);
  assert.match(detail, /parseReportFlash/);
  assert.doesNotMatch(detail, /verifiedReportStatus[^;]*requestedReportStatus === "queued"[^;]*\? null\s*:\s*requestedReportStatus/);

  const smoke = await readFile(new URL("../scripts/launch-report-evidence-smoke.mjs", import.meta.url), "utf8");
  assert.match(smoke, /smokeStage = "report-queued-constraint-recovery"/);
  assert.match(smoke, /set local session_replication_role = replica; update api\.skill_reports set created_at = now\(\) - interval '25 hours'/);
  assert.match(smoke, /Queued-target conflict created an unexpected row count/);
  assert.match(smoke, /smokeStage = "report-resolved-history-queued-authority-recovery"/);
  assert.match(smoke, /Existing report \$\{blockingQueuedReportId\} remains the account-owned source of truth/);
  assert.match(smoke, /Resolved-history recovery changed the queued row count/);
  assert.match(smoke, /smokeStage = "report-request-id-payload-conflict"/);
  assert.match(smoke, /Conflicting request UUID changed the report row count/);
  assert.match(smoke, /rpc\("claim_skill_submission"/);
  assert.match(smoke, /rpc\("complete_skill_submission"/);
  assert.match(smoke, /const published = await runDualControlledBusinessRpc\(\{\s*actionKind: "submission[.]publish",[\s\S]*?rpcName: "publish_skill_submission",\s*rpcParameters: publicationParameters,\s*label: "publication"\s*\}\);/);
  assert.match(smoke, /const serviceOnlyOutcome = await admin[.]rpc\(rpcName, rpcParameters\);\s*assertOperatorCredentialCanariesAbsent\(serviceOnlyOutcome, `\$\{label\} service-role denial`\);\s*assertPermissionDenied\(serviceOnlyOutcome, `\$\{label\} service-role-only call`\);/);
  assert.match(smoke, /const approvalOutcome = await approver[.]rpc\("approve_operator_action"/);
  assert.match(smoke, /const executor = createOperatorClient\(operatorAuthority[.]executor[.]credential, approval[.]approval_id\);\s*const executionOutcome = await executor[.]rpc\(rpcName, rpcParameters\);/);
  assert.match(smoke, /assertCompleteDualControlEvidence\(dualControlEvidence\)/);
  assert.doesNotMatch(smoke, /admin[.]rpc\("publish_skill_submission"/);
  assert.match(smoke, /receiptDetailPath}\/audit/);
  assert.match(smoke, /receiptDetailPath}\/grade/);
  assert.match(smoke, /Public audit page exposed the private evidence digest/);
  assert.match(smoke, /deletedApiListing[.]status\(\) !== 404/);
});

test("verified claims distinguish terminal sessions from retryable auth failures", () => {
  assert.equal(shouldRedirectForAuthError(null), true);
  assert.equal(shouldRedirectForAuthError(new AuthSessionMissingError()), true);
  assert.equal(shouldRedirectForAuthError(new AuthInvalidJwtError("invalid token")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("expired", 400, "session_expired")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("unauthorized", 401, "unexpected_failure")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("forbidden", 403, "unexpected_failure")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("rate limited", 429, "over_request_rate_limit")), false);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("upstream", 503, "unexpected_failure")), false);
  assert.equal(shouldRedirectForAuthError(new AuthError("network unavailable")), false);

  assert.deepEqual(classifyVerifiedClaims({ claims: { sub: "user-1" } }, null), {
    state: "authenticated",
    userId: "user-1"
  });
  assert.equal(classifyVerifiedClaims({ claims: {} }, null).state, "signed-out");
  assert.equal(classifyVerifiedClaims({ claims: { sub: "" } }, null).state, "signed-out");
  assert.equal(classifyVerifiedClaims(null, new AuthApiError("rate limited", 429, "over_request_rate_limit")).state, "unavailable");
});

test("production Supabase and site configuration accepts HTTPS origins only", () => {
  withEnvironment({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SITE_URL: "https://skillmap.example"
  }, () => {
    assert.deepEqual(getPublicSupabaseConfig(), {
      url: "https://project.supabase.co",
      publishableKey: "test-publishable-key"
    });
    assert.equal(getSiteUrl(), "https://skillmap.example");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    assert.equal(getPublicSupabaseConfig().url, "http://127.0.0.1:54321");
    assert.equal(getSiteUrl(), "http://127.0.0.1:3000");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SITE_URL = "https://skillmap.example";

    for (const url of [
      "http://project.supabase.co",
      "https://user:secret@project.supabase.co",
      "https://project.supabase.co/rest/v1",
      "https://project.supabase.co?token=secret",
      "https://project.supabase.co#fragment"
    ]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      assert.throws(() => getPublicSupabaseConfig(), SupabaseConfigurationError, url);
    }

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    for (const url of [
      "http://skillmap.example",
      "https://user:secret@skillmap.example",
      "https://skillmap.example/app",
      "https://skillmap.example?token=secret",
      "https://skillmap.example#fragment"
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = url;
      assert.throws(() => getSiteUrl(), SupabaseConfigurationError, url);
    }
  });

  withEnvironment({
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000"
  }, () => {
    assert.equal(getPublicSupabaseConfig().url, "http://127.0.0.1:54321");
    assert.equal(getSiteUrl(), "http://127.0.0.1:3000");
  });
});

test("hosted build configuration fails closed and local candidates retain an explicit metadata base", async () => {
  assert.deepEqual(assertHostedReleaseConfiguration({ NODE_ENV: "production" }), {
    releaseStage: "local-candidate",
    hosted: false
  });

  const privateAlpha = {
    NODE_ENV: "production",
    SKILLMAP_RELEASE_STAGE: "private-alpha",
    NEXT_PUBLIC_SITE_URL: "https://skillmap.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
  };
  assert.deepEqual(assertHostedReleaseConfiguration(privateAlpha), {
    releaseStage: "private-alpha",
    hosted: true
  });

  assert.throws(
    () => assertHostedReleaseConfiguration({ ...privateAlpha, NEXT_PUBLIC_SITE_URL: undefined }),
    SupabaseConfigurationError
  );
  assert.throws(
    () => assertHostedReleaseConfiguration({
      ...privateAlpha,
      SKILLMAP_RELEASE_STAGE: "public-alpha",
      SKILLMAP_SUPPORT_URL: "http://support.example/skillmap"
    }),
    /SKILLMAP_SUPPORT_URL/
  );
  assert.throws(
    () => assertHostedReleaseConfiguration({ ...privateAlpha, SKILLMAP_RELEASE_STAGE: "private-alpha " }),
    /SKILLMAP_RELEASE_STAGE/
  );
  assert.throws(
    () => assertHostedReleaseConfiguration({
      ...privateAlpha,
      SKILLMAP_RELEASE_STAGE: "public-alpha",
      SKILLMAP_SUPPORT_URL: "https://support.example/skillmap"
    }),
    /SKILLMAP_INDEXING_MODE=public/
  );
  assert.deepEqual(
    assertHostedReleaseConfiguration({
      ...privateAlpha,
      SKILLMAP_RELEASE_STAGE: "public-alpha",
      SKILLMAP_SUPPORT_URL: "https://support.example/skillmap",
      SKILLMAP_INDEXING_MODE: "public"
    }),
    { releaseStage: "public-alpha", hosted: true }
  );

  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.doesNotMatch(wrangler, /["']SUPABASE_SERVICE_ROLE_KEY["']\s*:/);
  assert.match(wrangler, /encrypted Worker secret/);

  const [metadata, layout] = await Promise.all([
    readFile(new URL("../lib/metadata.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8")
  ]);
  assert.match(metadata, /!isHostedReleaseStage\(getReleaseStage\(environment\)\)/);
  assert.match(metadata, /LOCAL_CANDIDATE_METADATA_BASE/);
  assert.match(metadata, /return getOptionalSiteUrl\(environment\) \?\? new URL\(LOCAL_CANDIDATE_METADATA_BASE\)/);
  assert.match(layout, /metadataBase: getMetadataBase\(\)/);
});

test("hosted boundary scripts resolve to existing package-script callers and local helper imports", async () => {
  const packageSource = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const packageJson = JSON.parse(packageSource);
  const scripts = packageJson.scripts ?? {};

  assert.equal(typeof scripts.build, "string");
  assert.equal(typeof scripts["test:hosted-gates"], "string");
  assert.equal(typeof scripts["test:hosted-api"], "string");
  assert.equal(typeof scripts["test:hosted-auth"], "string");
  assert.equal(typeof scripts["test:hosted-launch"], "string");
  assert.equal(typeof scripts["test:hosted-frontend"], "string");

  assert.match(scripts.build, /\bnode\s+--experimental-strip-types\s+scripts\/check-hosted-release-config\.mts\b/);
  assert.match(scripts["test:hosted-gates"], /\bnode\s+scripts\/run-hosted-gates\.mjs\b/);
  assert.match(scripts["test:hosted-api"], /\bnode\s+scripts\/hosted-api-smoke\.mjs\b/);
  assert.match(scripts["test:hosted-auth"], /\bnode\s+scripts\/hosted-auth-browser-smoke\.mjs\b/);
  assert.match(scripts["test:hosted-launch"], /\bnode\s+scripts\/launch-report-evidence-smoke\.mjs\b/);
  assert.match(scripts["test:hosted-frontend"], /\bnode\s+scripts\/hosted-frontend-qa\.mjs\b/);

  const [checkHostedReleaseConfig, localSupabase, runHostedGates, hostedApiSmoke, hostedAuthSmoke, hostedFrontendQa, launchReportSmoke] = await Promise.all([
    readFile(new URL("../scripts/check-hosted-release-config.mts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-supabase-psql.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-hosted-gates.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/hosted-api-smoke.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/hosted-auth-browser-smoke.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/hosted-frontend-qa.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/launch-report-evidence-smoke.mjs", import.meta.url), "utf8")
  ]);

  assert.match(checkHostedReleaseConfig, /\bassertHostedReleaseConfiguration\b/);
  assert.match(localSupabase, /\bexecLocalPsql\b/);

  for (const hostSmoke of [
    "hosted-api-smoke.mjs",
    "hosted-auth-browser-smoke.mjs",
    "hosted-frontend-qa.mjs",
    "launch-report-evidence-smoke.mjs"
  ]) {
    assert.match(runHostedGates, new RegExp(hostSmoke.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const hostSmokeSource of [hostedApiSmoke, hostedAuthSmoke, hostedFrontendQa, launchReportSmoke]) {
    assert.match(hostSmokeSource, /from ["']\.\/local-supabase-psql\.mjs["']/);
  }
});

test("saved-skill cursors are exact, versioned, canonical, and account-free", () => {
  const cursor = encodeSavedSkillsCursor({
    savedAt: "2026-07-11T18:00:00.123456Z",
    skillId: SKILL_ID
  });
  assert.deepEqual(decodeSavedSkillsCursor(cursor), {
    kind: "saved-skills",
    v: 1,
    savedAt: "2026-07-11T18:00:00.123456Z",
    skillId: SKILL_ID
  });
  assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /user|account|email/i);

  const invalidPayloads = [
    { kind: "wrong", v: 1, savedAt: "2026-07-11T18:00:00.123456Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 2, savedAt: "2026-07-11T18:00:00.123456Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00.123456Z", skillId: "sk_invalid" },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00.123456Z", skillId: SKILL_ID, extra: true }
  ];
  for (const payload of invalidPayloads) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    assert.throws(() => decodeSavedSkillsCursor(encoded), SavedSkillsCursorError);
  }
  for (const malformed of ["not+a+cursor", "a".repeat(513), "e30"]) {
    assert.throws(() => decodeSavedSkillsCursor(malformed), SavedSkillsCursorError);
  }
});

test("database timestamps retain microseconds in one canonical UTC form", () => {
  assert.equal(
    canonicalizeUtcTimestamp("2026-07-11T18:00:00.123456+00:00"),
    "2026-07-11T18:00:00.123456Z"
  );
  assert.equal(
    canonicalizeUtcTimestamp("2026-07-11T18:00:00Z"),
    "2026-07-11T18:00:00.000000Z"
  );
  for (const invalid of [
    "2026-02-30T18:00:00.000000Z",
    "2026-07-11T18:00:00.1234567Z",
    "2026-07-11T19:00:00.123456+01:00"
  ]) assert.throws(() => canonicalizeUtcTimestamp(invalid), TypeError, invalid);
});

test("public skill relationships fail closed before exceeding the detail contract", () => {
  assert.equal(MAX_PUBLIC_SKILL_RELATIONSHIPS, 100);
  assert.doesNotThrow(() => assertPublicSkillRelationshipLimit(Array(100).fill(null)));
  assert.throws(
    () => assertPublicSkillRelationshipLimit(Array(101).fill(null)),
    CatalogDataError
  );
});

test("release stage and public indexing fail closed and require two exact public opt-ins", () => {
  for (const value of [undefined, "", "local", "PUBLIC-ALPHA", " public-alpha ", "true", "1"]) {
    assert.equal(getReleaseStage({ SKILLMAP_RELEASE_STAGE: value }), "local-candidate", String(value));
  }
  assert.equal(getReleaseStage({ SKILLMAP_RELEASE_STAGE: "private-alpha" }), "private-alpha");
  assert.equal(getReleaseStage({ SKILLMAP_RELEASE_STAGE: "public-alpha" }), "public-alpha");
  assert.equal(isHostedReleaseStage("local-candidate"), false);
  assert.equal(isHostedReleaseStage("private-alpha"), true);
  assert.equal(releaseStageLabel("public-alpha"), "public alpha");

  for (const value of [undefined, "", "private", "PUBLIC", " public ", "true", "1"]) {
    assert.equal(isPublicIndexingEnabled({ SKILLMAP_RELEASE_STAGE: "public-alpha", SKILLMAP_INDEXING_MODE: value }), false, String(value));
  }
  assert.equal(isPublicIndexingEnabled({ SKILLMAP_INDEXING_MODE: "public" }), false);
  assert.equal(isPublicIndexingEnabled({ SKILLMAP_RELEASE_STAGE: "private-alpha", SKILLMAP_INDEXING_MODE: "public" }), false);
  assert.equal(isPublicIndexingEnabled({ SKILLMAP_RELEASE_STAGE: "public-alpha", SKILLMAP_INDEXING_MODE: "public" }), true);

  for (const value of [undefined, "", " https://support.example/alpha", "javascript:alert(1)", "http://support.example/alpha", "https://user:pass@support.example/alpha", "https://support.example/alpha?case=1", "https://support.example/alpha#form"]) {
    assert.equal(getApprovedSupportUrl({ SKILLMAP_SUPPORT_URL: value }), null, String(value));
  }
  assert.equal(getApprovedSupportUrl({ SKILLMAP_SUPPORT_URL: "https://support.example/alpha" }), "https://support.example/alpha");
  assert.equal(getApprovedSupportUrl({ SKILLMAP_SUPPORT_URL: "http://127.0.0.1:3108/support" }), "http://127.0.0.1:3108/support");

  const privateHeaders = buildResponseSecurityHeaders({
    contentSecurityPolicy: "default-src 'self';",
    https: true,
    publicIndexing: false
  });
  assert.equal(privateHeaders["X-Robots-Tag"], PRIVATE_ALPHA_ROBOTS_VALUE);
  assert.equal(privateHeaders["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");

  const publicHeaders = buildResponseSecurityHeaders({
    contentSecurityPolicy: "default-src 'self';",
    https: false,
    publicIndexing: true
  });
  assert.equal(publicHeaders["X-Robots-Tag"], undefined);
  assert.equal(publicHeaders["Strict-Transport-Security"], undefined);
});

test("public health route is identifier-free, fail-closed, and explicitly no-store", async () => {
  const [route, projection] = await Promise.all([
    readFile(new URL("../app/api/v1/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/operations/health.ts", import.meta.url), "utf8")
  ]);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const revalidate = 0/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /"CDN-Cache-Control": "no-store"/);
  assert.match(route, /"Vercel-CDN-Cache-Control": "no-store"/);
  assert.match(route, /health[.]status === "ready" \? 200 : 503/);
  assert.match(projection, /getPublicSupabaseConfig\(environment\)/);
  assert.match(projection, /getApprovedSupportUrl\(environment\)/);
  assert.match(projection, /isPublicIndexingEnabled\(environment\)/);
  assert.doesNotMatch(projection, /userId|accountId|email|queueCount|errorMessage/);

  assert.deepEqual(getPublicSupabaseConfig({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
  }), {
    url: "https://project.supabase.co",
    publishableKey: "test-publishable-key"
  });
  assert.match(
    await readFile(new URL("../lib/supabase/config.ts", import.meta.url), "utf8"),
    /process[.]env[.]NEXT_PUBLIC_SUPABASE_URL/
  );
  assert.equal(getSiteUrl({
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://skillmap.example"
  }), "https://skillmap.example");
});

test("nonce CSP is strict, environment-aware, and rejects malformed sources", () => {
  const nonce = "bm9uY2UtZm9yLXRlc3Rz";
  const production = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: "https://project.supabase.co",
    development: false,
    upgradeInsecureRequests: true
  });
  assert.match(production, new RegExp(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`));
  assert.match(production, new RegExp(`style-src 'self' 'nonce-${nonce}'`));
  assert.match(production, new RegExp(`style-src-elem 'self' 'nonce-${nonce}'`));
  assert.match(production, /sha256-47DEQpj8HBSa\+\/TImW\+5JCeuQeRkm5NMpJWZG3hSuFU=/);
  assert.match(production, /style-src-attr 'unsafe-inline'/);
  assert.match(production, /connect-src 'self' https:\/\/project\.supabase\.co wss:\/\/project\.supabase\.co/);
  assert.match(production, /frame-ancestors 'none'/);
  assert.match(production, /upgrade-insecure-requests/);
  assert.doesNotMatch(production, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(production, /style-src-elem [^;]*'unsafe-inline'/);
  assert.doesNotMatch(production, /'unsafe-eval'/);

  const development = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: "http://127.0.0.1:54321",
    development: true
  });
  assert.match(development, /connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
  assert.match(development, /'unsafe-eval'/);
  assert.doesNotMatch(development, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(development, /style-src-elem [^;]*'unsafe-inline'/);

  for (const hostile of [
    "https://user:secret@project.supabase.co",
    "https://project.supabase.co/rest/v1",
    "https://project.supabase.co?token=PRIVATE-CANARY",
    "https://project.supabase.co#PRIVATE-CANARY",
    "javascript:alert(1)",
    "https://project.supabase.co\nconnect-src https://evil.example"
  ]) {
    const policy = buildContentSecurityPolicy({ nonce, supabaseUrl: hostile, development: false });
    assert.equal(getSupabaseConnectSources(hostile, false).length, 0, hostile);
    assert.doesNotMatch(policy, /evil\.example|PRIVATE-CANARY|user:secret/, hostile);
    assert.equal(policy.match(/connect-src [^;]+/)?.[0], "connect-src 'self'", hostile);
  }
  assert.throws(
    () => buildContentSecurityPolicy({
      nonce: "validnoncevalue1234'; connect-src https://evil.example",
      development: false
    }),
    TypeError
  );
});

test("catalog rate limiting covers API and server-rendered read paths only", () => {
  for (const pathname of [
    "/skills",
    "/skills/",
    "/skills/0x3-team/skill-audit",
    "/api/v1/skills",
    "/api/v1/skills/skl_00000000000000000000000000000001"
  ]) {
    assert.equal(isPublicCatalogReadRequest(pathname, "GET"), true, pathname);
    assert.equal(isPublicCatalogReadRequest(pathname, "HEAD"), true, pathname);
  }
  for (const [pathname, method] of [
    ["/skills", "POST"],
    ["/skill", "GET"],
    ["/skills-preview", "GET"],
    ["/api/v1/skills-preview", "GET"],
    ["/account", "GET"]
  ]) assert.equal(isPublicCatalogReadRequest(pathname, method), false, `${method} ${pathname}`);

  assert.equal(isPublicCatalogApiPath("/api/v1/skills"), true);
  assert.equal(isPublicCatalogApiPath("/api/v1/skills/example"), true);
  assert.equal(isPublicCatalogApiPath("/skills"), false);
});

test("device-auth initiation source gate matches the public POST seam only", () => {
  assert.equal(isPublicDeviceAuthInitiationRequest("/api/device-auth/v1/pairings", "POST"), true);
  for (const [pathname, method] of [
    ["/api/device-auth/v1/pairings", "GET"],
    ["/api/device-auth/v1/pairings/", "POST"],
    ["/api/device-auth/v1/pairings/poll", "POST"],
    ["/api/v1/skills", "POST"]
  ]) assert.equal(isPublicDeviceAuthInitiationRequest(pathname, method), false, `${method} ${pathname}`);
});

test("device-auth source identity trusts only CF-Connecting-IP", () => {
  assert.equal(
    getDeviceAuthSourceIdentity(new Headers({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20"
    })),
    "ip:203.0.113.10"
  );
  assert.equal(
    getDeviceAuthSourceIdentity(new Headers({ "x-forwarded-for": "198.51.100.20" })),
    "anonymous",
    "a client-supplied forwarded header must not become the source identity"
  );
  assert.equal(
    getDeviceAuthSourceIdentity(new Headers({
      "cf-connecting-ip": "203.0.113.10, 198.51.100.20",
      "x-forwarded-for": "198.51.100.20"
    })),
    "anonymous",
    "a list-valued Cloudflare source header is not an authoritative address"
  );
  assert.equal(
    getDeviceAuthSourceIdentity(new Headers({
      "cf-connecting-ip": "not-an-ip",
      "x-forwarded-for": "198.51.100.20"
    })),
    "anonymous"
  );
});

test("device-auth source limiter has the frozen N/N+1 boundary", () => {
  assert.deepEqual(PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY, {
    limit: 5,
    windowMs: 600_000,
    maxEntries: 5_000
  });
  const limiter = new InMemoryFixedWindowRateLimiter(PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const decision = limiter.consume("ip:203.0.113.10", 1000 + attempt);
    assert.equal(decision.allowed, true, `attempt ${attempt} must pass`);
    assert.equal(decision.remaining, 5 - attempt);
  }
  const denied = limiter.consume("ip:203.0.113.10", 2000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 600);
  assert.equal(limiter.consume("ip:198.51.100.20", 2000).allowed, true, "different source gets its own budget");
  assert.equal(limiter.consume("ip:203.0.113.10", 601_002).allowed, true, "expired source window resets");
});

test("device-auth edge gate is fail-closed, strips caller headers, and passes only the DO decision", async () => {
  const calls = [];
  const binding = {
    idFromName(name) {
      calls.push(["id", name]);
      return { id: name };
    },
    get(id) {
      calls.push(["get", id.id]);
      return {
        async fetch(request) {
          calls.push(["fetch", request]);
          return new Response(JSON.stringify({
            allowed: true,
            limit: 5,
            remaining: 4,
            retryAfterSeconds: 0,
            resetAfterSeconds: 600,
            resetAt: 600_000
          }), { status: 200 });
        }
      };
    }
  };
  const result = await gateDeviceAuthRequest(
    new Request("https://skillmap.invalid/api/device-auth/v1/pairings", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.20",
        "x-skillmap-device-auth-edge-checked": "1"
      }
    }),
    { DEVICE_AUTH_IP_RATE_LIMITER: binding, DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY: "test-ip-limit-secret-0123456789" },
    { now: 0 }
  );
  assert.equal(result.response, undefined);
  assert.equal(calls.length, 3);
  assert.equal(result.request.headers.get("cf-connecting-ip"), null);
  assert.equal(result.request.headers.get("x-forwarded-for"), null);
  assert.equal(result.request.headers.get("x-skillmap-device-auth-edge-checked"), "1");
  assert.equal(result.request.headers.get("x-skillmap-device-auth-remaining"), "4");
});

test("device-auth edge gate returns temporary unavailable without the shared binding", async () => {
  const result = await gateDeviceAuthRequest(
    new Request("https://skillmap.invalid/api/device-auth/v1/pairings", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.10" }
    }),
    { DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY: "test-ip-limit-secret-0123456789" }
  );
  assert.equal(result.response.status, 503);
  assert.match(await result.response.text(), /temporarily_unavailable/);
});

test("device-auth edge gate returns the Durable Object denial as a public 429", async () => {
  const result = await gateDeviceAuthRequest(
    new Request("https://skillmap.invalid/api/device-auth/v1/pairings", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.10" }
    }),
    {
      DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY: "test-ip-limit-secret-0123456789",
      DEVICE_AUTH_IP_RATE_LIMITER: {
        idFromName: () => ({ id: "test" }),
        get: () => ({
          fetch: async () => new Response(JSON.stringify({
            allowed: false,
            limit: 5,
            remaining: 0,
            retryAfterSeconds: 42,
            resetAfterSeconds: 42,
            resetAt: 42_000
          }), { status: 200 })
        })
      }
    }
  );
  assert.equal(result.request, undefined);
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get("retry-after"), "42");
  assert.equal(result.response.headers.get("ratelimit-remaining"), "0");
  assert.match(await result.response.text(), /rate_limited/);
});

test("anonymous rate limiting is bounded, resets deterministically, and emits bounded headers", () => {
  const limiter = new InMemoryFixedWindowRateLimiter({ limit: 2, windowMs: 1_000, maxEntries: 2 });
  assert.deepEqual(limiter.consume("client-a", 10), {
    allowed: true,
    limit: 2,
    remaining: 1,
    retryAfterSeconds: 0,
    resetAfterSeconds: 1,
    resetAt: 1_010
  });
  assert.equal(limiter.consume("client-a", 20).remaining, 0);
  const limited = limiter.consume("client-a", 30);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 1);

  assert.equal(limiter.consume("client-b", 40).allowed, true);
  assert.equal(limiter.consume("client-c", 50).allowed, false, "entry cap must fail closed");
  assert.equal(limiter.consume("client-c", 1_041).allowed, true, "expired entries must be evicted");

  const response = applyRateLimitHeaders(new Response(null), limited);
  applyRetryAfterHeader(response, limited);
  assert.equal(response.headers.get("ratelimit-limit"), "2");
  assert.equal(response.headers.get("ratelimit-remaining"), "0");
  assert.equal(response.headers.get("ratelimit-reset"), "1");
  assert.equal(response.headers.get("retry-after"), "1");

  limiter.reset();
  assert.equal(limiter.consume("client-a", 60).remaining, 1, "reset must clear prior counts");

  for (const policy of [
    { limit: 0, windowMs: 1_000, maxEntries: 1 },
    { limit: 1, windowMs: Number.NaN, maxEntries: 1 },
    { limit: 1, windowMs: 1_000, maxEntries: -1 }
  ]) assert.throws(() => new InMemoryFixedWindowRateLimiter(policy), TypeError);
});

test("anonymous rate-limit identity prefers provider headers and never exposes raw addresses", () => {
  const providerHeaders = new Headers({
    "x-vercel-forwarded-for": "203.0.113.10",
    "x-real-ip": "203.0.113.20",
    "x-forwarded-for": "203.0.113.30, 198.51.100.1"
  });
  assert.equal(
    getAnonymousClientKey(providerHeaders),
    getAnonymousClientKey(new Headers({ "x-vercel-forwarded-for": "203.0.113.10" }))
  );
  assert.equal(
    getAnonymousClientKey(new Headers({
      "x-vercel-forwarded-for": "not-an-ip",
      "x-real-ip": "203.0.113.20",
      "x-forwarded-for": "203.0.113.30"
    })),
    getAnonymousClientKey(new Headers({ "x-real-ip": "203.0.113.20" }))
  );

  const unknown = getAnonymousClientKey(new Headers({ "x-forwarded-for": "PRIVATE-CANARY" }));
  assert.equal(unknown, getAnonymousClientKey(new Headers()));
  assert.doesNotMatch(unknown, /203\.0\.113|PRIVATE-CANARY/);
  assert.match(unknown, /^[A-Za-z0-9_-]{43}$/);
});

test("Edge-safe rate-limit identity accepts canonical IPv4, IPv6, and mapped IPv6 while rejecting malformed values", () => {
  for (const value of [
    "203.0.113.10",
    "2001:db8::1",
    "::ffff:192.0.2.1",
    "2001:db8:0:0:0:0:192.0.2.1"
  ]) assert.equal(isValidIpAddress(value), true, value);
  for (const value of [
    "1:2:3:4:5:6:7:",
    "1:2:3:4:5:6:7:8:",
    "1:::2",
    "1::2::3",
    "1:2:3:4:5:6:7:8:9",
    "::ffff:192.0.2.999",
    "01.2.3.4",
    "PRIVATE-CANARY"
  ]) assert.equal(isValidIpAddress(value), false, value);

  assert.equal(
    getAnonymousClientIdentity(new Headers({
      "x-vercel-forwarded-for": "2001:db8::1, 198.51.100.5",
      "x-real-ip": "203.0.113.20",
      "x-forwarded-for": "203.0.113.30"
    })),
    "ip:2001:db8::1"
  );
  assert.equal(
    getAnonymousClientIdentity(new Headers({
      "x-vercel-forwarded-for": "malformed:::",
      "x-real-ip": "::ffff:192.0.2.1",
      "x-forwarded-for": "203.0.113.30, 198.51.100.1"
    })),
    "ip:::ffff:192.0.2.1"
  );
  assert.equal(
    getAnonymousClientIdentity(new Headers({ "x-forwarded-for": "malformed:::" })),
    "anonymous"
  );
});

test("Edge hosted API error validator executes the exact envelope and rejects malformed fields", () => {
  assert.match(HOSTED_API_ERROR_SCHEMA_ID, /hosted-api-error\/v1\.schema\.json$/);
  const payload = createHostedApiErrorPayload("RATE_LIMITED", "Too many catalog requests. Try again shortly.", true);
  assert.equal(validateHostedApiErrorResponse(payload), true);
  assert.equal(validateHostedApiErrorResponse({ ...payload, error: { ...payload.error, retryable: "yes" } }), false);
  assert.equal(validateHostedApiErrorResponse({ ...payload, error: { ...payload.error, code: "bad-code" } }), false);
  assert.equal(validateHostedApiErrorResponse({ ...payload, extra: true }), false);
});

test("public catalog fetch is no-store, aborts on timeout, and redacts target details", async () => {
  let observedInit;
  const successfulFetch = createBoundedCatalogFetch({
    timeoutMs: 100,
    fetchImplementation: async (_input, init) => {
      observedInit = init;
      return new Response("ok", { status: 200 });
    }
  });
  assert.equal((await successfulFetch("https://project.supabase.co/rest/v1/catalog")).status, 200);
  assert.equal(observedInit.cache, "no-store");
  assert.equal(observedInit.signal instanceof AbortSignal, true);

  const timeoutFetch = createBoundedCatalogFetch({
    timeoutMs: 5,
    fetchImplementation: () => new Promise(() => {})
  });
  await assert.rejects(
    timeoutFetch("https://project.supabase.co/rest/v1/catalog?token=PRIVATE-CANARY"),
    (error) => {
      assert.equal(error instanceof CatalogFetchAbortError, true);
      assert.equal(error.name, "AbortError");
      assert.equal(error.code, "ABORT_ERR");
      assert.doesNotMatch(error.message, /project\.supabase\.co|PRIVATE-CANARY/);
      return true;
    }
  );

  for (const timeoutMs of [0, -1, 60_001, 1.5, Number.NaN]) {
    assert.throws(() => createBoundedCatalogFetch({ timeoutMs }), TypeError);
  }
});

test("public catalog failures distinguish retryable upstream 503 from unexpected 500", () => {
  assert.deepEqual(classifyPublicCatalogFailure(new CatalogQueryError()), {
    status: 503,
    code: "CATALOG_UPSTREAM_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  });
  assert.deepEqual(classifyPublicCatalogFailure(new CatalogInputError("INVALID_QUERY", "Bad query.")), {
    status: 400,
    code: "INVALID_QUERY",
    message: "Bad query.",
    retryable: false
  });
  assert.deepEqual(classifyPublicCatalogFailure(new Error("PRIVATE-CANARY")), {
    status: 500,
    code: "CATALOG_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  });
  assert.deepEqual(classifyPublicCatalogFailure(new CatalogDataError("PRIVATE-CANARY")), {
    status: 500,
    code: "CATALOG_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  });
});

async function collectTsxFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) files.push(...await collectTsxFiles(childUrl));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(childUrl);
  }
  return files;
}

function parseCookieBoundary(source, cookieName) {
  const sourceCookieSet = source.match(
    new RegExp(
      `cookieStore\\.set\\(\\s*${escapeRegExp(cookieName)}\\s*,[\\s\\S]*?,\\s*\\{([\\s\\S]*?)\\}\\s*\\);`
    )
  );
  if (!sourceCookieSet) throw new Error(`Unable to locate cookie boundary for ${cookieName}`);
  const block = sourceCookieSet[1];
  const maxAge = Number(block.match(/maxAge:\s*([0-9]+)/)?.[1]);
  if (Number.isNaN(maxAge)) throw new Error(`Unable to parse maxAge for ${cookieName}`);
  const sameSite = block.match(/sameSite:\s*["']([^"']+)["']/)?.[1];
  if (!sameSite) throw new Error(`Unable to parse sameSite for ${cookieName}`);
  const path = block.match(/path:\s*([^,\n}]+)/)?.[1]?.trim();
  if (!path) throw new Error(`Unable to parse path for ${cookieName}`);
  const secure = block.match(/secure:\s*([^,\n}]+)/)?.[1]?.trim();
  if (!secure) throw new Error(`Unable to parse secure expression for ${cookieName}`);
  return {
    httpOnly: /httpOnly:\s*true/.test(block),
    sameSite,
    maxAge,
    path,
    secure
  };
}

function extractSecureDecisionIdentifier(source, secureExpression) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(secureExpression)) {
    assert.fail(`Expected secure decision identifier for cookie options, found ${secureExpression}`);
  }
  const declaration = new RegExp(`const\\s+${escapeRegExp(secureExpression)}\\s*=\\s*siteOriginUsesHttps\\s*\\(`);
  assert.match(source, declaration);
  return secureExpression;
}

function extractSecureDecisionDeclaration(source, identifier) {
  const declaration = new RegExp(
    String.raw`const\s+${escapeRegExp(identifier)}\s*=\s*siteOriginUsesHttps\s*\(\s*\)\s*;`
  );
  const declarationMatch = source.match(declaration);
  if (!declarationMatch) {
    assert.fail(`Unable to locate precomputed shared site origin decision declaration for ${identifier}`);
  }
  return source.indexOf(declarationMatch[0]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validSubmissionForm() {
  const form = new FormData();
  form.set("repositoryUrl", "https://github.com/0x3-team/skillmap");
  form.set("sourceCommit", "a".repeat(40));
  form.set("sourcePath", "skills/example/SKILL.md");
  form.set("versionLabel", "v1.0.0");
  form.set("licenseClaim", "MIT");
  form.set("idempotencyKey", "123e4567-e89b-42d3-a456-426614174000");
  form.set("authorizationAcknowledgement", "acknowledged");
  form.set("untrustedContentAcknowledgement", "acknowledged");
  return form;
}

function validReportForm() {
  const form = new FormData();
  form.set("skillId", `skl_${"a".repeat(32)}`);
  form.set("versionId", `skv_${"b".repeat(32)}`);
  form.set("category", "security");
  form.set("message", "The current listing requests an unexpected high-risk permission.");
  form.set("idempotencyKey", "123e4567-e89b-42d3-a456-426614174000");
  form.set("returnPath", "/skills/0x3-team/skill-audit");
  return form;
}

function withEnvironment(values, callback) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
