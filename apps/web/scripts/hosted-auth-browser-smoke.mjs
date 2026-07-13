import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.SKILLMAP_TEST_DB_URL;
const paginationFixture = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_saved_pagination.sql.inc", import.meta.url));
const paginationCleanup = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_saved_pagination_cleanup.sql.inc", import.meta.url));
const browserName = process.env.SKILLMAP_HOSTED_BROWSER ?? "chromium";
const browserTypes = { chromium, firefox, webkit };
const browserClientAddresses = {
  chromium: { forged: "203.0.113.71", authenticated: "203.0.113.72" },
  firefox: { forged: "203.0.113.73", authenticated: "203.0.113.74" },
  webkit: { forged: "203.0.113.75", authenticated: "203.0.113.76" }
};

if (!supabaseUrl || !publishableKey || !serviceRoleKey || !databaseUrl) {
  throw new Error("Local Supabase URL, publishable key, service-role key, and test database URL are required for the authenticated smoke test.");
}
if (!Object.hasOwn(browserTypes, browserName)) {
  throw new Error("SKILLMAP_HOSTED_BROWSER must be chromium, firefox, or webkit.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const email = `hosted-auth-smoke-${Date.now()}@skillmap.invalid`;
const password = `Local-smoke-${crypto.randomUUID()}!`;
runSqlFile(paginationCleanup);
runSqlFile(paginationFixture);
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
if (createError || !created.user) {
  runSqlFile(paginationCleanup);
  throw createError ?? new Error("Synthetic local user was not created.");
}

let browser;
let primaryError;
try {
  const cookieJar = new Map();
  const auth = createServerClient(supabaseUrl, publishableKey, {
    db: { schema: "api" },
    cookies: {
      getAll: () => [...cookieJar.values()],
      setAll: (entries) => {
        for (const entry of entries) cookieJar.set(entry.name, entry);
      }
    }
  });
  const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.user) throw signInError ?? new Error("Synthetic local user was not authenticated.");

  const { error: profileError } = await auth.from("profiles").insert({ user_id: signedIn.user.id });
  if (profileError) throw profileError;

  const concurrentSkillId = "skl_00000000000000000000000000000001";
  const concurrentSaves = await Promise.all([
    auth.from("saved_skills").upsert(
      { user_id: signedIn.user.id, skill_id: concurrentSkillId },
      { onConflict: "user_id,skill_id", ignoreDuplicates: true }
    ),
    auth.from("saved_skills").upsert(
      { user_id: signedIn.user.id, skill_id: concurrentSkillId },
      { onConflict: "user_id,skill_id", ignoreDuplicates: true }
    )
  ]);
  if (concurrentSaves.some(({ error }) => error)) {
    throw concurrentSaves.find(({ error }) => error)?.error;
  }
  const { data: concurrentRows, error: concurrentReadError } = await auth
    .from("saved_skills")
    .select("skill_id")
    .eq("user_id", signedIn.user.id)
    .eq("skill_id", concurrentSkillId);
  if (concurrentReadError || concurrentRows?.length !== 1) {
    throw concurrentReadError ?? new Error("Concurrent saves did not converge to one row.");
  }
  const { error: concurrentCleanupError } = await auth
    .from("saved_skills")
    .delete()
    .eq("user_id", signedIn.user.id)
    .eq("skill_id", concurrentSkillId);
  if (concurrentCleanupError) throw concurrentCleanupError;

  browser = await browserTypes[browserName].launch({ headless: true });

  const forgedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    extraHTTPHeaders: { "x-vercel-forwarded-for": browserClientAddresses[browserName].forged }
  });
  await forgedContext.addCookies([...cookieJar.values()].map(({ name }) => ({
    name,
    value: "forged-session",
    url: baseUrl,
    httpOnly: true,
    secure: false,
    sameSite: "Lax"
  })));
  const forgedPage = await forgedContext.newPage();
  await gotoSettled(forgedPage, new URL("/account", baseUrl).toString());
  await Promise.race([
    forgedPage.waitForURL((url) => url.pathname === "/sign-in"),
    forgedPage.getByRole("heading", { name: "Hosted catalog unavailable" }).waitFor(),
    forgedPage.getByRole("heading", { name: "Your saved skills" }).waitFor()
  ]);
  const forgedRejected = new URL(forgedPage.url()).pathname === "/sign-in"
    || await forgedPage.getByRole("heading", { name: "Hosted catalog unavailable" }).isVisible().catch(() => false);
  if (!forgedRejected || await forgedPage.getByRole("heading", { name: "Your saved skills" }).isVisible().catch(() => false)) {
    throw new Error("A forged auth cookie reached the protected account surface.");
  }
  await forgedContext.close();

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    extraHTTPHeaders: { "x-vercel-forwarded-for": browserClientAddresses[browserName].authenticated }
  });
  await context.addCookies([...cookieJar.values()].map(({ name, value, options = {} }) => ({
    name,
    value,
    url: baseUrl,
    httpOnly: options.httpOnly ?? false,
    secure: false,
    sameSite: options.sameSite === "strict" ? "Strict" : options.sameSite === "none" ? "None" : "Lax"
  })));

  const page = await context.newPage();
  const diagnostics = [];
  const expectedDiagnostics = [];
  let smokeStage = "landing-demo";
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const diagnostic = `${smokeStage} ${message.type()}: ${message.text()}`;
      if (isExpectedStrictDynamicFallbackWarning(diagnostic)) expectedDiagnostics.push(diagnostic);
      else diagnostics.push(diagnostic);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`${smokeStage} pageerror: ${error.message}`));

  await gotoSettled(page, new URL("/", baseUrl).toString());
  await page.getByRole("button", { name: "Search skill library" }).waitFor();
  await page.getByRole("button", { name: "Run recorded demo" }).click();
  await page.getByText(/Recorded fixture selected:/).waitFor();

  smokeStage = "mobile-catalog";
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSettled(page, new URL("/skills", baseUrl).toString());
  await page.getByRole("link", { name: "Skill library" }).waitFor();
  const mobileWidth = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  if (mobileWidth.scroll > mobileWidth.inner) {
    throw new Error(`Hosted catalog overflows at 390px (${mobileWidth.scroll}px > ${mobileWidth.inner}px).`);
  }

  smokeStage = "account-empty";
  await page.setViewportSize({ width: 1280, height: 900 });
  const accountResponse = await gotoSettled(page, new URL("/account", baseUrl).toString());
  assertPrivateNoStore(accountResponse?.headers() ?? {}, "authenticated account response");
  try {
    await page.getByRole("heading", { name: "Your saved skills" }).waitFor();
  } catch {
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Authenticated account route failed at ${page.url()}: ${body}`);
  }
  await page.getByRole("heading", { name: "No saved skills yet" }).waitFor();

  smokeStage = "save-detail";
  await gotoSettled(page, new URL("/skills/0x3-team/skill-audit", baseUrl).toString());
  await page.getByRole("button", { name: "Save skill" }).waitFor();
  await page.locator('form[action="/account/saved/action"]').evaluate((form) => form.requestSubmit());
  await waitForPageUrl(page, (url) => url.pathname === "/skills/0x3-team/skill-audit" && url.searchParams.get("saveStatus") === "saved");
  await page.getByRole("button", { name: "Remove from saved" }).waitFor();

  smokeStage = "unsave-account";
  await gotoSettled(page, new URL("/account", baseUrl).toString());
  await page.getByRole("link", { name: "Skill Audit" }).waitFor();
  await page.locator('form[action="/account/saved/action"]').evaluate((form) => form.requestSubmit());
  await waitForPageUrl(page, (url) => url.pathname === "/account" && url.searchParams.get("saveStatus") === "removed");
  await page.getByRole("heading", { name: "No saved skills yet" }).waitFor();

  smokeStage = "pagination-fixture";
  const paginationSkillIds = Array.from({ length: 52 }, (_, index) =>
    `skl_${(65537 + index).toString(16).padStart(32, "0")}`
  );
  const { error: paginationSaveError } = await auth.from("saved_skills").insert(
    paginationSkillIds.map((skillId) => ({
      user_id: signedIn.user.id,
      skill_id: skillId,
      created_at: "2026-07-11T20:00:00.000Z"
    }))
  );
  if (paginationSaveError) throw paginationSaveError;

  smokeStage = "pagination-first";
  await gotoSettled(page, new URL("/account", baseUrl).toString());
  await page.getByRole("link", { name: "Pagination Test 001" }).waitFor();
  const firstPageNames = await page.locator('a[href*="/pagination-test-"]').allTextContents();
  if (firstPageNames.length !== 50 || firstPageNames[0] !== "Pagination Test 001" || firstPageNames.at(-1) !== "Pagination Test 050") {
    throw new Error(`Saved pagination first page was not the expected stable 50-row prefix (${firstPageNames.length}).`);
  }
  const nextSavedHref = await page.getByRole("link", { name: "Next saved skills" }).getAttribute("href");
  if (!nextSavedHref) throw new Error("Saved pagination did not expose a next-page cursor.");
  smokeStage = "pagination-second";
  await gotoSettled(page, new URL(nextSavedHref, baseUrl).toString());
  await page.getByRole("link", { name: "Pagination Test 051" }).waitFor();
  const secondPageNames = await page.locator('a[href*="/pagination-test-"]').allTextContents();
  if (secondPageNames.join(",") !== "Pagination Test 051,Pagination Test 052") {
    throw new Error(`Saved pagination terminal page had gaps, duplicates, or unstable ordering (${secondPageNames.join(",")}).`);
  }

  smokeStage = "pagination-revocation";
  execFileSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-c",
    "update private.skills set revoked_at = '2026-07-11T20:01:00Z' where public_id = 'skl_00000000000000000000000000010034'"
  ], { stdio: "pipe" });
  const revokedApiResponse = await page.request.get(new URL("/api/v1/skills/skl_00000000000000000000000000010034", baseUrl).toString());
  if (revokedApiResponse.status() !== 404) {
    throw new Error(`Revoked pagination fixture remained public through the API (HTTP ${revokedApiResponse.status()}).`);
  }
  const postRevocationUrl = new URL(nextSavedHref, baseUrl);
  postRevocationUrl.searchParams.set("smokeState", "post-revocation");
  await gotoSettled(page, postRevocationUrl.toString());
  await page.getByRole("link", { name: "Pagination Test 051" }).waitFor();
  const postRevocationNames = await page.locator('a[href*="/pagination-test-"]').allTextContents();
  if (postRevocationNames.join(",") !== "Pagination Test 051") {
    throw new Error(`A revoked saved skill leaked or pagination became unstable (${postRevocationNames.join(",")}).`);
  }

  smokeStage = "logout";
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(new URL("/", baseUrl).toString());
  const remainingAuthCookies = (await context.cookies()).filter((cookie) => /auth-token/i.test(cookie.name));
  if (remainingAuthCookies.length > 0) throw new Error("Sign-out left Supabase auth cookies in the browser context.");
  smokeStage = "signed-out-account";
  const signedOutResponse = await gotoSettled(page, new URL("/account", baseUrl).toString());
  if (new URL(page.url()).pathname !== "/sign-in") throw new Error("Signed-out account access did not return to sign-in.");
  assertPrivateNoStore(signedOutResponse?.headers() ?? {}, "signed-out account redirect");

  if (diagnostics.length > 0) throw new Error(`Authenticated browser diagnostics:\n${diagnostics.join("\n")}`);
  await context.close();
  process.stdout.write(`${JSON.stringify({
    result: "pass",
    browser: browserName,
    account: "authenticated",
    concurrentSave: "idempotent-single-row",
    save: "passed",
    savedProjection: "passed",
    unsave: "passed",
    savedPagination: "52-rows-no-gaps-or-duplicates",
    savedRevocation: "filtered-between-pages",
    forgedSession: "rejected",
    logout: "passed",
    signedOutRedirect: "passed",
    authCacheHeaders: "private-no-store",
    mobileNavigationName: "passed",
    mobileOverflow: "passed",
    landingCspAndHydration: "passed",
    diagnostics: 0,
    expectedCspCompatibilityWarnings: expectedDiagnostics.length
  })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    await browser?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const { error } = await admin.auth.admin.deleteUser(created.user.id);
    if (error) cleanupErrors.push(error);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    runSqlFile(paginationCleanup);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    if (!primaryError) {
      throw new AggregateError(cleanupErrors, "Authenticated smoke cleanup failed.");
    }
    process.stderr.write(`Authenticated smoke cleanup also failed: ${cleanupErrors.map(errorMessage).join("; ")}\n`);
  }
}

function assertPrivateNoStore(headers, label) {
  const cacheControl = headers["cache-control"] ?? "";
  if (!/\bprivate\b/i.test(cacheControl) || !/\bno-store\b/i.test(cacheControl) || /\bpublic\b|s-maxage/i.test(cacheControl)) {
    throw new Error(`${label} is not private, no-store (${cacheControl || "missing"}).`);
  }
}

function runSqlFile(path) {
  execFileSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", path], { stdio: "pipe" });
}

async function gotoSettled(page, url) {
  return page.goto(url, { waitUntil: "load" });
}

async function waitForPageUrl(page, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (predicate(new URL(page.url()))) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for the saved-skill redirect (${page.url()}).`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedStrictDynamicFallbackWarning(value) {
  return /Content-Security-Policy: Ignoring .?'self'.? within script-src: .?strict-dynamic.? specified/.test(value);
}
