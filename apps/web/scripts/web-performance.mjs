import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const artifactDir = resolve(process.env.SKILLMAP_WEB_PERF_ARTIFACTS ?? join(appDir, ".artifacts", "web-performance"));
const reportPath = join(artifactDir, "web-performance.json");
const budgets = Object.freeze({
  lcpMs: positiveEnv("SKILLMAP_WEB_LCP_BUDGET_MS", 2500),
  inpMs: positiveEnv("SKILLMAP_WEB_INP_BUDGET_MS", 200),
  cls: positiveEnv("SKILLMAP_WEB_CLS_BUDGET", 0.1),
  routeJavaScriptBytes: positiveEnv("SKILLMAP_WEB_ROUTE_JS_BUDGET_BYTES", 294912)
});
const routes = ["/", "/dashboard", "/getting-started", "/security", "/privacy", "/support", "/release-status"];

await mkdir(artifactDir, { recursive: true });

let server;
let browser;
const report = {
  schemaVersion: 1,
  kind: "skillmap.public-web-performance",
  status: "failed",
  profile: {
    browser: "chromium",
    viewport: { width: 1440, height: 1000 },
    network: "local loopback, no throttling",
    cpu: "unthrottled CI host",
    cache: "fresh browser context per route",
    inpObserverThresholdMs: 16,
    harnessTelemetry: false,
    browserNetworkPolicy: "exact application origin only"
  },
  budgets,
  routes: []
};

try {
  const baseUrl = process.env.SKILLMAP_WEB_BASE_URL || await startProductionServer();
  browser = await chromium.launch({ headless: true });

  for (const pathname of routes) {
    report.routes.push(await measureRoute(browser, baseUrl, pathname));
  }

  report.status = "passed";
  report.completedAt = new Date().toISOString();
  process.stdout.write(`${formatSummary(report)}\n`);
} catch (error) {
  report.error = {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error)
  };
  report.completedAt = new Date().toISOString();
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await stopServer(server);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Public web performance report: ${reportPath}\n`);
}

async function measureRoute(browserType, baseUrl, pathname) {
  const context = await browserType.newContext({ viewport: report.profile.viewport });
  const page = await context.newPage();
  await page.addInitScript(installPerformanceObservers);
  const diagnostics = [];
  const allowedOrigin = new URL(baseUrl).origin;
  page.on("request", request => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      diagnostics.push(`external request: ${request.method()} ${url.origin}`);
    }
  });
  page.on("console", message => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", error => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => diagnostics.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`));
  page.on("response", response => {
    if (response.status() >= 500) diagnostics.push(`response: ${response.status()} ${response.url()}`);
  });

  try {
    const response = await page.goto(new URL(pathname, baseUrl).toString(), { waitUntil: "networkidle" });
    assert(response?.ok(), `${pathname} returned HTTP ${response?.status() ?? "unknown"}`);
    await exerciseInteraction(page, pathname);
    await page.waitForTimeout(750);

    // Web Vitals finalizes LCP/CLS/INP when the measured document becomes
    // hidden. Keep the page alive, foreground a blank sibling, then read the
    // locally retained metrics from the measured page.
    const finalizer = await context.newPage();
    await finalizer.goto("about:blank");
    await finalizer.bringToFront();
    await page.waitForTimeout(250);

    const measurement = await page.evaluate(() => {
      const observed = window.__SKILLMAP_PERFORMANCE_OBSERVERS__;
      observed?.flush();
      const vitals = observed?.metrics ?? {};
      const scripts = performance.getEntriesByType("resource")
        .filter(entry => entry.name.includes("/_next/static/") && /\.js(?:\?|$)/.test(entry.name))
        .map(entry => ({
          asset: new URL(entry.name).pathname,
          encodedBodyBytes: Number(entry.encodedBodySize) || 0,
          transferBytes: Number(entry.transferSize) || 0
        }))
        .sort((left, right) => left.asset.localeCompare(right.asset));
      const inlineBytes = [...document.scripts]
        .filter(script => !script.src)
        .reduce((sum, script) => sum + new TextEncoder().encode(script.textContent ?? "").byteLength, 0);
      const encodedBodyBytes = scripts.reduce((sum, entry) => sum + entry.encodedBodyBytes, 0);
      return {
        vitals,
        supported: observed?.supported ?? {},
        javascript: {
          externalEncodedBodyBytes: encodedBodyBytes,
          inlineBytes,
          totalBytes: encodedBodyBytes + inlineBytes,
          transferBytes: scripts.reduce((sum, entry) => sum + entry.transferBytes, 0),
          assets: scripts
        }
      };
    });
    await finalizer.close();

    assert(measurement.supported.lcp === true, `${pathname} browser does not support Largest Contentful Paint observation`);
    assert(measurement.supported.cls === true, `${pathname} browser does not support Layout Shift observation`);
    const lcp = finiteMetric(measurement.vitals.lcpMs, `${pathname} LCP`);
    const cls = finiteMetric(measurement.vitals.cls, `${pathname} CLS`);
    const inp = measurement.vitals.inpMs === null ? null : finiteMetric(measurement.vitals.inpMs, `${pathname} INP`);
    const interactive = isInteractiveProfile(pathname);
    const inpUpperBound = inp === null && interactive ? report.profile.inpObserverThresholdMs : null;
    assert(lcp <= budgets.lcpMs, `${pathname} LCP ${lcp} ms exceeds ${budgets.lcpMs} ms`);
    assert(cls <= budgets.cls, `${pathname} CLS ${cls} exceeds ${budgets.cls}`);
    if (interactive) {
      assert(measurement.supported.inp === true, `${pathname} browser does not support PerformanceEventTiming interaction IDs`);
      assert((inp ?? inpUpperBound) <= budgets.inpMs, `${pathname} INP ${inp ?? `under ${inpUpperBound}`} ms exceeds ${budgets.inpMs} ms`);
    }
    assert(measurement.javascript.externalEncodedBodyBytes > 0, `${pathname} did not record external route JavaScript bytes`);
    assert(
      measurement.javascript.totalBytes <= budgets.routeJavaScriptBytes,
      `${pathname} total route JavaScript ${measurement.javascript.totalBytes} bytes exceeds ${budgets.routeJavaScriptBytes}`
    );
    assert(diagnostics.length === 0, `${pathname} emitted unexpected diagnostics:\n${diagnostics.join("\n")}`);

    return {
      pathname,
      status: "passed",
      coreWebVitals: {
        source: "browser PerformanceObserver, page-local only",
        lcpMs: lcp,
        inpMs: inp,
        inpUpperBoundMs: inpUpperBound,
        inpGateStatus: !interactive ? "not-applicable" : inp === null ? "passed-below-observer-threshold" : "passed-measured",
        cls
      },
      javascript: measurement.javascript,
      diagnostics: []
    };
  } finally {
    await context.close();
  }
}

