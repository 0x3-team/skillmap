import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3108";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !publishableKey || !serviceRoleKey) throw new Error("Local Supabase environment is required.");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  db: { schema: "api" },
  auth: { autoRefreshToken: false, persistSession: false }
});
const marker = Date.now();
const detailPath = "/skills/0x3-team/skill-audit";
const reportMessage = "Potential issue: <img src=x onerror=alert(1)> appears in listing metadata.";
const userIds = [];
let browser;

try {
  browser = await chromium.launch({ headless: true });
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

  const primary = await createSyntheticUser("primary");
  const secondary = await createSyntheticUser("secondary");
  userIds.push(primary.userId, secondary.userId);
  const primaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const secondaryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await primaryContext.addCookies(toBrowserCookies(primary.cookies));
  await secondaryContext.addCookies(toBrowserCookies(secondary.cookies));

  const page = await primaryContext.newPage();
  page.setDefaultTimeout(20_000);
  const diagnostics = collectDiagnostics(page);
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
  await page.waitForTimeout(500);
  await submitForm(page.getByRole("button", { name: "Queue private report" }));
  await waitForUrl(page, (url) => url.searchParams.get("reportStatus") === "cooldown", "report cooldown redirect");
  await page.getByText("Report cooldown is active").waitFor();

  const accountResponse = await page.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  assertPrivateNoStore(accountResponse?.headers() ?? {}, "report history");
  await page.getByRole("heading", { name: "Your listing reports" }).waitFor();
  await page.getByText(reportMessage, { exact: true }).waitFor();
  await page.getByText("Queued", { exact: true }).waitFor();
  if (await page.locator('img[src="x"]').count()) throw new Error("Report message was rendered as trusted HTML.");
  const historyWidth = await dimensions(page);
  assertNoOverflow(historyWidth, "queued report history");

  const secondaryPage = await secondaryContext.newPage();
  await secondaryPage.goto(new URL("/account/reports", baseUrl).toString(), { waitUntil: "load" });
  await secondaryPage.getByRole("heading", { name: "No listing reports" }).waitFor();
  if ((await secondaryPage.locator("body").innerText()).includes(reportId)) throw new Error("Report leaked into another account projection.");

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

  const exportResponse = await primaryContext.request.get(new URL("/account/export", baseUrl).toString());
  if (exportResponse.status() !== 200) throw new Error(`Account export returned HTTP ${exportResponse.status()}.`);
  assertPrivateNoStore(exportResponse.headers(), "account export");
  const exported = await exportResponse.json();
  const exportedReport = exported.reports?.find((entry) => entry.report_id === reportId);
  if (!exportedReport || exportedReport.state !== "resolved") throw new Error("Account export omitted the resolved owner report.");

  await page.goto(new URL("/account#account-data", baseUrl).toString(), { waitUntil: "load" });
  await page.getByLabel(/Type “delete my skillmap account”/).fill("delete my skillmap account");
  await submitForm(page.getByRole("button", { name: "Delete account permanently" }));
  await waitForUrl(page, (url) => url.pathname === "/sign-in" && url.searchParams.get("status") === "account-deleted", "account deletion redirect");
  const remainingAuthCookies = (await primaryContext.cookies()).filter((cookie) => /auth-token/i.test(cookie.name));
  if (remainingAuthCookies.length) throw new Error("Deleted account left auth cookies behind.");
  const { data: deletedUser } = await admin.auth.admin.getUserById(primary.userId);
  if (deletedUser.user) throw new Error("Account deletion left the primary auth row behind.");
  userIds.splice(userIds.indexOf(primary.userId), 1);

  if (diagnostics.length) throw new Error(`Authenticated browser diagnostics:\n${diagnostics.join("\n")}`);
  process.stdout.write(`${JSON.stringify({
    result: "pass",
    publicEvidence: { audit: "bounded-no-row-state", grade: "bounded-no-row-state", auditWidth, gradeWidth },
    report: { strictInputCoveredByFocusedTest: true, queued: reportId, cooldown: true, escapedText: true },
    ownerIsolation: "passed",
    dispositionHistory: "resolved",
    export: "owner-report-included-private-no-store",
    accountDeletion: "user-session-and-report-owner-rows-cascaded",
    responsive: { historyWidth },
    diagnostics: 0
  })}\n`);
} finally {
  await browser?.close().catch(() => {});
  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) process.stderr.write(`Cleanup warning: ${error.message}\n`);
  }
}

async function createSyntheticUser(role) {
  const email = `report-prod-${role}-${marker}@skillmap.invalid`;
  const password = `Local-smoke-${crypto.randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error(`Could not create ${role} user.`);
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
