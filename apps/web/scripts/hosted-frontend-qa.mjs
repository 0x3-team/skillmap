import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { execLocalPsql } from "./local-supabase-psql.mjs";

const appDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.SKILLMAP_TEST_DB_URL;
const updateBaselines = process.argv.includes("--update-visual-baselines");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--update-visual-baselines");
const artifactDir = path.resolve(
  process.env.SKILLMAP_HOSTED_ARTIFACTS
    ?? path.join(tmpdir(), "skillmap-hosted-frontend-qa", String(process.pid))
);
const baselineDir = path.join(appDir, "tests", "visual-baselines", "hosted-web", "chromium-linux");
const screenshotDir = path.join(artifactDir, "screenshots");
const diffDir = path.join(artifactDir, "diffs");
const manifestPath = path.join(baselineDir, "manifest.json");

if (unknownArguments.length > 0) throw new Error(`Unknown hosted frontend QA option: ${unknownArguments[0]}`);
if (!supabaseUrl || !publishableKey || !serviceRoleKey || !databaseUrl) {
  throw new Error("Hosted frontend QA requires the local Supabase URL, publishable key, service-role key, and database URL.");
}
if (updateBaselines && process.platform !== "linux") {
  throw new Error("Hosted visual baselines may only be updated in the pinned Linux Chromium environment.");
}

await rm(screenshotDir, { recursive: true, force: true });
await rm(diffDir, { recursive: true, force: true });
await mkdir(screenshotDir, { recursive: true });
await mkdir(diffDir, { recursive: true });
if (updateBaselines) await mkdir(baselineDir, { recursive: true });

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const email = `hosted-frontend-qa-${Date.now()}@skillmap.invalid`;
const password = `Local-frontend-qa-${crypto.randomUUID()}!`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
if (createError || !created.user) throw createError ?? new Error("Hosted frontend QA user was not created.");