function installPerformanceObservers() {
  const metrics = { lcpMs: null, cls: 0, inpMs: null };
  const supportedEntries = new Set(PerformanceObserver.supportedEntryTypes ?? []);
  const supported = {
    lcp: supportedEntries.has("largest-contentful-paint"),
    cls: supportedEntries.has("layout-shift"),
    inp: supportedEntries.has("event") && "PerformanceEventTiming" in window && "interactionId" in PerformanceEventTiming.prototype
  };
  let clsWindowValue = 0;
  let clsWindowStartedAt = 0;
  let clsWindowLastAt = 0;

  const consumers = {
    lcp(entries) {
      for (const entry of entries) metrics.lcpMs = Math.max(metrics.lcpMs ?? 0, entry.startTime);
    },
    cls(entries) {
      for (const entry of entries) {
        if (entry.hadRecentInput) continue;
        if (clsWindowValue > 0 && entry.startTime - clsWindowLastAt < 1000 && entry.startTime - clsWindowStartedAt < 5000) {
          clsWindowValue += entry.value;
        } else {
          clsWindowValue = entry.value;
          clsWindowStartedAt = entry.startTime;
        }
        clsWindowLastAt = entry.startTime;
        metrics.cls = Math.max(metrics.cls, clsWindowValue);
      }
    },
    inp(entries) {
      for (const entry of entries) {
        if (!entry.interactionId) continue;
        metrics.inpMs = Math.max(metrics.inpMs ?? 0, entry.duration);
      }
    }
  };
  const observers = [];
  const observe = (key, type, options = {}) => {
    if (!supported[key]) return;
    const observer = new PerformanceObserver(list => consumers[key](list.getEntries()));
    observer.observe({ type, buffered: true, ...options });
    observers.push({ key, observer });
  };
  observe("lcp", "largest-contentful-paint");
  observe("cls", "layout-shift");
  observe("inp", "event", { durationThreshold: 16 });
  window.__SKILLMAP_PERFORMANCE_OBSERVERS__ = {
    metrics,
    supported,
    flush() {
      for (const { key, observer } of observers) consumers[key](observer.takeRecords());
    }
  };
}

async function exerciseInteraction(page, pathname) {
  if (pathname === "/") {
    await page.getByRole("button", { name: "Run recorded demo" }).click();
    await page.locator("#recorded-route-result").waitFor({ state: "visible" });
    return;
  }
  if (pathname === "/dashboard") {
    await page.getByRole("button", { name: "Route Lab", exact: true }).first().click();
    await page.getByRole("heading", { name: "Route Lab", exact: true }).waitFor({ state: "visible" });
  }
}

function isInteractiveProfile(pathname) {
  return pathname === "/" || pathname === "/dashboard";
}

async function startProductionServer() {
  const port = await reservePort();
  const nextBin = resolve(appDir, "node_modules", "next", "dist", "bin", "next");
  const output = [];
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: appDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on("data", chunk => {
      output.push(String(chunk));
      if (output.join("").length > 64 * 1024) output.shift();
    });
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js production server exited ${server.exitCode}: ${output.join("").slice(-4000)}`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return baseUrl;
    } catch {}
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Next.js production server did not become ready: ${output.join("").slice(-4000)}`);
}

function reservePort() {
  return new Promise((resolvePromise, reject) => {
    const socket = createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      const port = typeof address === "object" && address ? address.port : null;
      socket.close(error => error ? reject(error) : resolvePromise(port));
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolvePromise => child.once("exit", resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function finiteMetric(value, label) {
  assert(value !== null && value !== undefined, `${label} was not reported`);
  const number = Number(value);
  assert(Number.isFinite(number) && number >= 0, `${label} was not a finite non-negative number`);
  return Math.round(number * 1000) / 1000;
}

function positiveEnv(name, fallback) {
  if (!process.env[name]) return fallback;
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function formatSummary(value) {
  return value.routes.map(route => `${route.pathname}: LCP ${route.coreWebVitals.lcpMs} ms, INP ${route.coreWebVitals.inpMs ?? (route.coreWebVitals.inpUpperBoundMs ? `<${route.coreWebVitals.inpUpperBoundMs}` : "N/A")} ms, CLS ${route.coreWebVitals.cls}, JS ${route.javascript.totalBytes} bytes`).join("\n");
}
