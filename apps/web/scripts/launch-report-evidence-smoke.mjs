import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3108";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.SKILLMAP_TEST_DB_URL;
if (!supabaseUrl || !publishableKey || !serviceRoleKey || !databaseUrl) throw new Error("Local Supabase environment is required.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  db: { schema: "api" },
  auth: { autoRefreshToken: false, persistSession: false }
});
const marker = Date.now();
const detailPath = "/skills/0x3-team/skill-audit";
const reportMessage = "Potential issue: <img src=x onerror=alert(1)> appears in listing metadata.";
const userIds = [];
let browser;
let smokeStage = "browser-start";
let syntheticCatalogIdentity = null;
let passReceipt = null;
let cleanupReceipt = null;
let primaryError = null;

try {
  browser = await chromium.launch({ headless: true });
  smokeStage = "signed-out-evidence";
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const publicPage = await publicContext.newPage();
  const publicDiagnostics = collectDiagnostics(publicPage);
  await publicPage.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await publicPage.getByRole("heading", { name: "Report a suspicious listing" }).waitFor();
  await publicPage.getByText("Sign in to send a report").waitFor();
  await publicPage.getByRole("link", { name: "View audit evidence" }).waitFor();
  await publicPage.getByRole("link", { name: "View grade evidence" }).waitFor();
  assertNoOverflow(await dimensions(publicPage), "signed-out skill detail");
  await publicPage.goto(new URL(`${detailPath}?reportStatus=queued&report=rpt_${"f".repeat(32)}#report-listing`, baseUrl).toString(), { waitUntil: "load" });
  if (await publicPage.getByText("Private report queued").isVisible().catch(() => false)) throw new Error("Signed-out query parameters forged a queued report notice.");
  for (const [status, title] of [
    ["active-limit", "Queued-report limit reached"],
    ["auth-unavailable", "Authentication could not be verified"],
    ["cooldown", "Report cooldown is active"],
    ["daily-limit", "Daily report limit reached"],
    ["duplicate", "That report request already exists"],
    ["invalid", "Report input was rejected"],
    ["service-unavailable", "Reporting service unavailable"],
    ["target-unavailable", "This exact listing cannot be reported"]
  ]) {
    await publicPage.goto(new URL(`${detailPath}?reportStatus=${status}&report=rpt_${"f".repeat(32)}#report-listing`, baseUrl).toString(), { waitUntil: "load" });
    if (await publicPage.getByText(title, { exact: true }).isVisible().catch(() => false)) {
      throw new Error(`Signed-out query parameters forged a ${status} report notice.`);
    }
  }

  await publicPage.goto(new URL(`${detailPath}/audit`, baseUrl).toString(), { waitUntil: "load" });
  await publicPage.getByRole("heading", { name: "Skill Audit audit evidence" }).waitFor();
  await publicPage.getByRole("heading", { name: "Bounded public evidence projection" }).waitFor();
  await publicPage.getByRole("heading", { name: "No current public audit evidence" }).waitFor();
  const auditWidth = await dimensions(publicPage);
  assertNoOverflow(auditWidth, "audit evidence");

  await publicPage.goto(new URL(`${detailPath}/grade`, baseUrl).toString(), { waitUntil: "load" });
  await publicPage.getByRole("heading", { name: "Skill Audit grade evidence" }).waitFor();
  await publicPage.getByRole("heading", { name: "Bounded public evidence projection" }).waitFor();
  await publicPage.getByRole("heading", { name: "No current public grade evidence" }).waitFor();
  const gradeWidth = await dimensions(publicPage);
  assertNoOverflow(gradeWidth, "grade evidence");
  if (publicDiagnostics.length) throw new Error(`Public browser diagnostics:\n${publicDiagnostics.join("\n")}`);
  await publicContext.close();

  smokeStage = "synthetic-account-setup";
  const primary = await createSyntheticUser("primary");
  const secondary = await createSyntheticUser("secondary");
  const primaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const secondaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await primaryContext.addCookies(toBrowserCookies(primary.cookies));
  await secondaryContext.addCookies(toBrowserCookies(secondary.cookies));

  const page = await primaryContext.newPage();
  page.setDefaultTimeout(20_000);
  const diagnostics = collectDiagnostics(page);
  const publisherHandle = `browser-smoke-${marker}`;
  const syntheticRepositoryUrl = `https://github.com/${publisherHandle}/skills`;
  syntheticCatalogIdentity = {
    publisherHandle,
    repositoryUrl: syntheticRepositoryUrl,
    publisherId: null,
    skillId: null,
    versionId: null
  };

  smokeStage = "submission-invalid-field";
  await page.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("heading", { name: "Submit one exact skill version." }).waitFor();
  await page.getByLabel("Public GitHub repository URL").fill(syntheticRepositoryUrl);
  await page.getByLabel("Exact commit").fill("a".repeat(40));
  await page.getByLabel("Relative skill path").fill("../SKILL.md");
  await page.getByLabel("Version label").fill(`pilot-${marker}`);
  await page.getByLabel("License claim").selectOption("MIT");
  await page.locator("#authorizationAcknowledgement").check();
  await page.locator("#untrustedContentAcknowledgement").check();
  const stableRequestId = await page.getByLabel("Request ID").inputValue();
  if (!/^[0-9a-f-]{36}$/.test(stableRequestId)) throw new Error("Submission form did not expose one stable canonical request ID.");

  await submitForm(page.getByRole("button", { name: "Queue submission" }));
  await page.getByRole("alert").getByText("Correct the highlighted field").waitFor();
  await page.getByText(/normalized relative path ending in SKILL[.]md/).waitFor();
  const preserved = {
    repository: await page.getByLabel("Public GitHub repository URL").inputValue(),
    commit: await page.getByLabel("Exact commit").inputValue(),
    path: await page.getByLabel("Relative skill path").inputValue(),
    version: await page.getByLabel("Version label").inputValue(),
    license: await page.getByLabel("License claim").inputValue(),
    requestId: await page.getByLabel("Request ID").inputValue(),
    authority: await page.locator("#authorizationAcknowledgement").isChecked(),
    untrusted: await page.locator("#untrustedContentAcknowledgement").isChecked()
  };
  if (preserved.repository !== syntheticRepositoryUrl
    || preserved.commit !== "a".repeat(40)
    || preserved.path !== "../SKILL.md"
    || preserved.version !== `pilot-${marker}`
    || preserved.license !== "MIT"
    || preserved.requestId !== stableRequestId
    || !preserved.authority
    || !preserved.untrusted) {
    throw new Error(`Server validation did not preserve the safe submission state (${JSON.stringify(preserved)}).`);
  }
  smokeStage = "submission-invalid-row-count";
  const ownerProjectionPage = await primaryContext.newPage();
  await ownerProjectionPage.goto(new URL("/account/submissions", baseUrl).toString(), { waitUntil: "load" });
  await ownerProjectionPage.getByRole("heading", { name: "No submissions yet" }).waitFor();
  await ownerProjectionPage.close();
  assertNoOverflow(await dimensions(page), "field-local submission validation");

  smokeStage = "submission-corrected-field";
  await page.getByLabel("Relative skill path").fill("skills/frontend-design/SKILL.md");
  await submitForm(page.getByRole("button", { name: "Queue submission" }));
  await waitForUrl(page, (url) => url.pathname === "/account/submissions" && url.searchParams.get("status") === "queued", "corrected submission redirect");
  await page.getByText("Submission queued", { exact: true }).waitFor();
  const submissionId = new URL(page.url()).searchParams.get("submission");
  if (!submissionId || !/^sub_[0-9a-f]{32}$/.test(submissionId)) throw new Error("Corrected submission did not return a canonical owner receipt ID.");
  smokeStage = "submission-corrected-row-count";
  if (await page.locator("article").count() !== 1) throw new Error("Corrected submission did not create exactly one owner-visible queued row.");
  await page.getByText("skills/frontend-design/SKILL.md", { exact: true }).waitFor();

  smokeStage = "receipt-backed-publication";
  const workerVersion = "skillmap-browser-smoke/1.0.0";
  const { data: claims, error: claimError } = await admin.rpc("claim_skill_submission", {
    p_worker_version: workerVersion,
    p_submission_id: submissionId,
    p_lease_seconds: 300
  });
  if (claimError || !Array.isArray(claims) || claims.length !== 1 || !claims[0]?.claim_id) {
    throw claimError ?? new Error("Browser receipt fixture could not claim exactly one queued submission.");
  }
  const auditReceipt = auditReceiptPayload(workerVersion);
  const gradeReceipt = gradeReceiptPayload(auditReceipt.receiptDigest);
  const { data: completed, error: completionError } = await admin.rpc("complete_skill_submission", {
    p_submission_id: submissionId,
    p_claim_id: claims[0].claim_id,
    p_worker_version: workerVersion,
    p_disposition: "accepted",
    p_input_digest: digest("1"),
    p_result_digest: digest("2"),
    p_audit_receipt: auditReceipt,
    p_grade_receipt: gradeReceipt,
    p_reason_codes: [],
    p_public_message: null,
    p_idempotency_digest: digest("3")
  });
  if (completionError || completed?.[0]?.submission_state !== "accepted") throw completionError ?? new Error("Receipt-backed browser fixture was not accepted.");

  const skillSlug = "evidence-rendering";
  const { data: published, error: publicationError } = await admin.rpc("publish_skill_submission", {
    p_submission_id: submissionId,
    p_publication_digest: digest("4"),
    p_publisher_handle: publisherHandle,
    p_publisher_display_name: "Browser smoke publisher",
    p_skill_slug: skillSlug,
    p_skill_display_name: "Browser Evidence Rendering",
    p_summary: "A disposable metadata-only skill used to verify public evidence rendering.",
    p_description: "A disposable local browser-smoke listing backed by schema-valid audit and provisional grade receipts. It is deleted from public projections before cleanup.",
    p_capabilities: ["evidence.rendering"],
    p_license_state: "confirmed",
    p_spdx_expression: "MIT",
    p_permission_scripts: false,
    p_permission_network: [],
    p_permission_tools: []
  });
  if (publicationError || published?.[0]?.submission_state !== "published") throw publicationError ?? new Error("Receipt-backed browser fixture was not published.");
  const publishedPublisherId = published[0].publisher_id;
  const publishedSkillId = published[0].skill_id;
  const publishedVersionId = published[0].version_id;
  if (!/^pub_[0-9a-f]{32}$/.test(publishedPublisherId ?? "")
    || !/^skl_[0-9a-f]{32}$/.test(publishedSkillId ?? "")
    || !/^skv_[0-9a-f]{32}$/.test(publishedVersionId ?? "")) {
    throw new Error("Receipt-backed publication omitted canonical publisher, skill, or version IDs.");
  }
  Object.assign(syntheticCatalogIdentity, {
    publisherId: publishedPublisherId,
    skillId: publishedSkillId,
    versionId: publishedVersionId
  });

  const receiptDetailPath = `/skills/${publisherHandle}/${skillSlug}`;
  await page.goto(new URL("/account/submissions", baseUrl).toString(), { waitUntil: "load" });
  const publishedResult = page.getByRole("navigation", { name: "Published submission result" });
  await publishedResult.getByRole("link", { name: "View published listing" }).waitFor();
  if (await publishedResult.getByRole("link", { name: "View published listing" }).getAttribute("href") !== receiptDetailPath
    || await publishedResult.getByRole("link", { name: "View audit evidence" }).getAttribute("href") !== `${receiptDetailPath}/audit`
    || await publishedResult.getByRole("link", { name: "View grade evidence" }).getAttribute("href") !== `${receiptDetailPath}/grade`) {
    throw new Error("Published submission history did not expose exact current listing, audit, and grade follow-through links.");
  }
  await page.goto(new URL(`${receiptDetailPath}/audit`, baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("heading", { name: "Browser Evidence Rendering audit evidence" }).waitFor();
  await page.getByRole("heading", { name: "Audit result" }).waitFor();
  await page.getByText("passed", { exact: true }).waitFor();
  await page.getByText("Source Integrity", { exact: true }).waitFor();
  const auditBody = await page.locator("body").innerText();
  if (auditBody.includes(digest("d"))) throw new Error("Public audit page exposed the private evidence digest.");
  const receiptAuditWidth = await dimensions(page);
  assertNoOverflow(receiptAuditWidth, "receipt-backed audit evidence");

  await page.goto(new URL(`${receiptDetailPath}/grade`, baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("heading", { name: "Browser Evidence Rendering grade evidence" }).waitFor();
  await page.getByRole("heading", { name: "Grade result" }).waitFor();
  await page.getByText("provisional", { exact: true }).waitFor();
  await page.getByText("82.0 / 100 · 35% confidence", { exact: true }).waitFor();
  await page.getByText("Behavioral Evidence Incomplete", { exact: true }).waitFor();
  const receiptGradeWidth = await dimensions(page);
  assertNoOverflow(receiptGradeWidth, "receipt-backed grade evidence");

  smokeStage = "report-queue-and-cooldown";
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("button", { name: "Queue private report" }).waitFor();
  await page.waitForTimeout(1_000);
  assertNoOverflow(await dimensions(page), "authenticated report form");

  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(reportMessage);
  if (await page.getByLabel("What is wrong with this listing?").inputValue() !== reportMessage) throw new Error("Valid report message did not settle in the current form.");
  await page.waitForTimeout(500);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await waitForUrl(page, (url) => url.searchParams.get("reportStatus") === "queued", "queued report redirect");
  const reportId = new URL(page.url()).searchParams.get("report");
  if (!reportId || !/^rpt_[0-9a-f]{32}$/.test(reportId)) throw new Error("Queued report did not return a canonical receipt ID.");
  await page.getByText("Private report queued").waitFor();

  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(reportMessage);
  const cooldownRequestId = await page.getByLabel("Request ID").inputValue();
  await page.waitForTimeout(500);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await page.getByText("Report cooldown is active").waitFor();
  const cooldownUrl = new URL(page.url());
  if (cooldownUrl.pathname !== detailPath || cooldownUrl.searchParams.has("reportStatus")) {
    throw new Error(`Recoverable report cooldown navigated away from the editable form (${cooldownUrl.pathname}${cooldownUrl.search}).`);
  }
  const preservedCooldown = {
    category: await page.getByLabel("Concern category").inputValue(),
    message: await page.getByLabel("What is wrong with this listing?").inputValue(),
    requestId: await page.getByLabel("Request ID").inputValue()
  };
  if (preservedCooldown.category !== "security"
    || preservedCooldown.message !== reportMessage
    || preservedCooldown.requestId !== cooldownRequestId) {
    throw new Error(`Recoverable report cooldown did not preserve category, message, and request ID (${JSON.stringify(preservedCooldown)}).`);
  }

  smokeStage = "report-no-javascript-boundary";
  const noJavaScriptContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    javaScriptEnabled: false
  });
  try {
    await noJavaScriptContext.addCookies(toBrowserCookies(primary.cookies));
    const noJavaScriptPage = await noJavaScriptContext.newPage();
    await noJavaScriptPage.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
    await noJavaScriptPage.getByRole("heading", { level: 1, name: "JavaScript is required for hosted SkillMap workflows." }).waitFor();
    await noJavaScriptPage.getByText(/cannot expose authenticated save, submit, report, or account controls safely without JavaScript/).waitFor();
    if (await noJavaScriptPage.getByRole("button", { name: "Queue private report" }).isVisible().catch(() => false)) {
      throw new Error("JavaScript-disabled page exposed a report control behind a non-interactive streaming shell.");
    }
  } finally {
    await noJavaScriptContext.close();
  }

  const accountResponse = await page.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  assertPrivateNoStore(accountResponse?.headers() ?? {}, "report history");
  await page.getByRole("heading", { name: "Your listing reports" }).waitFor();
  await page.getByText(reportMessage, { exact: true }).waitFor();
  await page.getByText("Queued", { exact: true }).waitFor();
  const reportedEvidence = page.getByRole("navigation", { name: "Reported listing evidence" });
  await reportedEvidence.getByRole("link", { name: "View reported listing" }).waitFor();
  if (await reportedEvidence.getByRole("link", { name: "View reported listing" }).getAttribute("href") !== detailPath
    || await reportedEvidence.getByRole("link", { name: "View current audit" }).getAttribute("href") !== `${detailPath}/audit`
    || await reportedEvidence.getByRole("link", { name: "View current grade" }).getAttribute("href") !== `${detailPath}/grade`) {
    throw new Error("Report history did not expose exact current listing, audit, and grade follow-through links.");
  }
  if (await page.locator('img[src="x"]').count()) throw new Error("Report message was rendered as trusted HTML.");
  const historyWidth = await dimensions(page);
  assertNoOverflow(historyWidth, "queued report history");

  const secondaryPage = await secondaryContext.newPage();
  await secondaryPage.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  await secondaryPage.getByRole("heading", { name: "No listing reports" }).waitFor();
  if ((await secondaryPage.locator("body").innerText()).includes(reportId)) throw new Error("Report leaked into another account projection.");

  smokeStage = "report-disposition";
  const dispositionDigest = `sha256:${marker.toString(16).padStart(64, "0")}`;
  const { data: disposition, error: dispositionError } = await admin.rpc("disposition_skill_report", {
    p_report_id: reportId,
    p_disposition_code: "no-action",
    p_reason_code: "not-reproducible",
    p_public_message: "Operator review found no actionable catalog change from the bounded evidence.",
    p_idempotency_digest: dispositionDigest
  });
  if (dispositionError || disposition?.[0]?.report_state !== "resolved") throw dispositionError ?? new Error("Report disposition did not resolve.");

  await page.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  await page.getByText("Resolved", { exact: true }).waitFor();
  await page.getByText("Operator review found no actionable catalog change from the bounded evidence.").waitFor();
  assertNoOverflow(await dimensions(page), "resolved report history");

  smokeStage = "account-export";
  const exportResponse = await primaryContext.request.get(new URL("/account/export", baseUrl).toString());
  if (exportResponse.status() !== 200) throw new Error(`Account export returned HTTP ${exportResponse.status()}.`);
  assertPrivateNoStore(exportResponse.headers(), "account export");
  const exported = await exportResponse.json();
  const exportedReport = exported.reports?.find((entry) => entry.report_id === reportId);
  if (!exportedReport || exportedReport.state !== "resolved") throw new Error("Account export omitted the resolved owner report.");

  smokeStage = "account-deletion";
  await page.goto(new URL("/account#account-data", baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel(/Type “delete my skillmap account”/).fill("delete my skillmap account");
  await submitForm(page.getByRole("button", { name: "Delete account permanently" }));
  await waitForUrl(page, (url) => url.pathname === "/sign-in" && url.searchParams.get("status") === "account-deleted", "account deletion redirect");
  const remainingAuthCookies = (await primaryContext.cookies()).filter((cookie) => /auth-token/i.test(cookie.name));
  if (remainingAuthCookies.length) throw new Error("Deleted account left auth cookies behind.");
  const { data: deletedUser } = await admin.auth.admin.getUserById(primary.userId);
  if (deletedUser.user) throw new Error("Account deletion left the primary auth row behind.");
  const deletedApiListing = await secondaryContext.request.get(new URL(`/api/v1/skills/${publishedSkillId}`, baseUrl).toString());
  if (deletedApiListing.status() !== 404) throw new Error(`Account deletion left the submission-derived listing public through the API (HTTP ${deletedApiListing.status()}).`);
  const deletedListing = await secondaryContext.request.get(new URL(receiptDetailPath, baseUrl).toString());
  const deletedListingBody = await deletedListing.text();
  if (deletedListingBody.includes("Browser Evidence Rendering") || !deletedListingBody.includes("That SkillMap route does not exist.")) {
    throw new Error(`Account deletion did not replace the submission-derived page with the bounded not-found surface (HTTP ${deletedListing.status()}).`);
  }

  if (diagnostics.length) throw new Error(`Authenticated browser diagnostics:\n${diagnostics.join("\n")}`);
  passReceipt = {
    result: "pass",
    submissionValidation: { fieldLocal: true, valuesPreserved: true, invalidRows: 0, correctedRows: 1, responsive: "390px" },
    publicEvidence: {
      noRow: { audit: "bounded-no-row-state", grade: "bounded-no-row-state", auditWidth, gradeWidth },
      receiptRows: { audit: "rendered", grade: "rendered-provisional-letterless", receiptAuditWidth, receiptGradeWidth, privateDigest: "absent" }
    },
    report: { strictInputCoveredByFocusedTest: true, queued: reportId, cooldown: true, escapedText: true },
    ownerIsolation: "passed",
    dispositionHistory: "resolved",
    export: "owner-report-included-private-no-store",
    accountDeletion: "user-session-report-submission-and-derived-public-listing-removed",
    responsive: { historyWidth },
    diagnostics: 0
  };
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? ` (${error.code})`
    : "";
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
  primaryError = new Error(`Hosted launch smoke failed at ${smokeStage}${code}: ${message || "provider returned an empty error"}`);
} finally {
  const cleanupErrors = [];
  try {
    await browser?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  let authUsersRemaining = userIds.length;
  try {
    authUsersRemaining = await deleteAndVerifySyntheticUsers(userIds);
  } catch (error) {
    cleanupErrors.push(error);
  }
  let catalogRowsRemaining = { publishers: 0, repositories: 0, skills: 0, versions: 0 };
  if (syntheticCatalogIdentity) {
    try {
      catalogRowsRemaining = cleanupPublishedFixture(syntheticCatalogIdentity);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  cleanupReceipt = {
    verified: cleanupErrors.length === 0 && authUsersRemaining === 0,
    authUsersRemaining,
    catalogRowsRemaining
  };
  if (cleanupErrors.length) {
    primaryError = primaryError
      ? new AggregateError([primaryError, ...cleanupErrors], "Hosted launch smoke and cleanup failed.")
      : new AggregateError(cleanupErrors, "Hosted launch smoke cleanup failed.");
  }
}

if (primaryError) throw primaryError;
if (!passReceipt || !cleanupReceipt?.verified) throw new Error("Hosted launch smoke ended without a verified cleanup receipt.");
process.stdout.write(`${JSON.stringify({ ...passReceipt, cleanup: cleanupReceipt })}\n`);

async function createSyntheticUser(role) {
  const email = `report-prod-${role}-${marker}@skillmap.invalid`;
  const password = `Local-smoke-${crypto.randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error(`Could not create ${role} user.`);
  userIds.push(created.user.id);
  const cookieJar = new Map();
  const auth = createServerClient(supabaseUrl, publishableKey, {
    db: { schema: "api" },
    cookies: {
      getAll: () => [...cookieJar.values()],
      setAll: (entries) => entries.forEach((entry) => cookieJar.set(entry.name, entry))
    }
  });
  const { error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { error: profileError } = await auth.from("profiles").insert({ user_id: created.user.id });
  if (profileError) throw profileError;
  return { userId: created.user.id, cookies: [...cookieJar.values()] };
}

function auditReceiptPayload(workerVersion) {
  return {
    state: "passed",
    receiptDigest: digest("a"),
    sourceContentDigest: digest("b"),
    normalizedContentDigest: digest("c"),
    policyVersion: "skillmap-static-audit/v1",
    hostProfileVersion: "codex-host/v1",
    workerVersion,
    findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    publicChecks: [{ code: "source-integrity", outcome: "passed", severity: "info", evidenceDigest: digest("e") }],
    reasonCodes: [],
    privateEvidenceDigest: digest("d"),
    licenseState: "confirmed",
    spdxExpression: "MIT",
    permissionScripts: false,
    networkIndicators: false,
    toolIndicators: false
  };
}

function gradeReceiptPayload(auditReceiptDigest) {
  return {
    state: "provisional",
    receiptDigest: digest("f"),
    totalScore: 82,
    confidence: 0.35,
    normalizedContentDigest: digest("c"),
    auditReceiptDigest,
    compatibilityEvidenceDigest: digest("9"),
    evaluationSuiteDigest: null,
    rubricVersion: "skillmap-rubric/v1",
    hostProfileVersion: "codex-host/v1",
    evaluatorVersion: "skillmap-grader/1.0.0",
    hardGates: [
      { code: "source-identity", passed: true, evidenceDigest: digest("8") },
      { code: "audit-acceptable", passed: true, evidenceDigest: digest("8") },
      { code: "license-confirmed", passed: true, evidenceDigest: digest("8") },
      { code: "compatibility-evidence-bound", passed: true, evidenceDigest: digest("9") },
      { code: "behavioral-evidence-bound", passed: false, evidenceDigest: null }
    ],
    dimensions: [
      { code: "instruction-quality", weight: 0.25, score: 83, evidenceDigest: digest("7") },
      { code: "safety-and-permissions", weight: 0.25, score: 82, evidenceDigest: digest("7") },
      { code: "routing-quality", weight: 0.20, score: 82, evidenceDigest: digest("7") },
      { code: "reproducibility", weight: 0.15, score: 82, evidenceDigest: digest("7") },
      { code: "maintenance-and-provenance", weight: 0.15, score: 78, evidenceDigest: digest("7") }
    ],
    reasonCodes: ["behavioral-evidence-incomplete"]
  };
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

async function deleteAndVerifySyntheticUsers(ids) {
  const failures = [];
  for (const userId of ids) {
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && !/not found/i.test(error.message)) failures.push(error);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const userId of ids) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (data?.user) failures.push(new Error(`Synthetic auth user remained after cleanup (${userId}).`));
      if (error && !/not found/i.test(error.message)) failures.push(error);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Synthetic auth-user cleanup failed.");
  return 0;
}

function cleanupPublishedFixture(identity) {
  const { publisherHandle, repositoryUrl, publisherId, skillId, versionId } = identity;
  if (!/^browser-smoke-[0-9]{10,16}$/.test(publisherHandle)
    || repositoryUrl !== `https://github.com/${publisherHandle}/skills`
    || (publisherId !== null && !/^pub_[0-9a-f]{32}$/.test(publisherId))
    || (skillId !== null && !/^skl_[0-9a-f]{32}$/.test(skillId))
    || (versionId !== null && !/^skv_[0-9a-f]{32}$/.test(versionId))) {
    throw new Error("Refusing non-canonical browser catalog cleanup.");
  }
  const publisherIdPredicate = publisherId ? `or public_id = '${publisherId}'` : "";
  const skillIdPredicate = skillId ? `or public_id = '${skillId}'` : "";
  const versionIdPredicate = versionId ? `or public_id = '${versionId}'` : "";
  const sql = `
    begin;
    update private.skills skill set current_version_id = null
      where skill.publisher_id in (select id from private.publishers where handle = '${publisherHandle}' ${publisherIdPredicate});
    delete from private.skill_versions version
      where version.skill_id in (select id from private.skills where publisher_id in
        (select id from private.publishers where handle = '${publisherHandle}' ${publisherIdPredicate}))
        ${versionId ? `or version.public_id = '${versionId}'` : ""};
    delete from private.skills skill
      where skill.publisher_id in (select id from private.publishers where handle = '${publisherHandle}');
    delete from private.source_repositories repository
      where repository.publisher_id in (select id from private.publishers where handle = '${publisherHandle}' ${publisherIdPredicate})
        or repository.repository_url = '${repositoryUrl}';
    delete from private.publishers where handle = '${publisherHandle}' ${publisherIdPredicate};
    commit;
    select json_build_object(
      'publishers', (select count(*)::integer from private.publishers where handle = '${publisherHandle}' ${publisherIdPredicate}),
      'repositories', (select count(*)::integer from private.source_repositories where repository_url = '${repositoryUrl}'),
      'skills', (select count(*)::integer from private.skills where false ${skillIdPredicate}),
      'versions', (select count(*)::integer from private.skill_versions where false ${versionIdPredicate})
    )::text;
  `;
  const output = execFileSync(
    "psql",
    [databaseUrl, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  const counts = JSON.parse(output.split(/\r?\n/).at(-1) ?? "{}");
  if (Object.keys(counts).sort().join(",") !== "publishers,repositories,skills,versions"
    || Object.values(counts).some((value) => value !== 0)) {
    throw new Error(`Synthetic catalog cleanup left rows behind (${JSON.stringify(counts)}).`);
  }
  return counts;
}

function toBrowserCookies(cookies) {
  return cookies.map(({ name, value, options = {} }) => ({
    name, value, url: baseUrl, httpOnly: options.httpOnly ?? false, secure: false,
    sameSite: options.sameSite === "strict" ? "Strict" : options.sameSite === "none" ? "None" : "Lax"
  }));
}

function collectDiagnostics(page) {
  const values = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) values.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => values.push(`pageerror: ${error.message}`));
  return values;
}

async function dimensions(page) {
  return page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
}

function assertNoOverflow(width, label) {
  if (width.scroll > width.inner) throw new Error(`${label} overflows (${width.scroll} > ${width.inner}).`);
}

function assertPrivateNoStore(headers, label) {
  const value = headers["cache-control"] ?? "";
  if (!/private/i.test(value) || !/no-store/i.test(value)) throw new Error(`${label} cache boundary is unsafe (${value}).`);
}

async function submitForm(button) {
  const valid = await button.evaluate((element) => element.closest("form")?.checkValidity() ?? false);
  if (!valid) throw new Error("Browser form constraints rejected the intended smoke payload.");
  await button.evaluate((element) => element.closest("form")?.requestSubmit());
}

async function waitForUrl(page, predicate, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (predicate(new URL(page.url()))) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${label} timed out at ${page.url()}: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500)}`);
}
