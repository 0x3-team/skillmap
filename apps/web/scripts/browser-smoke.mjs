import { chromium, firefox, webkit } from "playwright";

const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const expectedSource = process.env.SKILLMAP_EXPECT_SOURCE ?? "fixture";
const requestedEngines = new Set(
  (process.env.SKILLMAP_BROWSERS ?? "chromium,firefox,webkit")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const engines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
].filter(([name]) => requestedEngines.has(name));

if (engines.length === 0) {
  throw new Error(`No supported browser requested: ${[...requestedEngines].join(", ")}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  const scrollWidth = Math.max(metrics.bodyWidth, metrics.documentWidth);
  assert(
    scrollWidth <= metrics.innerWidth + 1,
    `${label} horizontal overflow: ${scrollWidth} > ${metrics.innerWidth}`
  );
}

async function assertTextVisible(page, pattern, label) {
  const visible = await page.getByText(pattern).first().isVisible().catch(() => false);
  assert(visible, `${label} was not visible`);
}

function captureDiagnostics(page, label) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    errors.push(
      `${label} requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      errors.push(`${label} response: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

function assertNoRuntimeDiagnostics(errors, label) {
  const hydration = errors.filter((entry) =>
    /hydration|did not match|server rendered html|error while hydrating/i.test(entry)
  );
  assert(hydration.length === 0, `${label} hydration errors:\n${hydration.join("\n")}`);
  const pageErrors = errors.filter((entry) => entry.includes(" pageerror:"));
  assert(pageErrors.length === 0, `${label} page errors:\n${pageErrors.join("\n")}`);
  assert(errors.length === 0, `${label} unexpected browser errors:\n${errors.join("\n")}`);
}

async function activeElementIsInside(locator) {
  return locator.evaluate((element) => element.contains(document.activeElement));
}

async function runCriticalFlow(name, browserType) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const diagnostics = captureDiagnostics(page, name);

    await page.goto(new URL("/", baseUrl).toString(), { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page, `${name} landing 390`);
    await assertTextVisible(page, /Local-first skill intelligence/i, `${name} product-state badge`);
    const initialDemoPrompt = await page.locator("#recorded-route-result").textContent();
    await page.getByRole("button", { name: "Run recorded demo" }).click();
    await page.waitForFunction(() => document.activeElement?.id === "recorded-route-result");
    const selectedDemoPrompt = await page.locator("#recorded-route-result").textContent();
    assert(selectedDemoPrompt !== initialDemoPrompt, `${name} recorded landing demo did not update`);

    await page.goto(new URL("/dashboard", baseUrl).toString(), { waitUntil: "networkidle" });
    await assertTextVisible(
      page,
      expectedSource === "local" ? /Local snapshot/i : /Fixture demo/i,
      `${name} source label`
    );
    const mobileSource = page.locator("#mobile-workspace-snapshot");
    assert(await mobileSource.isVisible(), `${name} mobile snapshot source switcher is hidden`);

    const tabs = page.getByRole("tab");
    assert((await tabs.count()) === 8, `${name} dashboard tab count changed`);
    assert(
      (await page.locator('[role="tab"][tabindex="0"]').count()) === 1,
      `${name} tabs do not expose one roving tab stop`
    );
    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    await overviewTab.focus();
    await page.keyboard.press("ArrowRight");
    const routeTab = page.getByRole("tab", { name: "Route Lab", exact: true });
    assert((await routeTab.getAttribute("aria-selected")) === "true", `${name} ArrowRight did not select Route Lab`);
    const controlledPanel = await routeTab.getAttribute("aria-controls");
    assert(controlledPanel === "dashboard-panel-route", `${name} tab aria-controls is incorrect`);
    assert((await page.locator(`#${controlledPanel}`).getAttribute("role")) === "tabpanel", `${name} tabpanel relationship is broken`);
    await routeTab.press("End");
    assert(
      (await page.getByRole("tab", { name: "QA", exact: true }).getAttribute("aria-selected")) === "true",
      `${name} End did not select the last tab`
    );
    await page.getByRole("tab", { name: "QA", exact: true }).press("Home");
    assert((await overviewTab.getAttribute("aria-selected")) === "true", `${name} Home did not select the first tab`);

    await mobileSource.selectOption("attention-required");
    assert((await mobileSource.inputValue()) === "attention-required", `${name} mobile source switch failed`);
    await mobileSource.selectOption("release-ready");

    await mobileSource.focus();
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: /command palette/i });
    await palette.waitFor({ state: "visible" });
    const commandSearch = page.getByRole("combobox", { name: "Search commands" });
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Command palette"]');
      return Boolean(dialog?.contains(document.activeElement));
    });
    assert(await activeElementIsInside(palette), `${name} palette did not contain initial focus`);
    await page.keyboard.press("Shift+Tab");
    assert(await activeElementIsInside(palette), `${name} focus escaped command palette`);
    await commandSearch.fill("attention-required");
    const activeDescendant = await commandSearch.getAttribute("aria-activedescendant");
    assert(Boolean(activeDescendant), `${name} command search has no active descendant`);
    assert(
      (await page.locator(`#${activeDescendant}`).getAttribute("aria-selected")) === "true",
      `${name} active command option is not announced`
    );
    await commandSearch.press("Enter");
    await palette.waitFor({ state: "hidden" });
    assert((await mobileSource.inputValue()) === "attention-required", `${name} palette invoked the wrong command`);
    await page.waitForFunction(() => document.activeElement?.id === "mobile-workspace-snapshot");
    await mobileSource.selectOption("release-ready");

    const navOpener = page.getByLabel("Open navigation");
    await navOpener.click();
    const drawer = page.getByRole("dialog", { name: /SkillMap navigation/i });
    await drawer.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby]');
      return Boolean(dialog?.contains(document.activeElement));
    });
    assert(await activeElementIsInside(drawer), `${name} drawer did not receive focus`);
    await page.keyboard.press("Shift+Tab");
    assert(await activeElementIsInside(drawer), `${name} focus escaped drawer`);
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open navigation");

    await routeTab.click();
    const demoPrompt = page.locator("#route-demo-prompt");
    await demoPrompt.fill("Plan a hosted skill library with privacy controls");
    await assertTextVisible(
      page,
      /Showing recorded trace: trace-hosted-skills-002/i,
      `${name} deterministic dashboard demo`
    );

    await page.getByRole("tab", { name: "Connector", exact: true }).click();
    await assertTextVisible(page, /Snapshot handoff is/i, `${name} snapshot handoff heading`);
    const commandBlock = page
      .getByRole("heading", { name: "Allowed local commands" })
      .locator("..")
      .locator(".mono")
      .first();
    await commandBlock.evaluate((element) => {
      element.textContent = `skillmap ${"x".repeat(420)}`;
    });
    await assertNoHorizontalOverflow(page, `${name} Connector 390 long command`);
    const commandWidths = await commandBlock.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }));
    assert(
      commandWidths.scroll <= commandWidths.client + 1,
      `${name} Connector command block overflows its card`
    );
    const infoButton = page.getByRole("button", { name: /This dashboard reads redacted snapshots/i });
    await infoButton.focus();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    assert(
      (await page.locator('input[type="checkbox"]').count()) === 0,
      `${name} source table exposes inert selection checkboxes`
    );

    await page.getByRole("tab", { name: "Skills", exact: true }).click();
    await page.getByRole("button", { name: /Sort by Skill/ }).click();
    assert(
      (await page.locator('th[aria-sort="ascending"]').count()) === 1,
      `${name} sortable table does not announce ascending state`
    );
    const firstSkillRow = page.locator("tbody tr").filter({ has: page.locator('input[type="checkbox"]') }).first();
    assert(
      (await firstSkillRow.getByRole("button").count()) === 1,
      `${name} skill row exposes duplicate cell-action tab stops`
    );
    await page.locator('input[type="checkbox"]').first().check();
    await assertTextVisible(page, /1 selected/i, `${name} selected-skill action bar`);
    await assertNoHorizontalOverflow(page, `${name} selected-skill action bar 390`);

    await page.setViewportSize({ width: 320, height: 740 });
    await assertNoHorizontalOverflow(page, `${name} selected-skill action bar 320`);
    await page.getByRole("tab", { name: "Connector", exact: true }).click();
    await assertNoHorizontalOverflow(page, `${name} Connector 320`);

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1440, height: 1000 }
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ["/", "/dashboard"]) {
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
        await assertNoHorizontalOverflow(page, `${name} ${route} ${viewport.width}`);
      }
    }

    assertNoRuntimeDiagnostics(diagnostics, `${name} critical flow`);
    await context.close();

    const reducedContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce"
    });
    const reducedPage = await reducedContext.newPage();
    const reducedDiagnostics = captureDiagnostics(reducedPage, `${name} reduced-motion`);
    await reducedPage.goto(new URL("/", baseUrl).toString(), { waitUntil: "networkidle" });
    assert(
      (await reducedPage.locator("body").textContent())?.includes("17.5"),
      `${name} reduced-motion metric did not render its final value`
    );
    await reducedPage.goto(new URL("/dashboard", baseUrl).toString(), { waitUntil: "networkidle" });
    await reducedPage.getByLabel("Open navigation").click();
    const reducedDrawer = reducedPage.getByRole("dialog", { name: /SkillMap navigation/i });
    await reducedDrawer.waitFor({ state: "visible" });
    const longMotion = await reducedDrawer.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .some((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 20)
    );
    assert(!longMotion, `${name} reduced-motion drawer retained a long animation`);
    await reducedPage.keyboard.press("Escape");
    await reducedDrawer.waitFor({ state: "hidden" });
    await reducedPage.keyboard.press("Control+K");
    const reducedPalette = reducedPage.getByRole("dialog", { name: /command palette/i });
    await reducedPalette.waitFor({ state: "visible" });
    const longPaletteMotion = await reducedPalette.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .some((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 20)
    );
    assert(!longPaletteMotion, `${name} reduced-motion palette retained a long animation`);
    assertNoRuntimeDiagnostics(reducedDiagnostics, `${name} reduced-motion flow`);
    await reducedContext.close();

    console.log(`${name} critical, accessibility, responsive, and reduced-motion smoke passed`);
  } finally {
    await browser.close();
  }
}

for (const [name, browserType] of engines) {
  await runCriticalFlow(name, browserType);
}

console.log(`${engines.map(([name]) => name).join(", ")} browser acceptance passed`);
