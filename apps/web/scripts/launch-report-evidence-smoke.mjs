import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { execLocalPsql } from "./local-supabase-psql.mjs";

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
const operatorAuthority = createEphemeralOperatorAuthority();
const dualControlEvidence = {
  approvals: 0,
  executions: 0,
  samePersonWrongRoleDenied: false,
  serviceRoleOnlyDenied: []
};
const detailPath = "/skills/0x3-team/skill-audit";
const reportMessage = "Potential issue: <img src=x onerror=alert(1)> appears in listing metadata.";
const queuedConflictMessage = "A second explanation must recover the existing queued target instead of claiming an unavailable service.";
const userIds = [];
let browser;
let smokeStage = "browser-start";
let syntheticCatalogIdentity = null;
let passReceipt = null;
let cleanupReceipt = null;
let primaryError = null;

try {
  smokeStage = "operator-principal-seed";
  seedOperatorPrincipals(operatorAuthority);

  browser = await chromium.launch({ headless: true });
  smokeStage = "anonymous-acquisition";
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const publicPage = await publicContext.newPage();
  publicPage.setDefaultTimeout(20_000);
  const publicDiagnostics = collectDiagnostics(publicPage);
  const anonymousAcquisition = {};
  for (const viewport of [{ width: 320, height: 760 }, { width: 390, height: 844 }]) {
    anonymousAcquisition[viewport.width] = await runAnonymousAcquisitionJourney(publicPage, viewport);
  }
  const { auditWidth, gradeWidth } = anonymousAcquisition[390];

  smokeStage = "signed-out-forged-notices";
  await publicPage.setViewportSize({ width: 390, height: 844 });
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
  await publicPage.goto(new URL("/sign-in?status=account-deleted", baseUrl).toString(), { waitUntil: "load" });
  if (await publicPage.getByText("Your SkillMap account was deleted and this browser session was cleared.", { exact: true }).isVisible().catch(() => false)) {
    throw new Error("Query parameters forged an account-deletion success notice.");
  }
  await publicPage.goto(new URL("/sign-in?status=account-delete-unconfirmed", baseUrl).toString(), { waitUntil: "load" });
  if ((await publicPage.locator("body").innerText()).includes("browser session was cleared defensively")) {
    throw new Error("Query parameters forged an unconfirmed browser-session mutation claim.");
  }
  if (publicDiagnostics.length) throw new Error(`Public browser diagnostics:\n${publicDiagnostics.join("\n")}`);
  await publicContext.close();

  smokeStage = "synthetic-account-setup";
  const primary = await createSyntheticUser("primary");
  const secondary = await createSyntheticUser("secondary");
  const quota = await createSyntheticUser("quota");
  const primaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const secondaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const quotaContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await primaryContext.addCookies(toBrowserCookies(primary.cookies));
  await secondaryContext.addCookies(toBrowserCookies(secondary.cookies));
  await quotaContext.addCookies(toBrowserCookies(quota.cookies));

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

  smokeStage = "forged-submission-statuses";
  const forgedSubmissionId = `sub_${"f".repeat(32)}`;
  await page.goto(new URL(`/submit?status=duplicate&submission=${forgedSubmissionId}`, baseUrl).toString(), { waitUntil: "load" });
  if (await page.getByText("That exact source already has a submission record", { exact: true }).isVisible().catch(() => false)) {
    throw new Error("Query parameters forged a duplicate-submission notice without an owner row.");
  }
  for (const [status, title] of [["queued", "Submission queued"], ["withdrawn", "Queued submission withdrawn"]]) {
    await page.goto(new URL(`/account/submissions?status=${status}&submission=${forgedSubmissionId}`, baseUrl).toString(), { waitUntil: "load" });
    if (await page.getByText(title, { exact: true }).isVisible().catch(() => false)) {
      throw new Error(`Query parameters forged a ${status} submission notice without an owner row.`);
    }
  }

  smokeStage = "submission-transport-failure";
  const transportPage = await primaryContext.newPage();
  try {
    let transportAborted = false;
    await transportPage.route("**/submit", async (route) => {
      if (!transportAborted && route.request().method() === "POST") {
        transportAborted = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await transportPage.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
    await transportPage.getByLabel("Public GitHub repository URL").fill(syntheticRepositoryUrl);
    await transportPage.getByLabel("Exact commit").fill("c".repeat(40));
    await transportPage.getByLabel("Relative skill path").fill("skills/transport/SKILL.md");
    await transportPage.getByLabel("Version label").fill(`transport-${marker}`);
    await transportPage.getByLabel("License claim").selectOption("MIT");
    await transportPage.locator("#authorizationAcknowledgement").check();
    await transportPage.locator("#untrustedContentAcknowledgement").check();
    const transportRequestId = await transportPage.getByLabel("Request ID").inputValue();
    await submitForm(transportPage.getByRole("button", { name: "Queue submission" }));
    await transportPage.getByText("Submission service unavailable", { exact: true }).waitFor();
    const transportPreserved = {
      repository: await transportPage.getByLabel("Public GitHub repository URL").inputValue(),
      commit: await transportPage.getByLabel("Exact commit").inputValue(),
      path: await transportPage.getByLabel("Relative skill path").inputValue(),
      version: await transportPage.getByLabel("Version label").inputValue(),
      license: await transportPage.getByLabel("License claim").inputValue(),
      requestId: await transportPage.getByLabel("Request ID").inputValue(),
      authority: await transportPage.locator("#authorizationAcknowledgement").isChecked(),
      untrusted: await transportPage.locator("#untrustedContentAcknowledgement").isChecked()
    };
    if (!transportAborted
      || transportPreserved.repository !== syntheticRepositoryUrl
      || transportPreserved.commit !== "c".repeat(40)
      || transportPreserved.path !== "skills/transport/SKILL.md"
      || transportPreserved.version !== `transport-${marker}`
      || transportPreserved.license !== "MIT"
      || transportPreserved.requestId !== transportRequestId
      || !transportPreserved.authority
      || !transportPreserved.untrusted
      || await transportPage.getByRole("button", { name: "Queue submission" }).isDisabled()) {
      throw new Error(`Transport failure did not preserve a retryable submission form (${JSON.stringify(transportPreserved)}).`);
    }
  } finally {
    await transportPage.close();
  }

  smokeStage = "submission-server-quota-failure";
  const quotaFixturePaths = [];
  for (let index = 0; index < 3; index += 1) {
    const idempotencyKey = crypto.randomUUID();
    const sourcePath = `skills/quota-${index}/SKILL.md`;
    quotaFixturePaths.push(sourcePath);
    const { error: quotaFixtureError } = await quota.client.from("skill_submissions").insert({
      repository_url: syntheticRepositoryUrl,
      source_commit: `${index + 1}`.repeat(40),
      source_path: sourcePath,
      version_label: `quota-${marker}-${index}`,
      license_claim: "MIT",
      idempotency_key: idempotencyKey,
      submission_policy_version: "public-alpha-draft/v1",
      authority_confirmed: true,
      untrusted_processing_accepted: true
    });
    if (quotaFixtureError) throw quotaFixtureError;
  }
  const quotaPage = await quotaContext.newPage();
  try {
    const quotaCommit = "d".repeat(40);
    const quotaPath = "skills/quota-target/SKILL.md";
    const quotaVersion = `quota-target-${marker}`;
    await quotaPage.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
    await quotaPage.getByLabel("Public GitHub repository URL").fill(syntheticRepositoryUrl);
    await quotaPage.getByLabel("Exact commit").fill(quotaCommit);
    await quotaPage.getByLabel("Relative skill path").fill(quotaPath);
    await quotaPage.getByLabel("Version label").fill(quotaVersion);
    await quotaPage.getByLabel("License claim").selectOption("MIT");
    await quotaPage.locator("#authorizationAcknowledgement").check();
    await quotaPage.locator("#untrustedContentAcknowledgement").check();
    const quotaRequestId = await quotaPage.getByLabel("Request ID").inputValue();
    await submitForm(quotaPage.getByRole("button", { name: "Queue submission" }));
    const quotaAlert = quotaPage.getByRole("alert").filter({ hasText: "Submission quota reached" });
    await quotaAlert.getByText("Submission quota reached", { exact: true }).waitFor();
    await quotaPage.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
    const quotaPreserved = {
      repository: await quotaPage.getByLabel("Public GitHub repository URL").inputValue(),
      commit: await quotaPage.getByLabel("Exact commit").inputValue(),
      path: await quotaPage.getByLabel("Relative skill path").inputValue(),
      version: await quotaPage.getByLabel("Version label").inputValue(),
      license: await quotaPage.getByLabel("License claim").inputValue(),
      requestId: await quotaPage.getByLabel("Request ID").inputValue(),
      authority: await quotaPage.locator("#authorizationAcknowledgement").isChecked(),
      untrusted: await quotaPage.locator("#untrustedContentAcknowledgement").isChecked(),
      alertFocused: await quotaAlert.evaluate((element) => element === document.activeElement)
    };
    const { count: quotaTargetCount, error: quotaTargetError } = await quota.client
      .from("my_skill_submissions")
      .select("submission_id", { count: "exact", head: true })
      .eq("repository_url", syntheticRepositoryUrl)
      .eq("source_commit", quotaCommit)
      .eq("source_path", quotaPath);
    if (quotaTargetError) throw quotaTargetError;
    if (quotaPreserved.repository !== syntheticRepositoryUrl
      || quotaPreserved.commit !== quotaCommit
      || quotaPreserved.path !== quotaPath
      || quotaPreserved.version !== quotaVersion
      || quotaPreserved.license !== "MIT"
      || quotaPreserved.requestId !== quotaRequestId
      || !quotaPreserved.authority
      || !quotaPreserved.untrusted
      || !quotaPreserved.alertFocused
      || await quotaPage.getByRole("button", { name: "Queue submission" }).isDisabled()
      || quotaTargetCount !== 0) {
      throw new Error(`Server quota failure did not preserve a retryable zero-insert form (${JSON.stringify({ quotaPreserved, quotaTargetCount })}).`);
    }
  } finally {
    await quotaPage.close();
  }
  const { data: quotaFixtureRows, error: quotaFixtureLookupError } = await quota.client
    .from("my_skill_submissions")
    .select("submission_id,source_path,state")
    .eq("repository_url", syntheticRepositoryUrl)
    .in("source_path", quotaFixturePaths);
  if (quotaFixtureLookupError || !Array.isArray(quotaFixtureRows) || quotaFixtureRows.length !== 3
    || quotaFixtureRows.some((row) => row.state !== "queued" || !quotaFixturePaths.includes(row.source_path))) {
    throw quotaFixtureLookupError ?? new Error("Quota fixtures were not exactly owner-visible and queued before cleanup.");
  }
  const quotaFixtureIds = quotaFixtureRows.map((row) => row.submission_id);
  const { error: quotaCleanupError } = await quota.client
    .from("skill_submissions")
    .update({ state: "withdrawn" })
    .eq("state", "queued")
    .in("public_id", quotaFixtureIds);
  if (quotaCleanupError) throw quotaCleanupError;
  const { data: withdrawnQuotaRows, error: quotaCleanupVerificationError } = await quota.client
    .from("my_skill_submissions")
    .select("submission_id,state")
    .in("submission_id", quotaFixtureIds);
  if (quotaCleanupVerificationError || !Array.isArray(withdrawnQuotaRows) || withdrawnQuotaRows.length !== 3
    || withdrawnQuotaRows.some((row) => row.state !== "withdrawn")) {
    throw quotaCleanupVerificationError ?? new Error("Quota fixtures were not safely withdrawn after the recovery test.");
  }
  await quotaContext.close();

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
  const workerVersion = "skillmap-worker/0.2.0";
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
  const { data: licenseEvidence, error: licenseEvidenceError } = await admin.rpc("record_skill_submission_license_evidence", {
    p_submission_id: submissionId,
    p_claim_id: claims[0].claim_id,
    p_worker_version: workerVersion,
    p_audit_receipt_digest: auditReceipt.receiptDigest,
    p_spdx_expression: "MIT",
    p_evidence: [{
      repositoryUrl: syntheticRepositoryUrl,
      sourceCommit: "a".repeat(40),
      path: "LICENSE",
      contentDigest: digest("5")
    }],
    p_review_reference: `licref_${marker.toString(16).padStart(32, "0")}`,
    p_review_evidence_digest: digest("6"),
    p_idempotency_digest: digest("5")
  });
  if (licenseEvidenceError || !/^lic_[0-9a-f]{32}$/.test(licenseEvidence?.[0]?.license_evidence_receipt_id ?? "")) {
    throw licenseEvidenceError ?? new Error("Receipt-backed browser fixture did not record exact-commit license evidence.");
  }
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

  const authorizationBasis = "publisher-consent";
  const authorizationEvidenceReference = `authref_${marker.toString(16).padStart(32, "0")}`;
  const authorizationEvidenceDigest = digest("6");
  const authorizationExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const authorizationOperationId = crypto.randomUUID();
  const authorizationDigest = canonicalActionDigest({
    kind: "skillmap.hosted-publisher-authorization-request",
    schemaVersion: 1,
    submissionId,
    publisherHandle,
    decision: "authorized",
    basis: authorizationBasis,
    evidenceReference: authorizationEvidenceReference,
    evidenceDigest: authorizationEvidenceDigest,
    expiresAt: authorizationExpiresAt,
    operationId: authorizationOperationId
  });
  const authorizationParameters = {
    p_submission_id: submissionId,
    p_publisher_handle: publisherHandle,
    p_decision: "authorized",
    p_authorization_basis: authorizationBasis,
    p_evidence_reference: authorizationEvidenceReference,
    p_evidence_digest: authorizationEvidenceDigest,
    p_expires_at: authorizationExpiresAt,
    p_idempotency_digest: authorizationDigest
  };
  const authorization = await runDualControlledBusinessRpc({
    actionKind: "submission.publisher-authorization",
    subjectType: "submission",
    subjectId: submissionId,
    actionPayload: {
      schemaVersion: 1,
      submissionId,
      publisherHandle,
      decision: "authorized",
      authorizationBasis,
      evidenceReference: authorizationEvidenceReference,
      evidenceDigest: authorizationEvidenceDigest,
      expiresAt: authorizationExpiresAt
    },
    actionDigest: authorizationDigest,
    operationId: authorizationOperationId,
    rpcName: "record_skill_submission_publisher_authorization",
    rpcParameters: authorizationParameters,
    proveSamePersonWrongRole: true,
    label: "publisher authorization"
  });
  if (authorization?.[0]?.authorization_decision !== "authorized") {
    throw new Error("Receipt-backed browser fixture did not record exact-source publisher authorization.");
  }

  const skillSlug = "evidence-rendering";
  const publicationMetadata = {
    publisherHandle,
    publisherDisplayName: "Browser smoke publisher",
    skillSlug,
    skillDisplayName: "Browser Evidence Rendering",
    summary: "A disposable metadata-only skill used to verify public evidence rendering.",
    description: "A disposable local browser-smoke listing backed by schema-valid audit and provisional grade receipts. It is deleted from public projections before cleanup.",
    capabilities: ["evidence.rendering"],
    licenseState: "confirmed",
    spdxExpression: "MIT",
    permissionScripts: false,
    permissionNetwork: [],
    permissionTools: []
  };
  const publicationOperationId = crypto.randomUUID();
  const publicationDigest = canonicalActionDigest({
    kind: "skillmap.hosted-publication-request",
    schemaVersion: 1,
    submissionId,
    metadata: publicationMetadata,
    operationId: publicationOperationId
  });
  const publicationParameters = {
    p_submission_id: submissionId,
    p_publication_digest: publicationDigest,
    p_publisher_handle: publicationMetadata.publisherHandle,
    p_publisher_display_name: publicationMetadata.publisherDisplayName,
    p_skill_slug: publicationMetadata.skillSlug,
    p_skill_display_name: publicationMetadata.skillDisplayName,
    p_summary: publicationMetadata.summary,
    p_description: publicationMetadata.description,
    p_capabilities: publicationMetadata.capabilities,
    p_license_state: publicationMetadata.licenseState,
    p_spdx_expression: publicationMetadata.spdxExpression,
    p_permission_scripts: publicationMetadata.permissionScripts,
    p_permission_network: publicationMetadata.permissionNetwork,
    p_permission_tools: publicationMetadata.permissionTools
  };
  const published = await runDualControlledBusinessRpc({
    actionKind: "submission.publish",
    subjectType: "submission",
    subjectId: submissionId,
    actionPayload: {
      schemaVersion: 1,
      submissionId,
      publisherHandle: publicationMetadata.publisherHandle,
      publisherDisplayName: publicationMetadata.publisherDisplayName,
      skillSlug: publicationMetadata.skillSlug,
      skillDisplayName: publicationMetadata.skillDisplayName,
      summary: publicationMetadata.summary,
      description: publicationMetadata.description,
      capabilities: publicationMetadata.capabilities,
      licenseState: publicationMetadata.licenseState,
      spdxExpression: publicationMetadata.spdxExpression,
      permissionScripts: publicationMetadata.permissionScripts,
      permissionNetwork: publicationMetadata.permissionNetwork,
      permissionTools: publicationMetadata.permissionTools
    },
    actionDigest: publicationDigest,
    operationId: publicationOperationId,
    rpcName: "publish_skill_submission",
    rpcParameters: publicationParameters,
    label: "publication"
  });
  if (published?.[0]?.submission_state !== "published") throw new Error("Receipt-backed browser fixture was not published.");
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
  await page.getByText(/^Updated /).first().waitFor();
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

  smokeStage = "submission-withdrawal";
  const withdrawalPath = "skills/withdrawal/SKILL.md";
  await page.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Public GitHub repository URL").fill(syntheticRepositoryUrl);
  await page.getByLabel("Exact commit").fill("b".repeat(40));
  await page.getByLabel("Relative skill path").fill(withdrawalPath);
  await page.getByLabel("Version label").fill(`withdraw-${marker}`);
  await page.getByLabel("License claim").selectOption("MIT");
  await page.locator("#authorizationAcknowledgement").check();
  await page.locator("#untrustedContentAcknowledgement").check();
  await submitForm(page.getByRole("button", { name: "Queue submission" }));
  await waitForUrl(page, (url) => url.pathname === "/account/submissions" && url.searchParams.get("status") === "queued", "withdrawal fixture redirect");
  const withdrawalId = new URL(page.url()).searchParams.get("submission");
  if (!withdrawalId || !/^sub_[0-9a-f]{32}$/.test(withdrawalId)) throw new Error("Withdrawal fixture omitted a canonical submission ID.");
  await page.getByText("Submission queued", { exact: true }).waitFor();

  const submissionIsolationPage = await secondaryContext.newPage();
  try {
    await submissionIsolationPage.goto(new URL("/account/submissions", baseUrl).toString(), { waitUntil: "load" });
    await submissionIsolationPage.getByRole("heading", { name: "No submissions yet" }).waitFor();
    if ((await submissionIsolationPage.locator("body").innerText()).includes(withdrawalId)) {
      throw new Error("Queued submission leaked into another account projection.");
    }
  } finally {
    await submissionIsolationPage.close();
  }

  const withdrawalCard = page.locator("article").filter({ hasText: withdrawalPath });
  await withdrawalCard.getByRole("button", { name: "Withdraw queued request" }).waitFor();
  await submitForm(withdrawalCard.getByRole("button", { name: "Withdraw queued request" }));
  await waitForUrl(page, (url) => url.pathname === "/account/submissions"
    && url.searchParams.get("status") === "withdrawn"
    && url.searchParams.get("submission") === withdrawalId, "withdrawal redirect");
  await page.getByText("Queued submission withdrawn", { exact: true }).waitFor();
  const withdrawnCard = page.locator("article").filter({ hasText: withdrawalPath });
  await withdrawnCard.getByText("Withdrawn", { exact: true }).first().waitFor();
  if (await withdrawnCard.getByRole("button", { name: "Withdraw queued request" }).isVisible().catch(() => false)) {
    throw new Error("Withdrawn submission still exposed the queued-only withdrawal control.");
  }
  const { data: withdrawnProjection, error: withdrawnProjectionError } = await primary.client
    .from("my_skill_submissions")
    .select("submission_id,state")
    .eq("submission_id", withdrawalId)
    .maybeSingle();
  if (withdrawnProjectionError || withdrawnProjection?.submission_id !== withdrawalId || withdrawnProjection.state !== "withdrawn") {
    throw withdrawnProjectionError ?? new Error("Owner projection did not confirm the queued-to-withdrawn transition.");
  }

  smokeStage = "terminal-submission-duplicate";
  await page.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Public GitHub repository URL").fill(syntheticRepositoryUrl);
  await page.getByLabel("Exact commit").fill("b".repeat(40));
  await page.getByLabel("Relative skill path").fill(withdrawalPath);
  await page.getByLabel("Version label").fill(`withdrawn-duplicate-${marker}`);
  await page.getByLabel("License claim").selectOption("MIT");
  await page.locator("#authorizationAcknowledgement").check();
  await page.locator("#untrustedContentAcknowledgement").check();
  await submitForm(page.getByRole("button", { name: "Queue submission" }));
  await waitForUrl(page, (url) => url.pathname === "/submit"
    && url.searchParams.get("status") === "duplicate"
    && url.searchParams.get("submission") === withdrawalId, "terminal duplicate redirect");
  await page.getByText("That exact source already has a submission record", { exact: true }).waitFor();
  await page.getByText(`Submission ${withdrawalId} is retained in your account history. Inspect its current state before deciding what to do next.`, { exact: true }).waitFor();
  const submissionHistoryLink = page.getByRole("link", { name: "Open submission history" });
  if (await submissionHistoryLink.getAttribute("href") !== "/account/submissions") {
    throw new Error("Terminal duplicate notice did not point to owner submission history.");
  }
  if (await page.getByText("That exact source is already in your queue", { exact: true }).isVisible().catch(() => false)) {
    throw new Error("A terminal duplicate was mislabeled as still queued.");
  }

  smokeStage = "report-queue-and-cooldown";
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("button", { name: "Queue private report" }).waitFor();
  await page.waitForTimeout(1_000);
  await assertMobileSkillActionOrder(page, "Save skill", "authenticated skill detail");
  assertNoOverflow(await dimensions(page), "authenticated report form");

  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(reportMessage);
  const reportRequestId = await page.getByLabel("Request ID").inputValue();
  if (!/^[0-9a-f-]{36}$/.test(reportRequestId)) throw new Error("Report form did not mint a canonical request ID.");
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

  smokeStage = "report-queued-constraint-recovery";
  // A queued report can outlive the 24-hour cooldown. Reproduce that valid
  // state without weakening the production immutability trigger, then prove
  // the partial unique-index conflict resolves to the account-owned row.
  execLocalPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-AtX", "-c",
    `begin; set local session_replication_role = replica; update api.skill_reports set created_at = now() - interval '25 hours' where public_id = '${reportId}'; commit;`
  ], { stdio: ["ignore", "ignore", "pipe"] });
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(queuedConflictMessage);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await page.getByText("That report request already exists", { exact: true }).waitFor();
  await page.getByText(`Existing report ${reportId} remains the account-owned source of truth. No second report was created.`, { exact: true }).waitFor();
  const { count: queuedTargetCount, error: queuedTargetCountError } = await primary.client
    .from("my_skill_reports")
    .select("report_id", { count: "exact", head: true })
    .eq("category", "security")
    .eq("state", "queued");
  if (queuedTargetCountError || queuedTargetCount !== 1) {
    throw queuedTargetCountError ?? new Error(`Queued-target conflict created an unexpected row count (${queuedTargetCount}).`);
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
  const dispositionCode = "no-action";
  const dispositionReasonCode = "not-reproducible";
  const dispositionPublicMessage = "Operator review found no actionable catalog change from the bounded evidence.";
  const dispositionLifecycleAction = null;
  const dispositionOperationId = crypto.randomUUID();
  const dispositionDigest = canonicalActionDigest({
    kind: "skillmap.report-disposition-operation",
    schemaVersion: 1,
    operationId: dispositionOperationId,
    reportId,
    disposition: dispositionCode,
    reasonCode: dispositionReasonCode,
    publicMessage: dispositionPublicMessage,
    lifecycleAction: dispositionLifecycleAction
  });
  const dispositionParameters = {
    p_report_id: reportId,
    p_disposition_code: dispositionCode,
    p_reason_code: dispositionReasonCode,
    p_public_message: dispositionPublicMessage,
    p_lifecycle_action: dispositionLifecycleAction,
    p_idempotency_digest: dispositionDigest
  };
  const disposition = await runDualControlledBusinessRpc({
    actionKind: "report.disposition",
    subjectType: "report",
    subjectId: reportId,
    actionPayload: {
      schemaVersion: 1,
      reportId,
      dispositionCode,
      reasonCode: dispositionReasonCode,
      publicMessage: dispositionPublicMessage,
      lifecycleAction: dispositionLifecycleAction
    },
    actionDigest: dispositionDigest,
    operationId: dispositionOperationId,
    rpcName: "disposition_skill_report",
    rpcParameters: dispositionParameters,
    label: "report disposition"
  });
  if (disposition?.[0]?.report_state !== "resolved") throw new Error("Report disposition did not resolve.");

  await page.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  await page.getByText("Resolved", { exact: true }).waitFor();
  await page.getByText(dispositionPublicMessage).waitFor();
  assertNoOverflow(await dimensions(page), "resolved report history");

  smokeStage = "report-request-id-payload-conflict";
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(queuedConflictMessage);
  await page.getByLabel("Request ID").evaluate((input, value) => {
    input.removeAttribute("readonly");
    input.value = value;
  }, reportRequestId);
  if (await page.getByLabel("Request ID").inputValue() !== reportRequestId) {
    throw new Error("Request-ID conflict fixture did not preserve the prior request UUID.");
  }
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await page.getByText("Reporting service unavailable", { exact: true }).waitFor();
  const { count: requestConflictCount, error: requestConflictCountError } = await primary.client
    .from("my_skill_reports")
    .select("report_id", { count: "exact", head: true });
  if (requestConflictCountError || requestConflictCount !== 1) {
    throw requestConflictCountError ?? new Error(`Conflicting request UUID changed the report row count (${requestConflictCount}).`);
  }

  smokeStage = "report-resolved-history-queued-authority-recovery";
  // Reproduce the ambiguous 23505 boundary: historical report A is resolved,
  // report B is the current queued target, and a fresh submission matching A's
  // old text is blocked by B's partial unique index. Recovery must identify B.
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(queuedConflictMessage);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await waitForUrl(page, (url) => url.searchParams.get("reportStatus") === "queued", "second queued report redirect");
  const blockingQueuedReportId = new URL(page.url()).searchParams.get("report");
  if (!blockingQueuedReportId || !/^rpt_[0-9a-f]{32}$/.test(blockingQueuedReportId)
    || blockingQueuedReportId === reportId) {
    throw new Error("Second queued report did not return a distinct canonical receipt ID.");
  }
  execLocalPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-AtX", "-c",
    `begin; set local session_replication_role = replica; update api.skill_reports set created_at = now() - interval '25 hours' where public_id = '${blockingQueuedReportId}'; commit;`
  ], { stdio: ["ignore", "ignore", "pipe"] });
  await page.goto(new URL(detailPath, baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Concern category").selectOption("security");
  await page.getByLabel("What is wrong with this listing?").fill(reportMessage);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await page.getByText("That report request already exists", { exact: true }).waitFor();
  await page.getByText(`Existing report ${blockingQueuedReportId} remains the account-owned source of truth. No second report was created.`, { exact: true }).waitFor();
  const { count: recoveredQueuedCount, error: recoveredQueuedCountError } = await primary.client
    .from("my_skill_reports")
    .select("report_id", { count: "exact", head: true })
    .eq("category", "security")
    .eq("state", "queued");
  if (recoveredQueuedCountError || recoveredQueuedCount !== 1) {
    throw recoveredQueuedCountError ?? new Error(`Resolved-history recovery changed the queued row count (${recoveredQueuedCount}).`);
  }

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
  await waitForUrl(page, (url) => url.pathname === "/sign-in" && /^[0-9a-f-]{36}$/.test(url.searchParams.get("accountFlash") ?? ""), "account deletion redirect");
  await page.getByText("Your SkillMap account was deleted and this browser session was cleared.", { exact: true }).waitFor();
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
  assertCompleteDualControlEvidence(dualControlEvidence);
  passReceipt = {
    result: "pass",
    anonymousAcquisition: {
      query: "Skill Audit",
      resultPath: detailPath,
      viewports: anonymousAcquisition,
      freshnessBoundary: "recorded-signals-no-derived-verdict",
      signedOutReportReturnPath: `${detailPath}#report-listing`
    },
    submissionValidation: { fieldLocal: true, valuesPreserved: true, transportFailurePreserved: true, serverQuotaFailurePreserved: true, quotaFailureInsertedRows: 0, invalidRows: 0, correctedRows: 1, responsive: "390px" },
    submissionWithdrawal: { submissionId: withdrawalId, ownerState: "withdrawn", secondAccountIsolated: true },
    forgedPositiveNotices: "rejected",
    publicEvidence: {
      noRow: { audit: "bounded-no-row-state", grade: "bounded-no-row-state", auditWidth, gradeWidth },
      receiptRows: { audit: "rendered", grade: "rendered-provisional-letterless", receiptAuditWidth, receiptGradeWidth, privateDigest: "absent" }
    },
    dualControl: {
      approvals: dualControlEvidence.approvals,
      executions: dualControlEvidence.executions,
      samePersonWrongRoleDenied: dualControlEvidence.samePersonWrongRoleDenied,
      serviceRoleOnlyDenied: dualControlEvidence.serviceRoleOnlyDenied,
      credentialCanaries: "absent"
    },
    report: { strictInputCoveredByFocusedTest: true, queued: reportId, cooldown: true, requestIdPayloadConflictFailedClosed: true, queuedConstraintConflictRecovered: true, resolvedHistoryQueuedAuthorityRecovered: true, escapedText: true },
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
  const message = safeOperatorErrorMessage(error);
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
  let operatorRowsRemaining = {
    principals: 2,
    approvals: dualControlEvidence.approvals,
    executions: dualControlEvidence.executions,
    auditEvents: dualControlEvidence.executions,
    disabledTriggers: 0,
    restoredTriggers: 0
  };
  try {
    operatorRowsRemaining = cleanupOperatorFixtures(operatorAuthority);
  } catch (error) {
    cleanupErrors.push(new Error(`Synthetic operator cleanup failed: ${safeOperatorErrorMessage(error)}`));
  }
  const catalogClean = Object.values(catalogRowsRemaining).every((value) => value === 0);
  const operatorRowsClean = ["principals", "approvals", "executions", "auditEvents"]
    .every((key) => operatorRowsRemaining[key] === 0);
  const operatorTriggersRestored = operatorRowsRemaining.disabledTriggers === 0
    && operatorRowsRemaining.restoredTriggers === 4;
  cleanupReceipt = {
    verified: cleanupErrors.length === 0
      && authUsersRemaining === 0
      && catalogClean
      && operatorRowsClean
      && operatorTriggersRestored,
    authUsersRemaining,
    catalogRowsRemaining,
    operatorRowsRemaining
  };
  if (cleanupErrors.length) {
    primaryError = primaryError
      ? new AggregateError([primaryError, ...cleanupErrors], "Hosted launch smoke and cleanup failed.")
      : new AggregateError(cleanupErrors, "Hosted launch smoke cleanup failed.");
  }
}

if (primaryError) throw primaryError;
if (!passReceipt || !cleanupReceipt?.verified) throw new Error("Hosted launch smoke ended without a verified cleanup receipt.");
const finalReceipt = JSON.stringify({ ...passReceipt, cleanup: cleanupReceipt });
assertOperatorCredentialCanariesAbsent(finalReceipt, "final hosted smoke receipt");
process.stdout.write(`${finalReceipt}\n`);

function createEphemeralOperatorAuthority() {
  const createPrincipal = (role) => {
    const credential = `smo_v1_${randomBytes(32).toString("hex")}`;
    return {
      role,
      handle: `browser-smoke-${role}-${marker}-${randomBytes(6).toString("hex")}`,
      credential,
      credentialDigest: `sha256:${createHash("sha256").update(credential, "utf8").digest("hex")}`
    };
  };
  const authority = {
    approver: createPrincipal("approver"),
    executor: createPrincipal("executor")
  };
  if (authority.approver.credential === authority.executor.credential) {
    throw new Error("Ephemeral operator credentials were not distinct.");
  }
  assertCanonicalOperatorAuthority(authority);
  return authority;
}

function assertCanonicalOperatorAuthority(authority) {
  for (const role of ["approver", "executor"]) {
    const principal = authority?.[role];
    if (principal?.role !== role
      || !/^browser-smoke-(approver|executor)-[0-9]{10,16}-[0-9a-f]{12}$/.test(principal.handle ?? "")
      || !/^smo_v1_[0-9a-f]{64}$/.test(principal.credential ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(principal.credentialDigest ?? "")
      || principal.credentialDigest !== `sha256:${createHash("sha256").update(principal.credential, "utf8").digest("hex")}`) {
      throw new Error("Ephemeral operator authority is invalid.");
    }
  }
}

function seedOperatorPrincipals(authority) {
  assertCanonicalOperatorAuthority(authority);
  const sql = `
    begin;
    insert into private.operator_principals (handle, authority_role, credential_digest)
    values
      ('${authority.approver.handle}', 'approver', '${authority.approver.credentialDigest}'),
      ('${authority.executor.handle}', 'executor', '${authority.executor.credentialDigest}');
    commit;
    select json_build_object(
      'approvers', (select count(*)::integer from private.operator_principals
        where handle = '${authority.approver.handle}' and authority_role = 'approver'),
      'executors', (select count(*)::integer from private.operator_principals
        where handle = '${authority.executor.handle}' and authority_role = 'executor')
    )::text;
  `;
  const output = runLocalSuperuserSql(sql, "operator principal seed");
  assertOperatorCredentialCanariesAbsent(output, "operator principal seed output");
  const counts = parseLastJsonLine(output, "operator principal seed");
  if (Object.keys(counts).sort().join(",") !== "approvers,executors"
    || counts.approvers !== 1
    || counts.executors !== 1) {
    throw new Error("Operator principal seed did not create exactly one approver and one executor.");
  }
}

function createOperatorClient(credential, approvalId = null) {
  if (!/^smo_v1_[0-9a-f]{64}$/.test(credential ?? "")
    || (approvalId !== null && !/^opa_[0-9a-f]{32}$/.test(approvalId))) {
    throw new Error("Operator transport credentials are invalid.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        "x-skillmap-operator-credential": credential,
        ...(approvalId ? { "x-skillmap-operator-approval": approvalId } : {})
      }
    }
  });
}

async function runDualControlledBusinessRpc({
  actionKind,
  subjectType,
  subjectId,
  actionPayload,
  actionDigest,
  operationId,
  rpcName,
  rpcParameters,
  proveSamePersonWrongRole = false,
  label
}) {
  const serviceOnlyOutcome = await admin.rpc(rpcName, rpcParameters);
  assertOperatorCredentialCanariesAbsent(serviceOnlyOutcome, `${label} service-role denial`);
  assertPermissionDenied(serviceOnlyOutcome, `${label} service-role-only call`);
  dualControlEvidence.serviceRoleOnlyDenied.push(actionKind);

  const approver = createOperatorClient(operatorAuthority.approver.credential);
  const approvalOutcome = await approver.rpc("approve_operator_action", {
    p_action_kind: actionKind,
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_action_payload: actionPayload,
    p_action_digest: actionDigest,
    p_operation_id: operationId
  });
  assertOperatorCredentialCanariesAbsent(approvalOutcome, `${label} approval response`);
  if (approvalOutcome.error) throw operatorRpcError(`${label} approval`, approvalOutcome.error);
  const approval = approvalOutcome.data?.[0];
  if (!Array.isArray(approvalOutcome.data)
    || approvalOutcome.data.length !== 1
    || Object.keys(approval ?? {}).sort().join(",") !== "action_digest,approval_id,approver_id,expires_at"
    || !/^opa_[0-9a-f]{32}$/.test(approval?.approval_id ?? "")
    || approval?.action_digest !== actionDigest
    || !/^opr_[0-9a-f]{32}$/.test(approval?.approver_id ?? "")
    || typeof approval?.expires_at !== "string"
    || !Number.isFinite(Date.parse(approval.expires_at))) {
    throw new Error(`${label} approval returned an invalid bounded projection.`);
  }
  dualControlEvidence.approvals += 1;

  if (proveSamePersonWrongRole) {
    const wrongRole = createOperatorClient(operatorAuthority.approver.credential, approval.approval_id);
    const wrongRoleOutcome = await wrongRole.rpc(rpcName, rpcParameters);
    assertOperatorCredentialCanariesAbsent(wrongRoleOutcome, `${label} same-person wrong-role denial`);
    assertPermissionDenied(wrongRoleOutcome, `${label} approver-as-executor call`);
    dualControlEvidence.samePersonWrongRoleDenied = true;
  }

  const executor = createOperatorClient(operatorAuthority.executor.credential, approval.approval_id);
  const executionOutcome = await executor.rpc(rpcName, rpcParameters);
  assertOperatorCredentialCanariesAbsent(executionOutcome, `${label} execution response`);
  if (executionOutcome.error) throw operatorRpcError(`${label} execution`, executionOutcome.error);
  if (!Array.isArray(executionOutcome.data) || executionOutcome.data.length !== 1) {
    throw new Error(`${label} execution returned an invalid bounded projection.`);
  }
  dualControlEvidence.executions += 1;
  return executionOutcome.data;
}

function assertPermissionDenied(outcome, label) {
  if (outcome?.data !== null || outcome?.error?.code !== "42501") {
    const code = typeof outcome?.error?.code === "string" ? outcome.error.code : "missing";
    throw new Error(`${label} did not fail closed with SQLSTATE 42501 (received ${code}).`);
  }
}

function operatorRpcError(label, error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  return new Error(`${label} failed${code}: ${safeOperatorErrorMessage(error)}`);
}

function assertCompleteDualControlEvidence(evidence) {
  const expectedKinds = [
    "report.disposition",
    "submission.publish",
    "submission.publisher-authorization"
  ];
  const actualKinds = [...evidence.serviceRoleOnlyDenied].sort();
  if (evidence.approvals !== 3
    || evidence.executions !== 3
    || evidence.samePersonWrongRoleDenied !== true
    || JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds)) {
    throw new Error("Hosted smoke did not prove the complete dual-control boundary.");
  }
}

function canonicalActionDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJsonValue(value, new Set())), "utf8").digest("hex")}`;
}

function canonicalJsonValue(value, seen) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON does not support non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Canonical JSON does not support cyclic values.");
    seen.add(value);
    const result = value.map((item) => canonicalJsonValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error(`Canonical JSON does not support ${typeof value} values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Canonical JSON supports plain objects only.");
  }
  if (seen.has(value)) throw new Error("Canonical JSON does not support cyclic values.");
  seen.add(value);
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) result[key] = canonicalJsonValue(value[key], seen);
  seen.delete(value);
  return result;
}