let browser;
let context;
let failure = null;
let browserVersion = "unavailable";
const visuals = [];
const diagnostics = [];
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
  if (signInError || !signedIn.user) throw signInError ?? new Error("Hosted frontend QA user was not authenticated.");
  const { error: profileError } = await auth.from("profiles").insert({
    user_id: signedIn.user.id
  });
  if (profileError) throw profileError;
  execLocalPsql([databaseUrl, "-v", "ON_ERROR_STOP=1", "-AtX", "-c",
    `update api.profiles set created_at = '2026-07-13T00:00:00.000Z' where user_id = '${signedIn.user.id}'::uuid`
  ], { stdio: ["ignore", "ignore", "pipe"] });

  browser = await chromium.launch({ headless: true });
  browserVersion = browser.version();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    deviceScaleFactor: 1
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
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));

  const visualEnvironment = {
    schemaVersion: 1,
    browser: "chromium",
    browserVersion,
    playwrightVersion: JSON.parse(await readFile(path.join(appDir, "node_modules", "playwright", "package.json"), "utf8")).version,
    platform: process.platform,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1
  };
  if (updateBaselines) await writeFile(manifestPath, `${JSON.stringify(visualEnvironment, null, 2)}\n`, "utf8");
  else assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), visualEnvironment, "Hosted visual environment drifted from its reviewed manifest.");

  const cases = [
    { name: "home-desktop-authenticated", path: "/", viewport: { width: 1440, height: 1000 }, heading: /Find agent skills/ },
    { name: "catalog-compact-320", path: "/skills", viewport: { width: 320, height: 760 }, heading: "Inspect the evidence before the instruction body." },
    { name: "catalog-mobile-390", path: "/skills", viewport: { width: 390, height: 844 }, heading: "Inspect the evidence before the instruction body." },
    { name: "getting-started-compact-320", path: "/getting-started", viewport: { width: 320, height: 760 }, heading: "Start from the capability that exists today." },
    { name: "getting-started-mobile-390", path: "/getting-started", viewport: { width: 390, height: 844 }, heading: "Start from the capability that exists today." },
    { name: "detail-desktop", path: "/skills/0x3-team/skill-audit", viewport: { width: 1440, height: 1000 }, heading: "Skill Audit" },
    { name: "detail-compact-320", path: "/skills/0x3-team/skill-audit", viewport: { width: 320, height: 760 }, heading: "Skill Audit" },
    { name: "detail-mobile-390", path: "/skills/0x3-team/skill-audit", viewport: { width: 390, height: 844 }, heading: "Skill Audit" },
    { name: "audit-mobile", path: "/skills/0x3-team/skill-audit/audit", viewport: { width: 390, height: 844 }, heading: "Skill Audit audit evidence" },
    { name: "grade-mobile", path: "/skills/0x3-team/skill-audit/grade", viewport: { width: 390, height: 844 }, heading: "Skill Audit grade evidence" },
    { name: "account-empty-desktop", path: "/account", viewport: { width: 1280, height: 900 }, heading: "Your saved skills" },
    { name: "submit-mobile-authenticated", path: "/submit", viewport: { width: 390, height: 844 }, heading: "Submit one exact skill version." },
    { name: "report-mobile-authenticated", path: "/skills/0x3-team/skill-audit#report-listing", viewport: { width: 390, height: 844 }, heading: "Skill Audit" }
  ];
  for (const [caseIndex, visualCase] of cases.entries()) {
    await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${80 + caseIndex}` });
    await page.setViewportSize(visualCase.viewport);
    const response = await page.goto(new URL(visualCase.path, baseUrl).toString(), { waitUntil: "load" });
    assert.equal(response?.status(), 200, `${visualCase.name} returned HTTP ${response?.status()}`);
    await page.getByRole("heading", { level: 1, name: visualCase.heading }).waitFor();
    if (visualCase.path.includes("#report-listing")) await page.getByRole("heading", { name: "Report a suspicious listing" }).scrollIntoViewIfNeeded();
    await assertPageSemantics(page, visualCase.name);
    if (visualCase.name === "detail-compact-320" || visualCase.name === "detail-mobile-390") {
      await assertMobileSkillActionOrder(page, visualCase.name);
    }
    await normalizeVisualState(page);
    visuals.push(await captureVisual(page, visualCase.name));
  }

  for (const [metadataIndex, metadataCase] of [
    { path: "/skills", title: "Skill library | SkillMap", description: "Browse exact-source agent skills with separate provenance, license, audit, compatibility, lifecycle, and grade evidence.", heading: "Inspect the evidence before the instruction body." },
    { path: "/privacy", title: "Privacy | SkillMap", description: "Understand which SkillMap data stays local and which account, save, submission, and report data the hosted service stores.", heading: "Know what stays local and what the hosted service stores.", intro: "Raw local operator material stays on-device by default. Hosted accounts, saves, submissions, and private reports cross a separate, explicitly disclosed service boundary." },
    { path: "/security", title: "Security | SkillMap", description: "Review SkillMap's local connector controls, hosted evidence boundaries, immutable source identity, and deliberate security limits.", heading: "Explicit authority from local routing to public evidence." }
  ].entries()) {
    await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${120 + metadataIndex}` });
    const response = await page.goto(new URL(metadataCase.path, baseUrl).toString(), { waitUntil: "load" });
    assert.equal(response?.status(), 200, `${metadataCase.path} metadata route returned HTTP ${response?.status()}.`);
    await page.getByRole("heading", { level: 1, name: metadataCase.heading }).waitFor();
    if (metadataCase.intro) await page.getByText(metadataCase.intro, { exact: true }).waitFor();
    await assertRouteMetadata(page, metadataCase);
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: width === 320 ? 760 : 844 });
    await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${130 + width / 10}` });
    const response = await page.goto(new URL("/", baseUrl).toString(), { waitUntil: "load" });
    assert.equal(response?.status(), 200, `Authenticated home at ${width}px returned HTTP ${response?.status()}.`);
    await assertMobileAccountControl(page, "authenticated", "Account", "/account", `authenticated home at ${width}px`);
    await assertPageSemantics(page, `authenticated home at ${width}px`);
  }

  const signedOutContext = await browser.newContext({
    viewport: { width: 320, height: 760 },
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    deviceScaleFactor: 1
  });
  try {
    const signedOutPage = await signedOutContext.newPage();
    signedOutPage.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") diagnostics.push(`${message.type()}: ${message.text()}`);
    });
    signedOutPage.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
    for (const width of [320, 390]) {
      await signedOutPage.setViewportSize({ width, height: width === 320 ? 760 : 844 });
      await signedOutPage.setExtraHTTPHeaders({ "x-vercel-forwarded-for": `203.0.113.${140 + width / 10}` });
      const response = await signedOutPage.goto(new URL("/", baseUrl).toString(), { waitUntil: "load" });
      assert.equal(response?.status(), 200, `Signed-out home at ${width}px returned HTTP ${response?.status()}.`);
      await assertMobileAccountControl(signedOutPage, "signed-out", "Sign in", "/sign-in", `signed-out home at ${width}px`);
      await assertPageSemantics(signedOutPage, `signed-out home at ${width}px`);
    }
  } finally {
    await signedOutContext.close();
  }

  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "203.0.113.110" });
  await page.setViewportSize({ width: 320, height: 760 });
  const invalidResponse = await page.goto(new URL("/skills?q=one&q=two", baseUrl).toString(), { waitUntil: "load" });
  assert.equal(invalidResponse?.status(), 200, `Invalid-query UX returned HTTP ${invalidResponse?.status()}.`);
  await page.getByRole("heading", { level: 1, name: "Catalog query rejected" }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Repeated q parameters are not allowed." }).waitFor();
  await assertPageSemantics(page, "catalog-invalid-query-320");

  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "203.0.113.111" });
  await page.setViewportSize({ width: 1280, height: 900 });
  const keyboardResponse = await page.goto(new URL("/", baseUrl).toString(), { waitUntil: "load" });
  assert.equal(keyboardResponse?.status(), 200, `Keyboard QA route returned HTTP ${keyboardResponse?.status()}.`);
  await page.getByRole("heading", { level: 1, name: /Find agent skills/ }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Skip to main content", "First keyboard focus did not reach the hosted skip link.");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "main-content");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  const focusTrail = [];
  for (let index = 0; index < 12 && focusTrail.length < 6; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || !element.matches(":focus-visible")
        || !element.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')) return null;
      return `${element.tagName}:${element.getAttribute("href") ?? ""}:${(element.textContent ?? "").trim()}`;
    });
    if (focused) focusTrail.push(focused);
  }
  assert.equal(focusTrail.length, 6, `Keyboard traversal produced only ${focusTrail.length} visible focus steps.`);
  assert.ok(new Set(focusTrail).size >= 4, `Keyboard traversal did not move through distinct actions (${focusTrail.join(" | ")}).`);

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "203.0.113.112" });
  const forcedColorsResponse = await page.goto(new URL("/skills/0x3-team/skill-audit", baseUrl).toString(), { waitUntil: "load" });
  assert.equal(forcedColorsResponse?.status(), 200, `Forced-colors QA route returned HTTP ${forcedColorsResponse?.status()}.`);
  await page.getByRole("heading", { level: 1, name: "Skill Audit" }).waitFor();
  await assertPageSemantics(page, "detail-forced-colors");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  let forcedFocus = null;
  for (let index = 0; index < 6 && forcedFocus === null; index += 1) {
    await page.keyboard.press("Tab");
    forcedFocus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || !element.matches(":focus-visible")) return null;
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    });
  }
  assert.ok(forcedFocus, "Forced-colors keyboard traversal did not produce a visible focus target.");
  assert.ok(
    (forcedFocus.outlineStyle !== "none" && forcedFocus.outlineWidth !== "0px") || forcedFocus.boxShadow !== "none",
    `Forced-colors keyboard focus had no visible outline (${JSON.stringify(forcedFocus)}).`
  );
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });

  await page.setViewportSize({ width: 640, height: 900 });
  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "203.0.113.113" });
  const zoomResponse = await page.goto(new URL("/submit", baseUrl).toString(), { waitUntil: "load" });
  assert.equal(zoomResponse?.status(), 200, `Zoom QA route returned HTTP ${zoomResponse?.status()}.`);
  await page.getByRole("heading", { level: 1, name: "Submit one exact skill version." }).waitFor();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const zoomWidth = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), id: element.id, classes: element.getAttribute("class") ?? "", left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((entry) => entry.left < -0.5 || entry.right > window.innerWidth + 0.5)
      .slice(0, 10)
  }));
  assert.ok(zoomWidth.scroll <= zoomWidth.inner, `Hosted submit overflowed at 200% zoom (${zoomWidth.scroll} > ${zoomWidth.inner}; offenders ${JSON.stringify(zoomWidth.offenders)}).`);

  if (diagnostics.length > 0) throw new Error(`Hosted frontend diagnostics:\n${diagnostics.join("\n")}`);
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  try { await context?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await browser?.close(); } catch (error) { cleanupErrors.push(error); }
  try {
    const { error } = await admin.auth.admin.deleteUser(created.user.id);
    if (error) cleanupErrors.push(error);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (!/^[0-9a-f-]{36}$/.test(created.user.id)) throw new Error("Hosted frontend QA user ID was not canonical during cleanup.");
    const remainingProfiles = execLocalPsql([databaseUrl, "-AtX", "-c", `select count(*) from api.profiles where user_id = '${created.user.id}'::uuid`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (remainingProfiles !== "0") cleanupErrors.push(new Error(`Hosted frontend QA profile survived cleanup (${remainingProfiles}).`));
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) failure = failure
    ? new AggregateError([failure, ...cleanupErrors], "Hosted frontend QA and cleanup failed.")
    : new AggregateError(cleanupErrors, "Hosted frontend QA cleanup failed.");
}

await writeFile(path.join(artifactDir, "hosted-frontend-qa.json"), `${JSON.stringify({
  schemaVersion: "skillmap-hosted-frontend-qa/v1",
  status: failure ? "failed" : "passed",
  browser: { name: "chromium", version: browserVersion },
  checks: ["semantic-controls", "shared-skip-link-and-focus-target", "six-step-keyboard-focus", "mobile-account-control-320-and-390", "route-specific-public-metadata", "mobile-save-before-report", "320-and-390-responsive", "invalid-query-heading", "200-percent-zoom", "forced-colors-structure-and-focus", "reviewed-visual-baselines"],
  visuals,
  diagnostics: diagnostics.length,
  cleanup: failure ? "see-error" : "browser-context-user-profile-removed"
}, null, 2)}\n`, "utf8");
if (failure) throw failure;
process.stdout.write(`${JSON.stringify({ result: "pass", browser: "chromium", visualBaselines: visuals.length, accessibility: "semantic-keyboard-zoom-forced-colors", diagnostics: 0, cleanup: "verified" })}\n`);

async function assertPageSemantics(page, label) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const unlabeledControls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
      .filter(visible)
      .filter((element) => !(element.labels?.length) && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby"))
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`);
    const unnamedActions = [...document.querySelectorAll("a[href], button")]
      .filter(visible)
      .filter((element) => !(element.textContent ?? "").trim() && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby"))
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`);
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    return {
      mains: document.querySelectorAll("main").length,
      mainContentTargets: document.querySelectorAll("#main-content").length,
      mainContentTag: document.querySelector("#main-content")?.tagName ?? null,
      mainContentTabIndex: document.querySelector("#main-content")?.getAttribute("tabindex") ?? null,
      skipLinks: document.querySelectorAll('a[href="#main-content"]').length,
      headings: document.querySelectorAll("h1").length,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      unlabeledControls,
      unnamedActions,
      duplicateIds
    };
  });
  assert.equal(result.mains, 1, `${label} did not expose exactly one main landmark.`);
  assert.equal(result.mainContentTargets, 1, `${label} did not expose exactly one #main-content target.`);
  assert.equal(result.mainContentTag, "MAIN", `${label} did not bind #main-content to its main landmark.`);
  assert.equal(result.mainContentTabIndex, "-1", `${label} did not make #main-content programmatically focusable.`);
  assert.equal(result.skipLinks, 1, `${label} did not expose exactly one hosted skip link.`);
  assert.equal(result.headings, 1, `${label} did not expose exactly one h1.`);
  assert.ok(result.scrollWidth <= result.innerWidth, `${label} overflowed (${result.scrollWidth} > ${result.innerWidth}).`);
  assert.deepEqual(result.unlabeledControls, [], `${label} has unlabeled controls.`);
  assert.deepEqual(result.unnamedActions, [], `${label} has unnamed actions.`);
  assert.deepEqual(result.duplicateIds, [], `${label} has duplicate IDs.`);
}

