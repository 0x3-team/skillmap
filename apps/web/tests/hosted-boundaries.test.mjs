import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  InMemoryFixedWindowRateLimiter,
  applyRateLimitHeaders,
  getAnonymousClientKey,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest
} from "../lib/security/rate-limit.ts";

const APP_ORIGIN = "https://skillmap.invalid";
const SKILL_ID = `skl_${"0".repeat(31)}1`;

test("streaming fallback announces without creating a second main landmark", async () => {
  const source = await readFile(new URL("../app/loading.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<main\b/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /aria-busy=/);
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
  const [detail, submissions, reports, evidence, header, landing] = await Promise.all([
    readFile(new URL("../app/skills/[publisher]/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/submissions/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/account/reports/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/public-evidence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/catalog-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/skillmap/landing-page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(detail, /buildExactGitHubSourceUrl\(skill[.]source\)/);
  assert.match(detail, /skill[.]source[.]path/);
  assert.match(detail, /skill[.]publisher[.]verificationState/);
  assert.match(detail, /skill[.]lifecycleState/);
  assert.match(detail, /skill[.]currentVersion[.]publishedAt/);
  assert.match(detail, /skill[.]updatedAt/);
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
  assert.match(header, /Account status unavailable/);
  assert.match(landing, /accountState === "authenticated" \? "Account" : "Sign in"/);
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
  assert.doesNotMatch(action, /reporter_user_id\s*:|disposition_code\s*:|\bstate\s*:\s*"(?:queued|resolved)"/);
  assert.doesNotMatch(action, /service_role|SUPABASE_SERVICE_ROLE/);

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
  assert.match(smoke, /rpc\("claim_skill_submission"/);
  assert.match(smoke, /rpc\("complete_skill_submission"/);
  assert.match(smoke, /rpc\("publish_skill_submission"/);
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
  assert.equal(response.headers.get("ratelimit-limit"), "2");
  assert.equal(response.headers.get("ratelimit-remaining"), "0");
  assert.equal(response.headers.get("ratelimit-reset"), "1");

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