function cleanupOperatorFixtures(authority) {
  assertCanonicalOperatorAuthority(authority);
  const sql = `
    begin;
    create temporary table skillmap_smoke_operator_principals on commit drop as
      select id from private.operator_principals
      where handle in ('${authority.approver.handle}', '${authority.executor.handle}');
    create temporary table skillmap_smoke_operator_approvals on commit drop as
      select id from private.operator_action_approvals
      where approver_operator_id in (select id from skillmap_smoke_operator_principals);

    alter table private.audit_events disable trigger audit_events_append_only;
    alter table private.operator_action_executions disable trigger operator_action_executions_append_only;
    alter table private.operator_action_approvals disable trigger operator_action_approvals_append_only;
    alter table private.operator_principals disable trigger operator_principals_no_delete;

    delete from private.audit_events
      where operator_approval_id in (select id from skillmap_smoke_operator_approvals)
        or approver_operator_id in (select id from skillmap_smoke_operator_principals)
        or executor_operator_id in (select id from skillmap_smoke_operator_principals);
    delete from private.operator_action_executions
      where approval_id in (select id from skillmap_smoke_operator_approvals)
        or executor_operator_id in (select id from skillmap_smoke_operator_principals);
    delete from private.operator_action_approvals
      where id in (select id from skillmap_smoke_operator_approvals);
    delete from private.operator_principals
      where id in (select id from skillmap_smoke_operator_principals);

    alter table private.operator_principals enable trigger operator_principals_no_delete;
    alter table private.operator_action_approvals enable trigger operator_action_approvals_append_only;
    alter table private.operator_action_executions enable trigger operator_action_executions_append_only;
    alter table private.audit_events enable trigger audit_events_append_only;

    with expected_triggers(relation_name, trigger_name) as (values
      ('private.audit_events'::regclass, 'audit_events_append_only'),
      ('private.operator_action_executions'::regclass, 'operator_action_executions_append_only'),
      ('private.operator_action_approvals'::regclass, 'operator_action_approvals_append_only'),
      ('private.operator_principals'::regclass, 'operator_principals_no_delete')
    )
    select json_build_object(
      'principals', (select count(*)::integer from private.operator_principals
        where handle in ('${authority.approver.handle}', '${authority.executor.handle}')),
      'approvals', (select count(*)::integer from private.operator_action_approvals
        where id in (select id from skillmap_smoke_operator_approvals)),
      'executions', (select count(*)::integer from private.operator_action_executions
        where approval_id in (select id from skillmap_smoke_operator_approvals)
          or executor_operator_id in (select id from skillmap_smoke_operator_principals)),
      'auditEvents', (select count(*)::integer from private.audit_events
        where operator_approval_id in (select id from skillmap_smoke_operator_approvals)
          or approver_operator_id in (select id from skillmap_smoke_operator_principals)
          or executor_operator_id in (select id from skillmap_smoke_operator_principals)),
      'disabledTriggers', (select count(*)::integer from expected_triggers expected
        left join pg_trigger trigger on trigger.tgrelid = expected.relation_name
          and trigger.tgname = expected.trigger_name
        where trigger.oid is null or trigger.tgenabled <> 'O'),
      'restoredTriggers', (select count(*)::integer from expected_triggers expected
        join pg_trigger trigger on trigger.tgrelid = expected.relation_name
          and trigger.tgname = expected.trigger_name
        where trigger.tgenabled = 'O')
    )::text;
    commit;
  `;
  const output = runLocalSuperuserSql(sql, "operator fixture cleanup");
  assertOperatorCredentialCanariesAbsent(output, "operator cleanup output");
  const counts = parseLastJsonLine(output, "operator fixture cleanup");
  const expectedKeys = "approvals,auditEvents,disabledTriggers,executions,principals,restoredTriggers";
  if (Object.keys(counts).sort().join(",") !== expectedKeys
    || ["principals", "approvals", "executions", "auditEvents", "disabledTriggers"]
      .some((key) => counts[key] !== 0)
    || counts.restoredTriggers !== 4) {
    throw new Error(`Synthetic operator cleanup verification failed (${JSON.stringify(counts)}).`);
  }
  return counts;
}

