import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const VISUAL_CLOCK_ISO = "2026-07-10T12:00:00.000Z";
export const VISUAL_VIEWPORT = Object.freeze({ width: 1024, height: 768 });
export const VISUAL_BASELINE_KEY = "chromium-linux";
export const WARM_STARTUP_OPTIMIZATION_TARGET_MS = 1000;

const MODE_FLAGS = new Map([
  ["--critical", "critical"],
  ["--a11y", "a11y"],
  ["--visual", "visual"],
  ["--perf", "perf"]
]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);

export function parseQaOptions(argv) {
  const modes = new Set();
  let browserName = "chromium";
  let updateVisualBaselines = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (MODE_FLAGS.has(value)) {
      modes.add(MODE_FLAGS.get(value));
      continue;
    }
    if (value === "--update-visual-baselines") {
      updateVisualBaselines = true;
      modes.add("visual");
      continue;
    }
    if (value === "--browser") {
      browserName = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value.startsWith("--browser=")) {
      browserName = value.slice("--browser=".length);
      continue;
    }
    throw new Error(`Unknown local-app browser option: ${value}`);
  }
  if (modes.size === 0) modes.add("critical");
  if (!BROWSERS.has(browserName)) throw new Error(`Browser must be one of: ${[...BROWSERS].join(", ")}.`);
  if (browserName !== "chromium" && [...modes].some(mode => ["a11y", "visual", "perf"].includes(mode))) {
    throw new Error("Accessibility, deterministic visual, and performance lanes are Chromium-only; use --critical for Firefox or WebKit.");
  }
  if (updateVisualBaselines && (browserName !== "chromium" || process.platform !== "linux")) {
    throw new Error("Visual baselines may only be updated with pinned Chromium on Linux.");
  }
  const artifactDir = path.resolve(process.env.SKILLMAP_BROWSER_ARTIFACTS || path.join(tmpdir(), "skillmap-local-app-artifacts", `${browserName}-${process.pid}`));
  return {
    browserName,
    modes,
    updateVisualBaselines,
    artifactDir,
    budgets: {
      coldStartupMs: positiveEnv("SKILLMAP_LOCAL_APP_COLD_STARTUP_BUDGET_MS", 6000),
      warmStartupMs: positiveEnv("SKILLMAP_LOCAL_APP_WARM_STARTUP_BUDGET_MS", 2500),
      routeResultMs: positiveEnv("SKILLMAP_LOCAL_APP_ROUTE_BUDGET_MS", Number(process.env.SKILLMAP_LOCAL_APP_PERF_BUDGET_MS || 2000)),
      transitionFeedbackMs: positiveEnv("SKILLMAP_LOCAL_APP_TRANSITION_FEEDBACK_BUDGET_MS", 200),
      transitionCompleteMs: positiveEnv("SKILLMAP_LOCAL_APP_TRANSITION_COMPLETE_BUDGET_MS", 1000),
      filter500Ms: positiveEnv("SKILLMAP_LOCAL_APP_FILTER_500_BUDGET_MS", 100),
      deepLinkMs: positiveEnv("SKILLMAP_LOCAL_APP_DEEP_LINK_BUDGET_MS", 4000),
      staticRawBytes: positiveEnv("SKILLMAP_LOCAL_APP_STATIC_RAW_BUDGET_BYTES", 393216),
      staticGzipBytes: positiveEnv("SKILLMAP_LOCAL_APP_STATIC_GZIP_BUDGET_BYTES", 102400)
    },
    visual: {
      threshold: boundedEnv("SKILLMAP_VISUAL_THRESHOLD", 0.05, 0, 1),
      maxDiffRatio: boundedEnv("SKILLMAP_VISUAL_MAX_DIFF_RATIO", 0.0001, 0, 1)
    }
  };
}

export async function prepareArtifactDirectory(artifactDir) {
  await rm(path.join(artifactDir, "screenshots"), { recursive: true, force: true });
  await rm(path.join(artifactDir, "diffs"), { recursive: true, force: true });
  await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
  await mkdir(path.join(artifactDir, "diffs"), { recursive: true });
}