async function assertMobileAccountControl(page, state, label, href, contextLabel) {
  const control = page.locator(`[data-account-control="${state}"]`);
  await control.waitFor({ state: "visible" });
  assert.equal((await control.textContent())?.trim(), label, `${contextLabel} mislabeled its direct account control.`);
  assert.equal(await control.getAttribute("href"), href, `${contextLabel} pointed its direct account control at the wrong route.`);
  const bounds = await control.boundingBox();
  assert.ok(bounds, `${contextLabel} did not render a measurable direct account control.`);
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= await page.evaluate(() => window.innerWidth),
    `${contextLabel} pushed its direct account control outside the viewport (${JSON.stringify(bounds)}).`);
}

async function assertRouteMetadata(page, { path: routePath, title, description }) {
  const metadata = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((element) => element.getAttribute("href")),
    openGraphTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
    openGraphDescription: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? null,
    openGraphUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? null,
    twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? null,
    twitterDescription: document.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? null
  }));
  const canonical = new URL(routePath, baseUrl).toString();
  assert.equal(metadata.title, title, `${routePath} rendered the wrong document title.`);
  assert.equal(metadata.description, description, `${routePath} rendered the wrong meta description.`);
  assert.deepEqual(metadata.canonical, [canonical], `${routePath} did not render one route-specific canonical URL.`);
  assert.equal(metadata.openGraphTitle, title, `${routePath} rendered the wrong Open Graph title.`);
  assert.equal(metadata.openGraphDescription, description, `${routePath} rendered the wrong Open Graph description.`);
  assert.equal(metadata.openGraphUrl, canonical, `${routePath} rendered the wrong Open Graph URL.`);
  assert.equal(metadata.twitterTitle, title, `${routePath} rendered the wrong Twitter title.`);
  assert.equal(metadata.twitterDescription, description, `${routePath} rendered the wrong Twitter description.`);
}