function runLocalSuperuserSql(sql, label) {
  try {
    return execLocalPsql(
      [databaseUrl, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 * 1024 }
    ).trim();
  } catch {
    throw new Error(`Local superuser ${label} failed without reflecting its input.`);
  }
}

function parseLastJsonLine(output, label) {
  try {
    return JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1) ?? "{}");
  } catch {
    throw new Error(`Local superuser ${label} returned an invalid bounded receipt.`);
  }
}

function assertOperatorCredentialCanariesAbsent(value, label) {
  if (containsOperatorCredentialCanary(value)) {
    throw new Error(`An operator credential canary reached ${label}.`);
  }
}

function containsOperatorCredentialCanary(value, seen = new Set(), depth = 0) {
  const credentials = [operatorAuthority.approver.credential, operatorAuthority.executor.credential];
  if (typeof value === "string") return credentials.some((credential) => value.includes(credential));
  if (value === null || value === undefined || typeof value !== "object" || depth > 8 || seen.has(value)) return false;
  seen.add(value);
  const nested = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      nested.push(value[key]);
    } catch {
      // Ignore inaccessible diagnostic properties; no such value can be reflected by this harness.
    }
  }
  return nested.some((item) => containsOperatorCredentialCanary(item, seen, depth + 1));
}

function safeOperatorErrorMessage(error) {
  if (containsOperatorCredentialCanary(error)) {
    return "operator credential canary reached an error boundary and was suppressed";
  }
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
}

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
  return { userId: created.user.id, cookies: [...cookieJar.values()], client: auth };
}