export async function measureStaticAssets(assetRoot) {
  const files = [];
  await visit(assetRoot, files);
  const entries = [];
  for (const file of files.sort()) {
    const contents = await readFile(file);
    entries.push({
      file: path.relative(assetRoot, file).split(path.sep).join("/"),
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength
    });
  }
  return {
    files: entries,
    totalRawBytes: entries.reduce((sum, item) => sum + item.rawBytes, 0),
    totalGzipBytes: entries.reduce((sum, item) => sum + item.gzipBytes, 0)
  };
}

export function assertBudget(metric, value, budget, unit = "ms") {
  assert.ok(Number.isFinite(value), `${metric} did not produce a finite measurement`);
  assert.ok(value <= budget, `${metric} measured ${format(value)} ${unit}, exceeding the ${format(budget)} ${unit} budget`);
}

export async function createVisualGate({ appDir, repoDir, artifactDir, browserVersion, playwrightVersion, options }) {
  const baselineDir = path.join(appDir, "tests", "visual-baselines", "local-app", VISUAL_BASELINE_KEY);
  const manifestPath = path.join(baselineDir, "manifest.json");
  const environment = {
    schemaVersion: 1,
    browser: "chromium",
    browserVersion,
    playwrightVersion,
    platform: process.platform,
    operatingSystem: await linuxDistribution(),
    viewport: VISUAL_VIEWPORT,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    clock: VISUAL_CLOCK_ISO,
    font: "@fontsource/inter@5.2.8"
  };
  if (options.updateVisualBaselines) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
  } else {
    let expected;
    try { expected = JSON.parse(await readFile(manifestPath, "utf8")); }
    catch (error) {
      if (error?.code === "ENOENT") throw new Error("Visual baseline manifest is missing. Run `npm run test:visual:update` in the pinned Linux Chromium environment and review the generated images.");
      throw error;
    }
    assert.deepEqual(environment, expected, `Visual environment drifted from ${path.relative(repoDir, manifestPath)}. Update Playwright/browser/font intentionally before regenerating reviewed baselines.`);
  }
  const visualResources = await deterministicVisualResources(appDir);
  const routedPages = new WeakSet();
  return {
    async assertRepeatable(firstPage, secondPage, name) {
      const firstPath = path.join(artifactDir, "screenshots", `${name}-repeatability-a.png`);
      const secondPath = path.join(artifactDir, "screenshots", `${name}-repeatability-b.png`);
      const diffPath = path.join(artifactDir, "diffs", `${name}-repeatability.png`);
      const first = await captureNormalizedScreenshot(firstPage, firstPath, visualResources, routedPages);
      const second = await captureNormalizedScreenshot(secondPage, secondPath, visualResources, routedPages);
      const firstPng = PNG.sync.read(first);
      const secondPng = PNG.sync.read(second);
      assert.equal(secondPng.width, firstPng.width, `${name} repeatability screenshot width changed`);
      assert.equal(secondPng.height, firstPng.height, `${name} repeatability screenshot height changed`);
      if (Buffer.compare(firstPng.data, secondPng.data) !== 0) {
        const diff = new PNG({ width: firstPng.width, height: firstPng.height });
        const diffPixels = pixelmatch(
          firstPng.data,
          secondPng.data,
          diff.data,
          firstPng.width,
          firstPng.height,
          { threshold: 0, includeAA: true, alpha: 0.2, diffColor: [220, 38, 38], diffColorAlt: [37, 99, 235] }
        );
        await writeFile(diffPath, PNG.sync.write(diff));
        throw new Error(`${name} normalized workspace repeatability failed: ${diffPixels} pixels differ; inspect ${diffPath}`);
      }
      console.log(`visual repeatability: ${name} matched across two independently created workspaces (0 pixels differ)`);
      return { name: `${name}-repeatability`, diffPixels: 0, diffRatio: 0, firstPath, secondPath };
    },
    async capture(page, name) {
      const actualPath = path.join(artifactDir, "screenshots", `${name}.png`);
      const actual = await captureNormalizedScreenshot(page, actualPath, visualResources, routedPages);
      const baselinePath = path.join(baselineDir, `${name}.png`);
      if (options.updateVisualBaselines) {
        await writeFile(baselinePath, actual);
        console.log(`visual baseline updated: ${path.relative(repoDir, baselinePath)}`);
        return { name, diffPixels: 0, diffRatio: 0, actualPath, baselinePath, updated: true };
      }
      let expectedBuffer;
      try { expectedBuffer = await readFile(baselinePath); }
      catch (error) {
        if (error?.code === "ENOENT") throw new Error(`Visual baseline ${path.relative(repoDir, baselinePath)} is missing. Baseline creation is explicit; run npm run test:visual:update and review it.`);
        throw error;
      }
      const expectedPng = PNG.sync.read(expectedBuffer);
      const actualPng = PNG.sync.read(actual);
      assert.equal(actualPng.width, expectedPng.width, `${name} screenshot width changed`);
      assert.equal(actualPng.height, expectedPng.height, `${name} screenshot height changed`);
      const diff = new PNG({ width: expectedPng.width, height: expectedPng.height });
      const diffPixels = pixelmatch(expectedPng.data, actualPng.data, diff.data, expectedPng.width, expectedPng.height, {
        threshold: options.visual.threshold,
        includeAA: false,
        alpha: 0.2,
        diffColor: [220, 38, 38],
        diffColorAlt: [37, 99, 235]
      });
      const diffRatio = diffPixels / (expectedPng.width * expectedPng.height);
      const diffPath = path.join(artifactDir, "diffs", `${name}.png`);
      if (diffRatio > options.visual.maxDiffRatio) {
        await writeFile(diffPath, PNG.sync.write(diff));
        throw new Error(`${name} visual regression: ${diffPixels} pixels (${(diffRatio * 100).toFixed(4)}%) exceed ${(options.visual.maxDiffRatio * 100).toFixed(4)}%; inspect ${diffPath}`);
      }
      console.log(`visual: ${name} matched baseline (${diffPixels} pixels, ${(diffRatio * 100).toFixed(4)}%)`);
      return { name, diffPixels, diffRatio, actualPath, baselinePath, updated: false };
    }
  };
}