async function assertMobileSkillActionOrder(page, label) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const actionPanel = [...document.querySelectorAll("[data-skill-actions]")].find(visible);
    const reportSection = document.getElementById("report-listing");
    const action = actionPanel
      ? [...actionPanel.querySelectorAll("a[href],button")].find((element) => visible(element)
        && /^(?:Save skill|Remove from saved|Sign in to save)$/.test((element.textContent ?? "").trim()))
      : null;
    if (!(actionPanel instanceof HTMLElement) || !(reportSection instanceof HTMLElement)
      || !(action instanceof HTMLElement)) return null;
    return {
      actionText: (action.textContent ?? "").trim(),
      actionTop: action.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
      panelBeforeReport: Boolean(actionPanel.compareDocumentPosition(reportSection) & Node.DOCUMENT_POSITION_FOLLOWING),
      actionBeforeReport: Boolean(action.compareDocumentPosition(reportSection) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  });
  assert.ok(result, `${label} did not expose one visible mobile skill action panel.`);
  assert.match(result.actionText, /^(?:Save skill|Remove from saved|Sign in to save)$/);
  assert.ok(result.actionTop >= 0 && result.actionTop < result.viewportHeight,
    `${label} buried the save action below the initial viewport (${result.actionTop} >= ${result.viewportHeight}).`);
  assert.equal(result.panelBeforeReport, true, `${label} rendered the action panel after the report section.`);
  assert.equal(result.actionBeforeReport, true, `${label} keyboard order reached the report section before the save action.`);
}