function auditReceiptPayload(workerVersion) {
  return {
    state: "passed",
    receiptDigest: digest("a"),
    sourceContentDigest: digest("b"),
    normalizedContentDigest: digest("c"),
    policyVersion: "skillmap-static-audit/v2",
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
    evaluatorVersion: "skillmap-grader/0.1.0",
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
  const output = execLocalPsql(
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

async function runAnonymousAcquisitionJourney(page, viewport) {
  const viewportLabel = `${viewport.width}px`;
  const expectedReportReturnPath = `${detailPath}#report-listing`;

  smokeStage = `anonymous-getting-started-${viewport.width}`;
  await page.setViewportSize(viewport);
  await page.goto(new URL("/getting-started", baseUrl).toString(), { waitUntil: "load" });
  await page.getByRole("heading", { name: "Hosted visitor workflow" }).waitFor();
  await page.getByRole("heading", { name: "Hosted submitter workflow" }).waitFor();
  await page.getByText("Search the library", { exact: true }).waitFor();
  await page.getByText("Follow the owner receipt", { exact: true }).waitFor();
  const gettingStartedWidth = await dimensions(page);
  assertNoOverflow(gettingStartedWidth, `getting-started workflow at ${viewportLabel}`);

  smokeStage = `anonymous-search-${viewport.width}`;
  await page.goto(new URL("/skills", baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel("Search skills").fill("Skill Audit");
  await page.getByRole("button", { name: "Search library" }).click();
  await waitForUrl(page, (url) => url.pathname === "/skills" && url.searchParams.get("q") === "Skill Audit", `anonymous search at ${viewportLabel}`);
  await page.getByRole("heading", { level: 2, name: "Skill Audit" }).waitFor();
  const resultCards = page.getByRole("article");
  const resultCount = await resultCards.count();
  if (resultCount !== 1) throw new Error(`Anonymous search at ${viewportLabel} returned ${resultCount} cards instead of one exact result.`);
  const resultCard = resultCards.first();
  if ((await page.locator("body").innerText()).includes("Skill Quality Review")) {
    throw new Error(`Anonymous search at ${viewportLabel} retained a nonmatching catalog result.`);
  }
  const catalogWidth = await dimensions(page);
  assertNoOverflow(catalogWidth, `filtered catalog at ${viewportLabel}`);
  await resultCard.getByRole("link", { name: "Inspect" }).click();
  await waitForUrl(page, (url) => url.pathname === detailPath, `anonymous result navigation at ${viewportLabel}`);

  smokeStage = `anonymous-detail-${viewport.width}`;
  await page.getByRole("heading", { level: 1, name: "Skill Audit" }).waitFor();
  await page.getByRole("heading", { name: "Freshness signals" }).waitFor();
  await page.getByText(/does not calculate an automatic fresh or current verdict from elapsed time/).waitFor();
  for (const label of ["Catalog publication", "Listing record", "Provenance evidence", "Audit evidence", "Compatibility evidence", "Grade evidence"]) {
    await page.getByText(label, { exact: true }).waitFor();
  }
  await page.getByText("Immutable commit", { exact: true }).waitFor();
  await page.getByText("Relative skill path", { exact: true }).waitFor();
  const visibleActions = page.locator("[data-skill-actions]:visible");
  if (await visibleActions.count() !== 1) throw new Error(`Skill detail at ${viewportLabel} did not expose one visible version-action panel.`);
  await visibleActions.getByText("Version 1.0.0", { exact: true }).waitFor();
  await visibleActions.getByText(/License: MIT/).waitFor();
  await assertMobileSkillActionOrder(page, "Sign in to save", `anonymous skill detail at ${viewportLabel}`);
  const detailWidth = await dimensions(page);
  assertNoOverflow(detailWidth, `anonymous skill detail at ${viewportLabel}`);

  smokeStage = `anonymous-audit-${viewport.width}`;
  await page.getByRole("link", { name: "View audit evidence" }).click();
  await waitForUrl(page, (url) => url.pathname === `${detailPath}/audit`, `anonymous audit navigation at ${viewportLabel}`);
  await page.getByRole("heading", { name: "Skill Audit audit evidence" }).waitFor();
  await page.getByRole("heading", { name: "Bounded public evidence projection" }).waitFor();
  await page.getByRole("heading", { name: "No current public audit evidence" }).waitFor();
  const auditWidth = await dimensions(page);
  assertNoOverflow(auditWidth, `audit evidence at ${viewportLabel}`);

  await page.getByRole("link", { name: "Back to skill detail" }).click();
  await waitForUrl(page, (url) => url.pathname === detailPath, `audit return at ${viewportLabel}`);
  smokeStage = `anonymous-grade-${viewport.width}`;
  await page.getByRole("link", { name: "View grade evidence" }).click();
  await waitForUrl(page, (url) => url.pathname === `${detailPath}/grade`, `anonymous grade navigation at ${viewportLabel}`);
  await page.getByRole("heading", { name: "Skill Audit grade evidence" }).waitFor();
  await page.getByRole("heading", { name: "Bounded public evidence projection" }).waitFor();
  await page.getByRole("heading", { name: "No current public grade evidence" }).waitFor();
  const gradeWidth = await dimensions(page);
  assertNoOverflow(gradeWidth, `grade evidence at ${viewportLabel}`);

  await page.getByRole("link", { name: "Back to skill detail" }).click();
  await waitForUrl(page, (url) => url.pathname === detailPath, `grade return at ${viewportLabel}`);
  smokeStage = `anonymous-report-sign-in-${viewport.width}`;
  await page.getByRole("heading", { name: "Report a suspicious listing" }).waitFor();
  await page.getByText("Sign in to send a report", { exact: true }).waitFor();
  const reportSignIn = page.getByRole("link", { name: "Sign in to report" });
  const reportSignInHref = await reportSignIn.getAttribute("href");
  const expectedSignInHref = `/sign-in?next=${encodeURIComponent(expectedReportReturnPath)}`;
  if (reportSignInHref !== expectedSignInHref) {
    throw new Error(`Signed-out report at ${viewportLabel} lost its exact return path (${reportSignInHref}).`);
  }
  await reportSignIn.click();
  await waitForUrl(page, (url) => url.pathname === "/sign-in" && url.searchParams.get("next") === expectedReportReturnPath, `report sign-in return path at ${viewportLabel}`);
  await page.getByRole("heading", { level: 1, name: "Save skills and track exact-source submissions." }).waitFor();
  const signInWidth = await dimensions(page);
  assertNoOverflow(signInWidth, `report sign-in at ${viewportLabel}`);

  return {
    resultCount,
    gettingStartedWidth,
    catalogWidth,
    detailWidth,
    auditWidth,
    gradeWidth,
    signInWidth
  };
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

async function assertMobileSkillActionOrder(page, expectedAction, label) {
  const result = await page.evaluate((expected) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const panel = [...document.querySelectorAll("[data-skill-actions]")].find(visible);
    const report = document.getElementById("report-listing");
    const action = panel
      ? [...panel.querySelectorAll("a[href],button")].find((element) => visible(element)
        && (element.textContent ?? "").trim() === expected)
      : null;
    if (!(panel instanceof HTMLElement) || !(report instanceof HTMLElement)
      || !(action instanceof HTMLElement)) return null;
    return {
      actionTop: action.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
      panelBeforeReport: Boolean(panel.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING),
      actionBeforeReport: Boolean(action.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  }, expectedAction);
  if (!result) throw new Error(`${label} did not expose the expected ${expectedAction} action.`);
  if (result.actionTop < 0 || result.actionTop >= result.viewportHeight) {
    throw new Error(`${label} buried ${expectedAction} below the initial viewport (${result.actionTop} >= ${result.viewportHeight}).`);
  }
  if (!result.panelBeforeReport || !result.actionBeforeReport) {
    throw new Error(`${label} reached the report section before ${expectedAction} in DOM or keyboard order.`);
  }
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