async function captureNormalizedScreenshot(page, targetPath, resources, routedPages) {
  try {
    await stabilizeVisualPage(page, resources, routedPages);
    // A screenshot forces Chromium to rasterize rounded borders. Under CPU-heavy
    // suites the first raster after identifier-width normalization can differ by
    // one color channel at a few antialiased corner pixels. Warm that exact paint,
    // then require two more frames before retaining the comparison artifact.
    // This keeps the pixel threshold at zero and preserves the reviewed styling.
    await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return await page.screenshot({ path: targetPath, animations: "disabled", caret: "hide", scale: "css" });
  } finally {
    await page.evaluate(() => {
      globalThis.__skillmapQaChromeObserver?.disconnect();
      delete globalThis.__skillmapQaChromeObserver;
    }).catch(() => {});
  }
}

export async function writeQaReport({ artifactDir, browserName, browserVersion, playwrightVersion, runtimePackage, modes, budgets, metrics, assets, visuals, status, error }) {
  const report = {
    schemaVersion: 1,
    browser: { name: browserName, version: browserVersion, playwrightVersion },
    platform: process.platform,
    runtimePackage,
    modes: [...modes].sort(),
    status,
    performance: performanceEvidence(metrics, budgets, modes),
    metrics,
    assets,
    visuals,
    ...(error ? { error: { name: error.name || "Error", message: String(error.message || error) } } : {})
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, `qa-${browserName}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function performanceEvidence(metrics, budgets, modes) {
  const performanceGateEnforced = modes instanceof Set ? modes.has("perf") : Array.isArray(modes) && modes.includes("perf");
  const coldMeasurement = finiteOrNull(metrics?.coldStartupMs);
  const warmMeasurement = finiteOrNull(metrics?.warmStartupMs);
  const deepLinkMeasurement = finiteOrNull(metrics?.deepLinkMs);
  const deepLinkMaximum = finiteOrNull(metrics?.deepLinkMaxMs);
  const deepLinkSamples = Array.isArray(metrics?.deepLinkSamplesMs)
    ? metrics.deepLinkSamplesMs.map(finiteOrNull).filter(value => value !== null)
    : [];
  const coldGate = finiteOrNull(budgets?.coldStartupMs);
  const warmGate = finiteOrNull(budgets?.warmStartupMs);
  const deepLinkGate = finiteOrNull(budgets?.deepLinkMs);
  const deepLinkGateEnforced = performanceGateEnforced && deepLinkSamples.length === 3;
  return {
    gateKind: performanceGateEnforced ? "provisional-regression-gate" : "not-enforced",
    startup: {
      cold: {
        run: "first authenticated application load",
        measurementMs: coldMeasurement,
        enforcedGateMs: performanceGateEnforced ? coldGate : null,
        gateStatus: performanceGateEnforced ? gateStatus(coldMeasurement, coldGate) : "not-enforced"
      },
      warm: {
        run: "authenticated reload with browser cache warm",
        measurementMs: warmMeasurement,
        enforcedGateMs: performanceGateEnforced ? warmGate : null,
        gateStatus: performanceGateEnforced ? gateStatus(warmMeasurement, warmGate) : "not-enforced",
        optimizationTargetMs: WARM_STARTUP_OPTIMIZATION_TARGET_MS,
        optimizationTargetEnforced: false,
        optimizationTargetStatus: targetStatus(warmMeasurement, WARM_STARTUP_OPTIMIZATION_TARGET_MS)
      }
    },
    deepLink: {
      run: "authenticated Activity reload through its data-ready state",
      aggregation: deepLinkGateEnforced ? "median-of-three" : deepLinkSamples.length === 1 ? "single-sample-not-enforced" : "not-measured",
      samplesMs: deepLinkSamples,
      measurementMs: deepLinkMeasurement,
      maximumMs: deepLinkMaximum,
      enforcedGateMs: deepLinkGateEnforced ? deepLinkGate : null,
      gateStatus: deepLinkGateEnforced ? gateStatus(deepLinkMeasurement, deepLinkGate) : "not-enforced"
    },
    enforcedBudgets: performanceGateEnforced ? budgets ?? null : null
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function gateStatus(measurement, gate) {
  if (measurement === null || gate === null) return "not-measured";
  return measurement <= gate ? "passed" : "failed";
}

function targetStatus(measurement, target) {
  if (measurement === null) return "not-measured";
  return measurement <= target ? "met" : "unmet";
}

async function stabilizeVisualPage(page, resources, routedPages) {
  if (!routedPages.has(page)) {
    await page.route("**/__skillmap-qa-visual.css", route => route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: resources.css }));
    for (const [pathname, body] of resources.fonts) {
      await page.route(`**${pathname}`, route => route.fulfill({ status: 200, contentType: "font/woff2", body }));
    }
    routedPages.add(page);
  }
  await page.evaluate(async () => {
    let link = document.querySelector('link[data-skillmap-qa-visual="true"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/__skillmap-qa-visual.css";
      link.dataset.skillmapQaVisual = "true";
      await new Promise((resolve, reject) => {
        link.addEventListener("load", resolve, { once: true });
        link.addEventListener("error", () => reject(new Error("deterministic visual stylesheet failed to load")), { once: true });
        document.head.append(link);
      });
    }
    await Promise.all([400, 600, 700].map(weight => document.fonts.load(`${weight} 16px "SkillMap QA Inter"`)));
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const curationHandoff = document.querySelector('#curation-handoff');
    if (curationHandoff) {
      const targetTop = 165;
      scrollBy(0, curationHandoff.getBoundingClientRect().top - targetTop);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await page.evaluate(() => {
    const identifierReplacements = [
      [/r\d{20}-[0-9a-f-]{36}/gi, "r00000000000000000000-00000000-0000-4000-8000-000000000000"],
      [/sha256:[a-f0-9]{7}…[a-f0-9]{6}/gi, "sha256:0000000…000000"],
      [/sha256:[a-f0-9]{64}/gi, "sha256:0000000000000000000000000000000000000000000000000000000000000000"],
      [/sk_[A-Za-z0-9_-]{43}/g, "sk_QA00000000000000000000000000000000000000000"],
      [/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "00000000-0000-4000-8000-000000000000"],
      [/\b[0-9a-f]{8}-[0-9a-f]{3}\b/gi, "00000000-000"]
    ];
    const measurementReplacements = [
      [/\b\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (?:AM|PM)\b/g, "7/10/2026, 12:00:00 PM"],
      [/\b\d+(?:\.\d+)? ms\b/g, "12 ms"]
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      let value = walker.currentNode.nodeValue;
      let identifierChanged = false;
      for (const [pattern, replacement] of identifierReplacements) {
        const next = value.replace(pattern, replacement);
        identifierChanged ||= next !== value;
        value = next;
      }
      for (const [pattern, replacement] of measurementReplacements) value = value.replace(pattern, replacement);
      walker.currentNode.nodeValue = value;
      if (identifierChanged && walker.currentNode.parentElement) {
        walker.currentNode.parentElement.dataset.skillmapQaRuntimeIdentifier = "true";
      }
    }
    const normalizedChrome = [
      ["#workspace-button", "QA workspace"],
      ["#revision-short", "r0000000000000"]
    ];
    const enforceNormalizedChrome = () => {
      for (const [selector, value] of normalizedChrome) {
        const element = document.querySelector(selector);
        if (!element) continue;
        if (element.textContent !== value) element.textContent = value;
        element.dataset.skillmapQaRuntimeIdentifier = "true";
      }
    };
    enforceNormalizedChrome();
    globalThis.__skillmapQaChromeObserver?.disconnect();
    globalThis.__skillmapQaChromeObserver = new MutationObserver(enforceNormalizedChrome);
    for (const [selector] of normalizedChrome) {
      const element = document.querySelector(selector);
      if (element) {
        globalThis.__skillmapQaChromeObserver.observe(element, {
          subtree: true,
          childList: true,
          characterData: true
        });
      }
    }
    document.querySelector("#toast-region")?.replaceChildren();
  });
  await page.evaluate(async () => {
    // Identifier normalization changes inline text widths after the earlier font
    // barrier. Force layout, then allow two paints so border antialiasing is
    // settled before independently created workspaces are compared pixel-for-pixel.
    document.documentElement.getBoundingClientRect();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Prove an asynchronous chrome refresh cannot race the screenshot after
    // normalization. MutationObserver delivery occurs before the next paint.
    document.querySelector("#workspace-button").textContent = "Late workspace refresh";
    document.querySelector("#revision-short").textContent = "late-revision";
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.querySelector("#workspace-button")?.textContent !== "QA workspace"
      || document.querySelector("#revision-short")?.textContent !== "r0000000000000") {
      throw new Error("Visual QA chrome normalization did not survive an asynchronous refresh.");
    }
  });
}

async function deterministicVisualResources(appDir) {
  const fontRoot = path.join(appDir, "node_modules", "@fontsource", "inter", "files");
  const definitions = [];
  const fonts = new Map();
  for (const weight of [400, 600, 700]) {
    const font = await readFile(path.join(fontRoot, `inter-latin-${weight}-normal.woff2`));
    const pathname = `/__skillmap-qa-inter-${weight}.woff2`;
    fonts.set(pathname, font);
    definitions.push(`@font-face { font-family: "SkillMap QA Inter"; src: url("${pathname}") format("woff2"); font-style: normal; font-weight: ${weight}; font-display: block; }`);
  }
  definitions.push('*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } html, body, button, input, textarea, select { font-family: "SkillMap QA Inter" !important; } [data-skillmap-qa-runtime-identifier="true"] { font-family: "SkillMap QA Inter" !important; font-variant-ligatures: none !important; font-variant-numeric: tabular-nums !important; }');
  return { css: definitions.join("\n"), fonts };
}

async function linuxDistribution() {
  if (process.platform !== "linux") return process.platform;
  const values = Object.fromEntries((await readFile("/etc/os-release", "utf8")).split(/\r?\n/).map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^"|"$/g, "")]));
  return `${values.ID || "linux"}-${values.VERSION_ID || "unknown"}`;
}

async function visit(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(target, files);
    else if (entry.isFile()) files.push(target);
  }
}

function positiveEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function boundedEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

function format(value) {
  return Number(value.toFixed(3)).toLocaleString("en-US");
}