async function normalizeVisualState(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('input[name="idempotencyKey"]').evaluateAll((inputs) => {
    for (const input of inputs) input.value = "00000000-0000-4000-8000-000000000000";
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function captureVisual(page, name) {
  const actualPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ animations: "disabled", caret: "hide", scale: "css", fullPage: true });
  const actual = await page.screenshot({ path: actualPath, animations: "disabled", caret: "hide", scale: "css", fullPage: true });
  const baselinePath = path.join(baselineDir, `${name}.png`);
  if (updateBaselines) {
    await writeFile(baselinePath, actual);
    return { name, diffPixels: 0, diffRatio: 0, baseline: path.relative(appDir, baselinePath), updated: true };
  }
  const expected = await readFile(baselinePath);
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);
  assert.equal(actualPng.width, expectedPng.width, `${name} visual width changed.`);
  assert.equal(actualPng.height, expectedPng.height, `${name} visual height changed.`);
  const diff = new PNG({ width: actualPng.width, height: actualPng.height });
  const diffPixels = pixelmatch(expectedPng.data, actualPng.data, diff.data, actualPng.width, actualPng.height, {
    threshold: 0.05,
    includeAA: false,
    alpha: 0.2,
    diffColor: [220, 38, 38],
    diffColorAlt: [37, 99, 235]
  });
  const diffRatio = diffPixels / (actualPng.width * actualPng.height);
  if (diffPixels > 0) await writeFile(path.join(diffDir, `${name}.png`), PNG.sync.write(diff));
  assert.equal(diffPixels, 0, `${name} visual regression changed ${diffPixels} pixels (${(diffRatio * 100).toFixed(4)}%).`);
  return { name, diffPixels, diffRatio, baseline: path.relative(appDir, baselinePath), updated: false };
}
