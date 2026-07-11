import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import {
  VISUAL_CLOCK_ISO,
  VISUAL_VIEWPORT,
  WARM_STARTUP_OPTIMIZATION_TARGET_MS,
  assertBudget,
  createVisualGate,
  measureStaticAssets,
  parseQaOptions,
  prepareArtifactDirectory,
  writeQaReport
} from "./local-app-qa.mjs";

const appDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoDir = path.resolve(appDir, "../..");
const requestedPackageRoot = process.env.SKILLMAP_BROWSER_PACKAGE_ROOT?.trim() || null;
const candidateSha256 = process.env.SKILLMAP_BROWSER_CANDIDATE_SHA256?.trim() || null;
assert.equal(Boolean(requestedPackageRoot), Boolean(candidateSha256), "candidate package root and SHA-256 must be supplied together");
if (candidateSha256) assert.match(candidateSha256, /^[0-9a-f]{64}$/, "candidate SHA-256 must be lowercase hexadecimal");
const runtimePackageRoot = requestedPackageRoot ? await realpath(path.resolve(requestedPackageRoot)) : repoDir;
const runtimeManifest = JSON.parse(await readFile(path.join(runtimePackageRoot, "package.json"), "utf8"));
assert.equal(runtimeManifest.name, "skillmap", "browser runtime package root must contain SkillMap");
assert.match(runtimeManifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "browser runtime package must have a supported semantic version");
const runtimePackage = {
  source: requestedPackageRoot ? "temporary-consumer-candidate" : "source-checkout",
  name: runtimeManifest.name,
  version: runtimeManifest.version,
  ...(candidateSha256 ? { sha256: candidateSha256 } : {})
};
const cli = path.join(runtimePackageRoot, "dist/cli.js");
const options = parseQaOptions(process.argv.slice(2));
const { browserName, modes, budgets } = options;
const browserTypes = { chromium, firefox, webkit };
const playwrightVersion = JSON.parse(await readFile(path.join(appDir, "node_modules", "playwright", "package.json"), "utf8")).version;
const keepWorkspace = process.env.SKILLMAP_KEEP_E2E_WORKSPACE === "1";
const workspace = await mkdtemp(path.join(tmpdir(), "skillmap-local-app-browser-"));
const workspaceSwitchRoot = await mkdtemp(path.join(tmpdir(), "skillmap-workspace-switch-browser-"));
const alternateWorkspace = path.join(workspaceSwitchRoot, "secret-workspace-label-canary");
const alternateWorkspaceLabel = 'Local workspace';
const newWorkspaceCandidate = path.join(workspaceSwitchRoot, "new-explicit");
let dashboard;
let browser;
let browserVersion = "unavailable";
let passed = false;
let failure = null;
let assets = null;
let visualGate = null;
const metrics = {};
const visuals = [];

try {
  await prepareArtifactDirectory(options.artifactDir);
  const setup = await prepareWorkspace(workspace, modes.has("perf") ? 500 : 1, { policyReviewReady: true });
  await mkdir(alternateWorkspace, { recursive: true });
  const alternateSetup = await prepareWorkspace(alternateWorkspace);
  dashboard = await startDashboard(workspace);
  assert.equal(dashboard.startup.kind, "skillmap.dashboard-started");
  assert.equal(dashboard.startup.mode, "foreground");
  assert.equal(dashboard.startup.promptRetention, false);
  assert.equal(dashboard.startup.workspace, workspace);
  assert.match(dashboard.startup.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(new URL(dashboard.startup.bootstrapUrl).origin, dashboard.startup.origin);

  browser = await browserTypes[browserName].launch();
  browserVersion = browser.version();
  console.log(`browser: ${browserName} ${browserVersion} via Playwright ${playwrightVersion}`);
  console.log(`runtime: ${runtimePackage.source} ${runtimePackage.name}@${runtimePackage.version}${runtimePackage.sha256 ? ` sha256:${runtimePackage.sha256}` : ""}`);
  assets = await measureStaticAssets(path.join(runtimePackageRoot, "assets", "local-app", "v1"));
  console.log(`assets: ${assets.files.length} files, ${assets.totalRawBytes} raw bytes, ${assets.totalGzipBytes} gzip bytes`);
  if (modes.has("perf")) {
    assertBudget("local app static assets", assets.totalRawBytes, budgets.staticRawBytes, "bytes raw");
    assertBudget("local app static assets", assets.totalGzipBytes, budgets.staticGzipBytes, "bytes gzip");
  }
  if (modes.has("visual")) {
    visualGate = await createVisualGate({ appDir, repoDir, artifactDir: options.artifactDir, browserVersion, playwrightVersion, options });
  }
  await exerciseLocalApp({ browser, dashboard: dashboard.startup, workspace, setup, alternateWorkspace, alternateSetup, newWorkspaceCandidate, modes, budgets, metrics, visualGate, visuals });
  await exercisePartialLegacyAdoption(browser, { modes, browserName });
  await exerciseDerivedRecovery(browser, { modes, visualGate, visuals });
  passed = true;
  console.log(`local app browser acceptance passed (${browserName}; ${[...modes].join(", ")})`);
} catch (error) {
  failure = error;
} finally {
  await browser?.close().catch(() => undefined);
  if (dashboard) {
    try {
      const exit = await dashboard.stop();
      assert.equal(exit.signal, null, `dashboard terminated by ${exit.signal}`);
      assert.equal(exit.code, 0, `dashboard exited ${exit.code}:\n${dashboard.stderr()}`);
      assert.equal(dashboard.stderr().trim(), "", `dashboard wrote stderr:\n${dashboard.stderr()}`);
      console.log("foreground dashboard shut down cleanly after SIGTERM");
    } catch (error) { failure ||= error; }
  }
  if (keepWorkspace) console.log(`kept local-app browser workspaces: ${workspace}, ${workspaceSwitchRoot}`);
  else {
    await rm(workspace, { recursive: true, force: true });
    await rm(workspaceSwitchRoot, { recursive: true, force: true });
  }
  await writeQaReport({ artifactDir: options.artifactDir, browserName, browserVersion, playwrightVersion, runtimePackage, modes, budgets, metrics, assets, visuals, status: passed && !failure ? "passed" : "failed", error: failure });
}
if (failure) throw failure;

async function prepareWorkspace(cwd, skillCount = 1, { policyReviewReady = false } = {}) {
  assert.ok(Number.isInteger(skillCount) && skillCount >= 1 && skillCount <= 500, "skillCount must be between 1 and 500");
  const skillsRoot = path.join(cwd, "skills");
  const skillDir = path.join(skillsRoot, "security-review");
  const policyFile = path.join(cwd, "reviewed-policy.yml");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), `---
name: security-review
description: Use for authentication, authorization, secret leakage, prompt injection, and security-sensitive code review.
---
# Security Review

Review access-control boundaries and sensitive data exposure without executing project code.
`, "utf8");
  for (let index = 1; index < skillCount; index += 1) {
    const name = `qa-skill-${String(index).padStart(3, "0")}`;
    const directory = path.join(skillsRoot, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Use for deterministic browser performance corpus item ${index}.\n---\n# ${name}\n`, "utf8");
  }
  await writeFile(policyFile, `version: 1
skills:
  security-review:
    tier: active-default
    family: security
    aliases:
      - authorization bypass
      - secret leakage
      - prompt injection
    preferred_for:
      - security code review
`, "utf8");

  const initialized = runCli(["init", "--root", skillsRoot, "--json"], cwd);
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.rootRecords.length, 1);
  const scanned = runCli(["scan", "--json"], cwd);
  assert.equal(scanned.inventory.skills.length, skillCount);
  const securitySkill = scanned.inventory.skills.find(skill => skill.name === "security-review");
  assert.ok(securitySkill, "prepared security-review skill was not scanned");
  const applied = runCli(["apply-policy", "--policy", policyFile, "--json"], cwd);
  assert.equal(applied.effectiveSummary.skills, skillCount);
  assert.equal(applied.effectiveSummary.routeEligible, 1);
  assert.match(applied.revision.revisionId, /^r\d{20}-[0-9a-f-]{36}$/i);
  assert.match(applied.revision.effectiveRevisionDigest, /^sha256:[0-9a-f]{64}$/);
  let revisionId = applied.revision.revisionId;
  if (policyReviewReady) {
    await writeFile(path.join(cwd, ".skillmap", "policy.yml"), policyV1WithoutSecurityReview(skillCount), "utf8");
    const imported = runCli(["state", "import-legacy", "--confirm", "--actor", "browser-qa", "--reason", "Prepare one explicit uncovered policy review item.", "--json"], cwd);
    assert.equal(imported.lastKnownGoodUpdated, false, "policy review fixture unexpectedly advanced routing approval");
    const migrated = runCli(["policy", "migrate", "--confirm", "--json"], cwd);
    assert.equal(migrated.policy.version, 2);
    assert.equal(migrated.mappedSkills, skillCount - 1);
    assert.deepEqual(migrated.unresolvedNames, []);
    assert.equal(migrated.revision.lastKnownGoodUpdated, false, "policy v2 fixture migration unexpectedly advanced routing approval");
    const approvedReviewState = runCli(["state", "import-legacy", "--confirm", "--approve-routing", "--actor", "browser-qa", "--reason", "Approve the unchanged effective registry while policy review remains blocking.", "--json"], cwd);
    assert.equal(approvedReviewState.lastKnownGoodUpdated, true, "policy review fixture did not retain an explicitly approved effective registry");
    revisionId = approvedReviewState.revision.revisionId;
  }
  return {
    skillId: securitySkill.skillId,
    skillCount,
    workspaceId: initialized.workspaceId,
    revisionId
  };
}

function policyV1WithoutSecurityReview(skillCount) {
  if (skillCount === 1) return "version: 1\nskills: {}\n";
  const skills = Array.from({ length: skillCount - 1 }, (_, offset) => {
    const name = `qa-skill-${String(offset + 1).padStart(3, "0")}`;
    return `  ${name}:\n    tier: specialist`;
  });
  return `version: 1\nskills:\n${skills.join("\n")}\n`;
}

async function exercisePartialLegacyAdoption(browser, { browserName }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "skillmap-partial-legacy-browser-"));
  const root = path.join(cwd, "skills");
  const skill = path.join(root, "legacy-alpha");
  let localDashboard;
  try {
    await mkdir(skill, { recursive: true });
    await mkdir(path.join(cwd, ".skillmap"), { recursive: true });
    await writeFile(path.join(skill, "SKILL.md"), "---\nname: legacy-alpha\ndescription: Use for reviewed partial legacy adoption.\n---\n# Legacy Alpha\n", "utf8");
    await writeFile(path.join(cwd, ".skillmap", "config.yml"), `version: 1\nprofile: personal-v1\nroots:\n  - ${JSON.stringify(root)}\n`, "utf8");
    localDashboard = await startDashboard(cwd);
    const context = await browser.newContext(qaContextOptions({ width: 1024, height: 768 }));
    const page = await context.newPage();
    await page.goto(localDashboard.startup.bootstrapUrl, { waitUntil: "networkidle" });
    await heading(page, "Set up this local workspace");
    await page.getByText("Config-only legacy workspace", { exact: true }).waitFor();
    const adoptionResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/state/adopt-partial-legacy" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Validate and adopt configured roots", exact: true }).click();
    const adoptionResponse = await adoptionResponsePromise;
    assert.equal(adoptionResponse.status(), 201, `partial legacy adoption failed: ${await adoptionResponse.text()}`);
    const bootstrap = (await authenticatedBrowserGet(page, "/api/v1/bootstrap")).body.data;
    assert.equal(bootstrap.initialized, true);
    assert.equal(bootstrap.routingReady, false);
    assert.equal(bootstrap.nextAction, "continue-onboarding");
    try {
      await page.getByText("Resume checklist", { exact: true }).waitFor();
    } catch (error) {
      const rendered = String(await page.locator("body").textContent()).replace(/\s+/g, " ").trim().slice(0, 1600);
      const toast = String(await page.locator("#toast-region").textContent()).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(`partial legacy adoption returned ${adoptionResponse.status()} but did not render Resume checklist; bootstrap=${JSON.stringify(bootstrap)} toast=${JSON.stringify(toast)} body=${JSON.stringify(rendered)}`, { cause: error });
    }
    await context.close();
    console.log(`onboarding: partial-legacy adoption passed in ${browserName}`);
  } finally {
    if (localDashboard) {
      const exit = await localDashboard.stop();
      assert.equal(exit.code, 0, localDashboard.stderr());
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

async function exerciseDerivedRecovery(browser, { modes, visualGate, visuals }) {
  const cwd = await mkdtemp(path.join(tmpdir(), "skillmap-derived-recovery-browser-"));
  let localDashboard;
  let context;
  try {
    const setup = await prepareWorkspace(cwd);
    const { WorkspaceStateStore } = await import(pathToFileURL(path.join(runtimePackageRoot, "dist", "core", "workspace-state", "index.js")).href);
    const store = WorkspaceStateStore.open(cwd);
    await writeFile(path.join(cwd, ".skillmap", "doctor.json"), '{"version":1,"derived":true}\n', "utf8");
    const current = await store.publishLegacySnapshot({ expectedRevisionId: setup.revisionId, approveForRouting: false });
    await writeFile(path.join(cwd, ".skillmap", "state", "revisions", current.pointer.revisionId, "workspace", ".skillmap", "effective.json"), '{"tampered":true}\n', "utf8");
    localDashboard = await startDashboard(cwd);
    context = await browser.newContext(qaContextOptions(VISUAL_VIEWPORT));
    if (modes.has("visual")) await installFixedClock(context);
    const page = await context.newPage();
    await page.goto(localDashboard.startup.bootstrapUrl, { waitUntil: "networkidle" });
    await heading(page, "Set up this local workspace");
    await page.getByText("Derived-state recovery is available", { exact: true }).waitFor();
    const before = (await authenticatedBrowserGet(page, "/api/v1/bootstrap")).body.data;
    assert.equal(before.state, "recovery-required");
    assert.equal(before.recoverable, true);
    if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "recovery-required"));
    const recoveryResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/state/recover" && response.request().method() === "POST");
    await page.getByRole("button", { name: "I reviewed diagnostics — recover LKG", exact: true }).click();
    const recoveryResponse = await recoveryResponsePromise;
    assert.equal(recoveryResponse.status(), 201, `derived recovery failed: ${await recoveryResponse.text()}`);
    const after = (await authenticatedBrowserGet(page, "/api/v1/bootstrap")).body.data;
    assert.equal(after.initialized, true);
    assert.notEqual(after.state, "recovery-required");
    assert.notEqual(after.recoverable, true);
    console.log("recovery: derived-only corruption recovered through the browser");
  } finally {
    await context?.close().catch(() => undefined);
    if (localDashboard) {
      const exit = await localDashboard.stop();
      assert.equal(exit.code, 0, localDashboard.stderr());
      assert.equal(localDashboard.stderr().trim(), "", localDashboard.stderr());
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

function runCli(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000
  });
  return JSON.parse(output);
}

async function startDashboard(cwd) {
  const child = spawn(process.execPath, [cli, "dashboard", "--json"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });

  const startup = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`dashboard did not start within 15 seconds:\n${stderr}`)), 15_000);
    const inspect = () => {
      const line = stdout.split(/\r?\n/).find(value => value.trim().startsWith("{"));
      if (!line) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.kind !== "skillmap.dashboard-started") return;
        clearTimeout(timeout);
        child.off("exit", onExit);
        resolve(parsed);
      } catch {}
    };
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`dashboard exited before startup (code=${code}, signal=${signal}):\n${stderr}`));
    };
    child.stdout.on("data", inspect);
    child.once("exit", onExit);
    inspect();
  });

  let stopPromise;
  return {
    startup,
    stderr: () => stderr,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve({ code: child.exitCode, signal: child.signalCode });
          return;
        }
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`dashboard did not stop after SIGTERM:\n${stderr}`));
        }, 10_000);
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
        child.kill("SIGTERM");
      });
      return stopPromise;
    }
  };
}

async function exerciseLocalApp({ browser, dashboard, workspace, setup, alternateWorkspace, alternateSetup, newWorkspaceCandidate, modes, budgets, metrics, visualGate, visuals }) {
  const context = await browser.newContext(qaContextOptions({ width: 1280, height: 900 }));
  if (modes.has("visual")) await installFixedClock(context);
  const page = await context.newPage();
  const phase = { offline: false, revisionRetry: false, revisionSettle: false, workflowRevisionSettle: false, policyPreview: false, workspaceConflict: false, workspaceOutcomeUnknown: false, workspaceTransition: false };
  let revisionSettleConflicts = 0;
  const diagnostics = captureDiagnostics(page, "main", event => {
    if (phase.revisionSettle
      && new URL(event.url).pathname === "/api/v1/bootstrap"
      && (event.kind === "response" && event.status === 409
        || event.kind === "console" && /status of 409|conflict/i.test(event.message))) return true;
    if (phase.workspaceOutcomeUnknown
      && new URL(event.url).pathname === '/api/v1/workspaces/select'
      && (event.kind === 'response' && event.status === 500
        || event.kind === 'console' && /status of 500|server error/i.test(event.message))) return true;
    if (phase.workspaceConflict
      && new URL(event.url).pathname === '/api/v1/workspaces/select'
      && (event.kind === 'response' && event.status === 409
        || event.kind === 'console' && /status of 409|conflict/i.test(event.message))) return true;
    if (phase.revisionRetry
      && new URL(event.url).pathname === "/api/v1/bootstrap"
      && (event.kind === "response" && event.status === 409
        || event.kind === "console" && /status of 409|conflict/i.test(event.message))) return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && ["/api/v1/workspace", "/api/v1/dashboard"].includes(new URL(event.url).pathname)) return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && ["REVISION_CHANGED_RETRY", "REVISION_CONFLICT"].includes(event.errorCode)
      && new URL(event.url).pathname === "/api/v1/bootstrap") return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/skills") return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && ["/api/v1/jobs", "/api/v1/routes"].includes(new URL(event.url).pathname)) return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/evals") return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/policy/reviews") return true;
    if (phase.workflowRevisionSettle
      && event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/sources") return true;
    if (event.kind === "response"
      && event.method === "POST"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && ["/api/v1/policy/proposals", "/api/v1/policy/decisions"].includes(new URL(event.url).pathname)) return true;
    if (phase.policyPreview
      && event.kind === "response"
      && event.method === "POST"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/policy/preview") return true;
    if (event.kind === "console"
      && /status of 409|conflict/i.test(event.message)
      && [
        "/api/v1/bootstrap", "/api/v1/workspace", "/api/v1/dashboard", "/api/v1/skills", "/api/v1/jobs", "/api/v1/routes", "/api/v1/evals", "/api/v1/state/revisions", "/api/v1/policy/reviews",
        "/api/v1/policy/proposals", "/api/v1/policy/decisions", "/api/v1/workspaces/select"
      ].includes(new URL(event.url).pathname)) return true;
    if (phase.workflowRevisionSettle
      && event.kind === "console"
      && /status of 409|conflict/i.test(event.message)
      && new URL(event.url).pathname === "/api/v1/sources") return true;
    if (phase.policyPreview
      && event.kind === "console"
      && /status of 409|conflict/i.test(event.message)
      && new URL(event.url).pathname === "/api/v1/policy/preview") return true;
    if ((phase.workflowRevisionSettle || phase.workspaceTransition)
      && ["/api/v1/bootstrap", "/api/v1/workspace", "/api/v1/dashboard"].includes(new URL(event.url).pathname)
      && (event.kind === "response" && event.status === 409
        || event.kind === "console" && /status of 409|conflict/i.test(event.message))) return true;
    if (event.kind === "response"
      && event.method === "GET"
      && event.status === 409
      && event.errorCode === "REVISION_CHANGED_RETRY"
      && new URL(event.url).pathname === "/api/v1/state/revisions") return true;
    if (phase.workspaceTransition
      && event.kind === "requestfailed"
      && event.method === "GET"
      && isNavigationAbort(event)
      && ["/api/v1/bootstrap", "/api/v1/workspace", "/api/v1/dashboard"].includes(new URL(event.url).pathname)) return true;
    if (event.kind === "requestfailed"
      && event.method === "GET"
      && isNavigationAbort(event)
      && ["/api/v1/bootstrap", "/api/v1/workspace", "/api/v1/dashboard", "/api/v1/skills"].includes(new URL(event.url).pathname)) return true;
    if (!phase.offline) return false;
    if (event.kind === "requestfailed" && event.url.includes("/api/v1/")) return true;
    return event.kind === "console" && /failed to load resource|net::err_|internet disconnected/i.test(event.message);
  });

  const initialStarted = Date.now();
  const response = await page.goto(dashboard.bootstrapUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  assert.equal(new URL(page.url()).searchParams.has("bootstrap"), false, "bootstrap token remained in browser URL");
  try {
    await heading(page, "Overview");
  } catch (error) {
    throw new Error(`${error.message}\nBrowser diagnostics:\n${formatDiagnostics([...diagnostics.unexpected, ...diagnostics.expected]) || "<none>"}`, { cause: error });
  }
  try {
    await page.locator("#connection-label").getByText("Connected", { exact: true }).waitFor();
  } catch (error) {
    await diagnostics.flush();
    const rendered = String(await page.locator("body").textContent()).replace(/\s+/g, " ").trim().slice(0, 2_000);
    throw new Error(`initial connector did not reach Connected; body=${JSON.stringify(rendered)} diagnostics=${formatDiagnostics([...diagnostics.unexpected, ...diagnostics.expected]) || "<none>"}`, { cause: error });
  }
  const initialReadyMs = Date.now() - initialStarted;
  metrics.coldStartupMs = initialReadyMs;
  assert.equal(page.url(), `${dashboard.origin}/app/${setup.workspaceId}/overview`, 'initialized bootstrap did not canonicalize to the active workspace URL');
  await assertOriginScopedSessionAuthorization(page, context, dashboard.origin);
  assert.equal(await page.locator("#workspace-button").textContent(), path.basename(workspace));
  assert.match(await page.locator("#revision-short").textContent(), /^r\d{13}/);
  assert.equal(await page.getByText("Retention off", { exact: true }).count(), 0);
  await assertUnsupportedDashboardActionsStayUnavailable(page);
  await assertVersionMismatchBlocked(page);

  if (modes.has("perf")) {
    assertBudget("cold authenticated startup", initialReadyMs, budgets.coldStartupMs);
    const warmStarted = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await heading(page, "Overview");
    await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
    metrics.warmStartupMs = Date.now() - warmStarted;
    assertBudget("warm authenticated startup", metrics.warmStartupMs, budgets.warmStartupMs);
    console.log(`perf: cold startup ${initialReadyMs} ms / ${budgets.coldStartupMs} ms; warm startup ${metrics.warmStartupMs} ms / ${budgets.warmStartupMs} ms`);
    console.log(`perf: warm ${WARM_STARTUP_OPTIMIZATION_TARGET_MS} ms optimization target ${metrics.warmStartupMs <= WARM_STARTUP_OPTIMIZATION_TARGET_MS ? "met" : "unmet"} (aspirational; not an enforced gate)`);
  }

  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "overview-ready"));

  if (modes.has("a11y")) await assertKeyboardBasics(page);
  await assertBootstrapIsOneTime(browser, dashboard.bootstrapUrl);

  if (modes.has("perf")) await beginTransitionMeasurement(page);
  await page.getByRole("link", { name: "Route Lab", exact: true }).click();
  await heading(page, "Route Lab");
  if (modes.has("perf")) {
    const transition = await finishTransitionMeasurement(page);
    metrics.transitionFeedbackMs = transition.feedbackMs;
    metrics.transitionCompleteMs = transition.completeMs;
    assertBudget("route transition feedback", transition.feedbackMs, budgets.transitionFeedbackMs);
    assertBudget("route transition completion", transition.completeMs, budgets.transitionCompleteMs);
    console.log(`perf: route transition feedback ${transition.feedbackMs.toFixed(2)} ms / ${budgets.transitionFeedbackMs} ms; complete ${transition.completeMs.toFixed(2)} ms / ${budgets.transitionCompleteMs} ms`);
  }
  assert.equal(await page.getByRole("link", { name: "Route Lab", exact: true }).getAttribute("aria-current"), "page");
  assert.match(page.url(), new RegExp(`/app/${setup.workspaceId}/route$`));
  const promptInput = page.getByLabel("What are you trying to do?");
  const securityPrompt = "Review the authentication middleware for authorization bypasses and secret leakage.";
  await promptInput.fill(securityPrompt);
  const firstRouteStarted = Date.now();
  const firstResponsePromise = page.waitForResponse(candidate => candidate.url().endsWith("/api/v1/routes/preview") && candidate.request().method() === "POST");
  const runRouteButton = page.getByRole("button", { name: "Run route", exact: true });
  if (modes.has("a11y")) {
    assert.equal(await promptInput.getAttribute("maxlength"), "32768");
    await promptInput.press("Tab");
    assert.equal(await runRouteButton.evaluate(element => element === document.activeElement), true, "Tab did not reach the route action");
    await page.keyboard.press("Enter");
  } else {
    await runRouteButton.click();
  }
  const firstResponse = await firstResponsePromise;
  assert.equal(firstResponse.status(), 200);
  const firstRaw = await firstResponse.text();
  assert.equal(firstRaw.includes(securityPrompt), false, "route response persisted or echoed the raw prompt");
  const firstEnvelope = JSON.parse(firstRaw);
  assert.equal(firstEnvelope.ok, true);
  assert.equal(firstEnvelope.data.promptStored, false);
  assert.equal(firstEnvelope.data.decision.recommendations.length, 1);
  assert.equal(firstEnvelope.data.decision.recommendations[0].skillId, setup.skillId);
  assert.equal(firstEnvelope.data.decision.recommendations[0].displayName, "security-review");
  await page.getByRole("heading", { name: "security-review", exact: true }).waitFor();
  if (modes.has("a11y")) {
    assert.equal(await page.locator(".feedback-bar").getAttribute("aria-label"), "Route feedback");
    assert.equal(await page.getByRole("button", { name: /Correct|Wrong|Missing|Unsafe/ }).count(), 4);
    console.log("a11y: form tab order, keyboard submission, feedback labels, and semantic controls passed");
  }
  const firstRouteReadyMs = Date.now() - firstRouteStarted;
  metrics.routeResultMs = firstRouteReadyMs;
  if (modes.has("perf")) {
    assertBudget("route result", firstRouteReadyMs, budgets.routeResultMs);
    console.log(`perf: route result ${firstRouteReadyMs} ms / ${budgets.routeResultMs} ms`);
  }
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "route-recommendation"));

  const feedbackResponsePromise = page.waitForResponse(candidate => /\/api\/v1\/routes\/[0-9a-f-]{36}\/feedback$/i.test(new URL(candidate.url()).pathname));
  await page.getByRole("button", { name: "Correct", exact: true }).click();
  const feedbackResponse = await feedbackResponsePromise;
  assert.equal(feedbackResponse.status(), 201);
  const feedbackEnvelope = await feedbackResponse.json();
  assert.equal(feedbackEnvelope.data.outcome, "correct");
  assert.equal(feedbackEnvelope.data.routeId, firstEnvelope.data.routeId);
  await page.getByText("Feedback recorded without the raw prompt.", { exact: true }).waitFor();

  const unrelatedPrompt = "Bake sourdough bread and plan a garden irrigation schedule.";
  await promptInput.fill(unrelatedPrompt);
  const secondResponsePromise = page.waitForResponse(candidate => candidate.url().endsWith("/api/v1/routes/preview") && candidate.request().method() === "POST");
  await page.getByRole("button", { name: "Run route", exact: true }).click();
  const secondResponse = await secondResponsePromise;
  assert.equal(secondResponse.status(), 200);
  const secondRaw = await secondResponse.text();
  assert.equal(secondRaw.includes(unrelatedPrompt), false, "abstained route response echoed the raw prompt");
  const secondEnvelope = JSON.parse(secondRaw);
  assert.equal(secondEnvelope.data.promptStored, false);
  assert.equal(secondEnvelope.data.decision.recommendations.length, 0);
  assert.notEqual(secondEnvelope.data.decisionDigest, firstEnvelope.data.decisionDigest);
  await page.getByText("Abstained safely", { exact: true }).waitFor();
  await assertRedactedPersistence(workspace, [securityPrompt, unrelatedPrompt], firstEnvelope.data.routeId);
  await assertTracePermalink(page, {
    origin: dashboard.origin,
    workspaceId: setup.workspaceId,
    routeId: secondEnvelope.data.routeId,
    forbidden: [securityPrompt, unrelatedPrompt, workspace],
    visualGate,
    visuals
  });

  await page.getByRole("link", { name: "Skills", exact: true }).click();
  await heading(page, "Skills");
  assert.match(page.url(), new RegExp(`/app/${setup.workspaceId}/skills$`));
  assert.equal(await page.locator("tbody tr").count(), setup.skillCount);
  if (modes.has("perf")) {
    const filter = await measureSkillFilter(page, "security-review");
    metrics.filter500Ms = filter.durationMs;
    assert.equal(filter.countText, `1 of ${setup.skillCount} shown`);
    assert.equal(filter.rows, 1);
    assert.equal(setup.skillCount, 500, "performance filter gate must use the real 500-skill corpus");
    assertBudget("500-skill filter", filter.durationMs, budgets.filter500Ms);
    console.log(`perf: 500-skill filter ${filter.durationMs.toFixed(3)} ms / ${budgets.filter500Ms} ms`);
  }
  await page.locator(".skill-row:visible").filter({ hasText: /^security-review$/ }).first().click();
  await page.getByText("Qualified ID", { exact: true }).waitFor();
  assert.equal((await page.locator("#skill-detail").textContent()).includes(workspace), false, "skill view exposed the workspace path");

  await page.goBack();
  await heading(page, "Route Lab");
  await page.goForward();
  await heading(page, "Skills");
  assert.match(new URL(page.url()).pathname, /\/skills$/);

  await page.getByRole("link", { name: "Policies", exact: true }).click();
  await heading(page, "Policies");
  assert.match(page.url(), new RegExp(`/app/${setup.workspaceId}/policies$`));
  await page.getByRole("heading", { name: "Review queue", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Apply reviewed policy", exact: true }).count(), 1);
  const policyView = await page.locator("#view-root").textContent();
  assert.match(policyView, /Uncovered\s*1\s*Missing exact policy/);
  assert.match(policyView, /security-review\s*Uncovered\s*Needs Review\s*Blocks policy readiness until accepted remediation/);
  phase.policyPreview = true;
  try { await exercisePolicyPreview(page, setup, { visualGate, visuals }); }
  finally {
    await diagnostics.flush();
    phase.policyPreview = false;
  }
  phase.workflowRevisionSettle = true;
  try { await exercisePolicyProposalHold(page, { skillId: setup.skillId, skillCount: setup.skillCount, visualGate, visuals }); }
  finally { phase.workflowRevisionSettle = false; }

  await page.goto(`${dashboard.origin}/app/${setup.workspaceId}/onboarding`, { waitUntil: "networkidle" });
  await heading(page, "Set up this local workspace");
  await assertCurationHandoff(page, { visualGate, visuals });
  const doctorRow = page.locator("ol.stack-list li").filter({ hasText: "Run structural doctor" });
  assert.equal(await doctorRow.count(), 1);
  const jobResponsePromise = page.waitForResponse(candidate => candidate.url().endsWith("/api/v1/jobs") && candidate.request().method() === "POST");
  await doctorRow.getByRole("button", { name: "Run", exact: true }).click();
  const jobResponse = await jobResponsePromise;
  assert.equal(jobResponse.status(), 202);
  const jobEnvelope = await jobResponse.json();
  assert.equal(jobEnvelope.data.job.type, "doctor");
  assert.equal(jobEnvelope.data.job.state, "queued");
  await waitForJob(page, jobEnvelope.data.job.jobId);
  phase.revisionSettle = true;
  try { revisionSettleConflicts = await waitForStableRevisionEtag(page); }
  finally { phase.revisionSettle = false; }
  await assertOnboardingProgressAfterDoctor(page);

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await heading(page, "Activity");
  await page.getByText("Succeeded", { exact: true }).waitFor();
  const activityText = await page.locator("#view-root").textContent();
  assert.match(activityText, /Maintenance jobs/i);
  assert.match(activityText, /Doctor/i);
  assert.match(activityText, /Recommended/i);
  assert.match(activityText, /Abstained/i);
  await assertFeedbackBacklog(page, { pendingRouteId: secondEnvelope.data.routeId, visualGate, visuals });
  const activityUrl = page.url();
  const deepLinkStarted = Date.now();
  await page.goto(activityUrl, { waitUntil: "domcontentloaded" });
  await heading(page, "Activity");
  await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
  const deepLinkReadyMs = Date.now() - deepLinkStarted;
  metrics.deepLinkMs = deepLinkReadyMs;
  assert.equal(page.url(), activityUrl);
  if (modes.has("perf")) {
    assertBudget("authenticated deep link", deepLinkReadyMs, budgets.deepLinkMs);
    console.log(`perf: authenticated deep link ${deepLinkReadyMs} ms / ${budgets.deepLinkMs} ms`);
  }
  await assertRevisionRetryRecovery(page, activityUrl, phase);

  await exerciseSettingsDiagnostics(page, {
    origin: dashboard.origin,
    workspaceId: setup.workspaceId,
    forbidden: [securityPrompt, unrelatedPrompt, workspace],
    visualGate,
    visuals
  });

  if (modes.has("visual")) await assertResponsiveLayout(page, dashboard.origin, setup.workspaceId, secondEnvelope.data.routeId);
  phase.workflowRevisionSettle = true;
  try {
    await exerciseEvalReviewImport(page, { origin: dashboard.origin, workspaceId: setup.workspaceId, workspace, visualGate, visuals });
    await exerciseSourceAdoptionAndDiff(page, { origin: dashboard.origin, workspaceId: setup.workspaceId, workspace, visualGate, visuals });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${dashboard.origin}/app/${setup.workspaceId}/overview`, { waitUntil: "networkidle" });
    await heading(page, "Overview");
    assert.equal(await page.locator(".metric").first().isVisible(), true);
  } finally {
    await diagnostics.flush();
    phase.workflowRevisionSettle = false;
  }

  await assertRevisionRetryIsBounded(page, phase);
  await assertOtherConflictIsNotRetried(page, phase);
  await page.route("**/api/v1/**", route => route.abort("internetdisconnected"));
  phase.offline = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await heading(page, "Overview");
  await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Disconnected");
  assert.equal(await page.locator("#connection-banner").isVisible(), true);
  assert.equal(await page.getByText("Skills", { exact: true }).last().isVisible(), true, "warm cached overview lost its metrics");
  await page.evaluate(workspaceId => {
    history.pushState({}, "", `/app/${workspaceId}/onboarding`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, setup.workspaceId);
  await page.locator(".job-action:visible").first().click();
  await page.getByText("Reconnect before starting a maintenance job.", { exact: true }).waitFor();
  assert.ok(diagnostics.expected.some(event => event.kind === "requestfailed" && event.url.includes("/api/v1/bootstrap")), "offline boot did not record its expected API request failure");
  await page.unroute("**/api/v1/**");
  await new Promise(resolve => setTimeout(resolve, 50));
  phase.offline = false;
  await reconnectAndWait(page, "Set up this local workspace");
  phase.workspaceTransition = true;
  try {
    await exerciseWorkspaceSwitch(page, {
      origin: dashboard.origin,
      originalWorkspace: workspace,
      originalWorkspaceId: setup.workspaceId,
      originalSkillId: setup.skillId,
      alternateWorkspace,
      alternateWorkspaceId: alternateSetup.workspaceId,
      alternateSkillId: alternateSetup.skillId,
      newWorkspaceCandidate,
      phase,
      diagnostics
    });
    await page.waitForLoadState("networkidle");
    await new Promise(resolve => setTimeout(resolve, 100));
    await diagnostics.flush();
  } finally { phase.workspaceTransition = false; }

  await diagnostics.flush();
  assert.equal(diagnostics.unexpected.length, 0, `unexpected browser diagnostics:\n${formatDiagnostics(diagnostics.unexpected)}`);
  const revisionRetryResponses = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/bootstrap");
  const offlineFailures = diagnostics.expected.filter(event => event.kind === "requestfailed" && new URL(event.url).pathname === "/api/v1/bootstrap" && !isNavigationAbort(event));
  const bootstrapAborts = diagnostics.expected.filter(event => event.kind === "requestfailed" && new URL(event.url).pathname === "/api/v1/bootstrap" && isNavigationAbort(event));
  const transitionAborts = diagnostics.expected.filter(event => event.kind === "requestfailed"
    && new URL(event.url).pathname === "/api/v1/skills"
    && isNavigationAbort(event));
  const workspaceTransitionAborts = diagnostics.expected.filter(event => event.kind === "requestfailed" && ["/api/v1/workspace", "/api/v1/dashboard"].includes(new URL(event.url).pathname));
  const workspaceConflicts = diagnostics.expected.filter(event => event.kind === 'response' && event.status === 409 && new URL(event.url).pathname === '/api/v1/workspaces/select');
  const workspaceUnknownOutcomes = diagnostics.expected.filter(event => event.kind === 'response' && event.status === 500 && new URL(event.url).pathname === '/api/v1/workspaces/select');
  const workflowRevisionConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && ["/api/v1/workspace", "/api/v1/dashboard"].includes(new URL(event.url).pathname));
  const policyMutationConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && ["/api/v1/policy/proposals", "/api/v1/policy/decisions"].includes(new URL(event.url).pathname));
  const revisionHistoryConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/state/revisions");
  const skillReadConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/skills");
  const activityReadConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && ["/api/v1/jobs", "/api/v1/routes"].includes(new URL(event.url).pathname));
  const evalReadConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/evals");
  const policyReviewConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/policy/reviews");
  const sourceReadConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/sources");
  const policyPreviewConflicts = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409 && new URL(event.url).pathname === "/api/v1/policy/preview");
  const retryChangeResponses = revisionRetryResponses.filter(event => event.errorCode === "REVISION_CHANGED_RETRY");
  const allExpected409Responses = diagnostics.expected.filter(event => event.kind === "response" && event.status === 409);
  const expected409Console = diagnostics.expected.filter(event => event.kind === "console" && /status of 409|conflict/i.test(event.message));
  assert.ok(retryChangeResponses.length >= 3 + revisionSettleConflicts && retryChangeResponses.length <= 5 + revisionSettleConflicts, `expected 3-${5} controlled retry-change bootstrap responses plus ${revisionSettleConflicts} during job settle, got ${retryChangeResponses.length}`);
  assert.equal(revisionRetryResponses.length, retryChangeResponses.length + 1, `bootstrap conflict responses did not contain exactly one non-retryable conflict: ${revisionRetryResponses.length}`);
  assert.equal(revisionRetryResponses.filter(event => event.errorCode === "REVISION_CONFLICT").length, 1, "non-retryable conflict coverage did not observe its controlled response");
  assert.ok(offlineFailures.length >= 1, "expected offline failures were not captured");
  assert.ok(bootstrapAborts.length <= 6, `too many controlled bootstrap navigation aborts: ${bootstrapAborts.length}`);
  const maxSkillAborts = Math.ceil(setup.skillCount / 100);
  assert.ok(transitionAborts.length <= maxSkillAborts, `too many route-transition request aborts: ${transitionAborts.length} (max ${maxSkillAborts} for ${setup.skillCount} skills); ${formatDiagnostics(transitionAborts)}`);
  // These seven explicit flows can each supersede at most one in-flight
  // workspace + dashboard read pair. The harness and UI observe the terminal
  // doctor job independently, so its one refresh pair is a separate race.
  const intentionalNavigationSupersessions = Object.freeze({
    activityDeepLink: 1,
    policyHold: 1,
    reviewedPolicyApply: 1,
    doctorPublication: 1,
    evalImport: 1,
    sourceAdoption: 1,
    workspaceSwitch: 1
  });
  const intentionalNavigationPairCount = Object.values(intentionalNavigationSupersessions).reduce((total, count) => total + count, 0);
  const intentionalNavigationReceipt = Object.entries(intentionalNavigationSupersessions).map(([category, count]) => `${category}=${count}`).join(", ");
  const workspaceTransitionAbortCap = intentionalNavigationPairCount * 2;
  assert.ok(workspaceTransitionAborts.length <= workspaceTransitionAbortCap, `too many guarded workspace-transition request aborts: ${workspaceTransitionAborts.length} > ${workspaceTransitionAbortCap} (${intentionalNavigationReceipt}); ${formatDiagnostics(workspaceTransitionAborts)}`);
  assert.equal(workspaceTransitionAborts.every(isNavigationAbort), true, "workspace transition allowlist contained a non-navigation failure");
  for (const pathname of ["/api/v1/workspace", "/api/v1/dashboard"]) {
    const aborts = workspaceTransitionAborts.filter(event => new URL(event.url).pathname === pathname);
    assert.ok(aborts.length <= intentionalNavigationPairCount, `too many guarded ${pathname} navigation aborts during workspace transition: ${aborts.length} > ${intentionalNavigationPairCount} (${intentionalNavigationReceipt})`);
  }
  assert.equal(workspaceConflicts.length, 2, `expected two controlled workspace conflict responses, got ${workspaceConflicts.length}`);
  assert.deepEqual(workspaceConflicts.map(event => event.errorCode).sort(), ["WORKSPACE_SWITCH_JOBS_ACTIVE", "WORKSPACE_VALIDATION_INVALID"]);
  assert.equal(workspaceUnknownOutcomes.length, 1, `expected one controlled outcome-unknown workspace response, got ${workspaceUnknownOutcomes.length}`);
  // Policy hold, reviewed policy apply, doctor publication, eval import, and
  // source adoption can each race one workspace + dashboard refresh pair.
  const revisionPublishingWorkflowCount = 5;
  assert.ok(workflowRevisionConflicts.length <= revisionPublishingWorkflowCount * 2, `too many controlled post-workflow revision conflicts: ${workflowRevisionConflicts.length}`);
  assert.equal(workflowRevisionConflicts.every(event => event.errorCode === "REVISION_CHANGED_RETRY"), true, "post-workflow conflict did not use the exact retryable revision-change code");
  for (const pathname of ["/api/v1/workspace", "/api/v1/dashboard"]) {
    const conflicts = workflowRevisionConflicts.filter(event => new URL(event.url).pathname === pathname);
    assert.ok(conflicts.length <= revisionPublishingWorkflowCount, `too many controlled post-workflow ${pathname} conflicts: ${conflicts.length} > ${revisionPublishingWorkflowCount}`);
  }
  assert.ok(policyMutationConflicts.length <= 2, `too many controlled policy mutation revision conflicts: ${policyMutationConflicts.length}`);
  assert.equal(policyMutationConflicts.every(event => event.method === "POST" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "policy mutation conflict did not use the exact retryable revision-change receipt");
  assert.ok(revisionHistoryConflicts.length <= 1, `too many controlled revision-history conflicts during workspace transition: ${revisionHistoryConflicts.length}`);
  assert.equal(revisionHistoryConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "revision-history conflict did not use the exact retryable revision-change receipt");
  assert.ok(skillReadConflicts.length <= 1, `too many controlled skill-read conflicts during workspace transition: ${skillReadConflicts.length}`);
  assert.equal(skillReadConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "skill-read conflict did not use the exact retryable revision-change receipt");
  for (const pathname of ["/api/v1/jobs", "/api/v1/routes"]) {
    const conflicts = activityReadConflicts.filter(event => new URL(event.url).pathname === pathname);
    assert.ok(conflicts.length <= 1, `too many controlled ${pathname} conflicts during workspace transition: ${conflicts.length}`);
  }
  assert.equal(activityReadConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "activity-read conflict did not use the exact retryable revision-change receipt");
  assert.ok(evalReadConflicts.length <= 1, `too many controlled eval-read conflicts: ${evalReadConflicts.length}`);
  assert.equal(evalReadConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "eval-read conflict did not use the exact retryable revision-change receipt");
  assert.ok(policyReviewConflicts.length <= 1, `too many controlled policy-review conflicts: ${policyReviewConflicts.length}`);
  assert.equal(policyReviewConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "policy-review conflict did not use the exact retryable revision-change receipt");
  const sourceReadOperationCount = 2;
  assert.ok(sourceReadConflicts.length <= sourceReadOperationCount, `too many controlled source-read conflicts: ${sourceReadConflicts.length} > ${sourceReadOperationCount}`);
  assert.equal(sourceReadConflicts.every(event => event.method === "GET" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "source-read conflict did not use the exact retryable revision-change receipt");
  assert.ok(policyPreviewConflicts.length <= 1, `too many controlled policy-preview conflicts: ${policyPreviewConflicts.length}`);
  assert.equal(policyPreviewConflicts.every(event => event.method === "POST" && event.errorCode === "REVISION_CHANGED_RETRY"), true, "policy-preview conflict did not use the exact retryable revision-change receipt");
  assert.equal(allExpected409Responses.length, revisionRetryResponses.length + workspaceConflicts.length + workflowRevisionConflicts.length + policyMutationConflicts.length + revisionHistoryConflicts.length + skillReadConflicts.length + activityReadConflicts.length + evalReadConflicts.length + policyReviewConflicts.length + sourceReadConflicts.length + policyPreviewConflicts.length, "an uncategorized expected 409 response was allowlisted");
  for (const pathname of new Set(expected409Console.map(event => new URL(event.url).pathname))) {
    const consoleCount = expected409Console.filter(event => new URL(event.url).pathname === pathname).length;
    const responseCount = allExpected409Responses.filter(event => new URL(event.url).pathname === pathname).length;
    assert.ok(consoleCount <= responseCount, `expected 409 console diagnostics for ${pathname} exceeded their exact response receipts: ${consoleCount} > ${responseCount}`);
  }
  console.log(`diagnostics: ${revisionRetryResponses.length} controlled bootstrap revision conflicts (${revisionSettleConflicts} during job settle), ${workflowRevisionConflicts.length} controlled post-workflow read conflict(s), ${policyMutationConflicts.length} controlled policy mutation conflict(s), ${policyPreviewConflicts.length} controlled policy-preview conflict(s), ${policyReviewConflicts.length} controlled policy-review conflict(s), ${sourceReadConflicts.length} controlled source-read conflict(s), ${revisionHistoryConflicts.length} controlled workspace-transition history conflict(s), ${skillReadConflicts.length} controlled workspace-transition skill conflict(s), ${activityReadConflicts.length} controlled workspace-transition activity conflict(s), ${evalReadConflicts.length} controlled eval-read conflict(s), ${workspaceConflicts.length} controlled workspace conflicts, ${workspaceUnknownOutcomes.length} controlled outcome-unknown workspace response, ${offlineFailures.length} expected offline failure(s), ${bootstrapAborts.length} bounded bootstrap abort(s), ${transitionAborts.length} bounded route-transition abort(s), ${workspaceTransitionAborts.length} guarded workspace-transition abort(s), 0 unexpected console/page/request failures`);
  await context.close();
}

async function exercisePolicyPreview(page, setup, { visualGate, visuals }) {
  const before = await readCurrentBootstrap(page);
  const expectedRevision = before.currentRevision?.revisionId;
  assert.ok(expectedRevision, "policy preview preflight did not expose a current revision");
  const responses = [];
  let responseWaiter;
  const captureResponse = response => {
    if (new URL(response.url()).pathname !== "/api/v1/policy/preview" || response.request().method() !== "POST") return;
    responses.push(response);
    responseWaiter?.();
  };
  const nextResponse = async index => {
    if (responses[index]) return responses[index];
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        responseWaiter = undefined;
        reject(new Error(`policy preview response ${index + 1} did not arrive within 15 seconds`));
      }, 15_000);
      responseWaiter = () => {
        clearTimeout(timeout);
        responseWaiter = undefined;
        resolve();
      };
    });
    return responses[index];
  };
  page.on("response", captureResponse);
  let response;
  try {
    await page.getByRole("button", { name: "Run policy dry-run", exact: true }).click();
    response = await nextResponse(0);
    if (response.status() === 409) {
      const conflict = await response.json();
      assert.equal(conflict?.ok, false);
      assert.equal(conflict?.error?.code, "REVISION_CHANGED_RETRY");
      assert.equal(conflict?.error?.retryable, true);
      response = await nextResponse(1);
    }
  } finally {
    page.off("response", captureResponse);
  }
  assert.equal(response.status(), 200, `policy preview failed: ${await response.text()}`);
  const envelope = await response.json();
  assert.equal(envelope.data.state, "previewed");
  assert.equal(envelope.data.currentPresent, true);
  assert.equal(envelope.data.currentSummary.skills, setup.skillCount);
  assert.equal(envelope.data.currentSummary.routeEligible, 1);
  assert.ok(Number.isSafeInteger(envelope.data.currentSummary.edges) && envelope.data.currentSummary.edges >= 0);
  assert.equal(envelope.data.projectedSummary.skills, setup.skillCount);
  for (const key of ["skills", "routeEligible", "edges"]) {
    assert.ok(Number.isSafeInteger(envelope.data.projectedSummary[key]) && envelope.data.projectedSummary[key] >= 0, `policy preview projected ${key} was not a bounded count`);
    assert.equal(envelope.data.delta[key], envelope.data.projectedSummary[key] - envelope.data.currentSummary[key], `policy preview ${key} delta was not calculated from current/projected state`);
  }
  assert.ok(Array.isArray(envelope.data.warnings));
  assert.equal(typeof envelope.data.routingApprovalEligible, "boolean");
  assert.equal(envelope.data.wouldPublish, false);
  assert.equal(envelope.data.revision.revisionId, expectedRevision);
  await page.getByRole("heading", { name: "Calculated impact", exact: true }).waitFor();
  const receipt = page.locator(".policy-preview-receipt");
  assert.match(await receipt.textContent(), /Would publish\s*No/);
  assert.match(await receipt.textContent(), new RegExp(`Routing approval eligible\\s*${envelope.data.routingApprovalEligible ? "Yes, after separate apply" : "No"}`));
  assert.equal(await page.getByRole("button", { name: "Apply reviewed policy", exact: true }).count(), 1);
  const after = await readCurrentBootstrap(page);
  assert.equal(after.currentRevision?.revisionId, expectedRevision, "policy dry-run published or advanced the workspace revision");
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "policy-dry-run"));
  console.log("policy: live revision-bound dry-run calculated impact without publishing; explicit apply remained separate");
}

async function exercisePolicyProposalHold(page, { skillId, skillCount, visualGate, visuals }) {
  const before = await readCurrentBootstrap(page);
  const expectedRevision = before.currentRevision?.revisionId;
  assert.ok(expectedRevision, "policy proposal preflight did not expose a current revision");
  const item = page.locator(".review-item").filter({ hasText: "security-review" });
  assert.equal(await item.count(), 1, "the exact uncovered security-review item was not rendered once");
  const form = item.locator(".policy-proposal");
  assert.equal(await form.getAttribute("data-action"), "set-skill-policy");
  assert.equal(await form.getAttribute("data-skill-id"), skillId);
  await form.getByLabel("Reviewed tier").selectOption("specialist");
  const rationale = "Reviewed the exact qualified security skill and held it for another operator pass.";
  await form.getByLabel("Review rationale").fill(rationale);

  const proposalRequestPromise = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/policy/proposals" && request.method() === "POST");
  const proposalResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/policy/proposals"
    && response.request().method() === "POST"
    && response.status() === 201);
  await form.getByRole("button", { name: "Review proposal", exact: true }).click();
  const [proposalRequest, proposalResponse] = await Promise.all([proposalRequestPromise, proposalResponsePromise]);
  assert.deepEqual(proposalRequest.postDataJSON(), {
    reviewId: await form.getAttribute("data-review-id"),
    action: "set-skill-policy",
    actor: "local-operator",
    reason: rationale,
    expectedRevision,
    skillId,
    tier: "specialist"
  });
  assert.equal(proposalResponse.status(), 201, `policy proposal failed: ${await proposalResponse.text()}`);
  const proposalRaw = await proposalResponse.text();
  assert.equal(proposalRaw.includes(rationale), false, "policy proposal receipt echoed the review rationale");
  const proposal = JSON.parse(proposalRaw).data;
  assert.equal(proposal.state, "proposed");
  assert.equal(proposal.action, "set-skill-policy");
  assert.equal(proposal.skillId, skillId);
  assert.equal(proposal.tier, "specialist");
  assert.equal(proposal.expectedRevision, expectedRevision);
  assert.equal(proposal.wouldPublish, false);
  assert.match(proposal.proposalDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(proposal.decisionOptions, ["accept", "hold", "reject"]);
  await page.getByRole("heading", { name: "Proposal ready for decision", exact: true }).waitFor();
  const proposalReceipt = item.locator(".policy-preview-receipt");
  assert.match(await proposalReceipt.textContent(), /Would publish now\s*No/);
  assert.equal((await proposalReceipt.textContent()).includes(rationale), false, "rendered proposal receipt exposed the rationale");
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "policy-proposal-ready"));

  const decisionRequestPromise = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/policy/decisions" && request.method() === "POST");
  const decisionResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/policy/decisions"
    && response.request().method() === "POST"
    && response.status() === 201);
  await proposalReceipt.getByRole("button", { name: "Hold", exact: true }).click();
  const [decisionRequest, decisionResponse] = await Promise.all([decisionRequestPromise, decisionResponsePromise]);
  assert.deepEqual(decisionRequest.postDataJSON(), {
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "hold",
    expectedRevision,
    confirmation: "review"
  });
  assert.equal(decisionResponse.status(), 201, `policy hold failed: ${await decisionResponse.text()}`);
  const decisionRaw = await decisionResponse.text();
  assert.equal(decisionRaw.includes(rationale), false, "policy hold receipt echoed the review rationale");
  const decision = JSON.parse(decisionRaw).data;
  assert.equal(decision.state, "recorded");
  assert.equal(decision.decision, "hold");
  assert.equal(decision.policyChanged, false);
  assert.equal(decision.routingApprovalRequired, true);
  assert.match(decision.decisionDigest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(decision.revision.revisionId, expectedRevision, "policy hold did not publish a new unapproved receipt revision");
  await page.locator("#toast-region").getByText("Held policy proposal recorded in a new revision.", { exact: true }).waitFor();

  await page.reload({ waitUntil: "networkidle" });
  await heading(page, "Policies");
  const after = await readCurrentBootstrap(page);
  assert.equal(after.currentRevision?.revisionId, decision.revision.revisionId, "policy hold revision did not become current");
  assert.equal(after.routingReady, false, "policy hold unexpectedly approved its own receipt revision for routing");
  const afterText = await page.locator("#view-root").textContent();
  assert.match(afterText, /Uncovered\s*1\s*Missing exact policy/);
  assert.match(afterText, /security-review\s*Uncovered\s*Needs Review\s*Blocks policy readiness until accepted remediation/);
  const applyRequestPromise = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/policy/apply"
    && request.method() === "POST");
  const applyResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/policy/apply"
    && response.request().method() === "POST"
    && response.status() === 201);
  await page.getByRole("button", { name: "Apply reviewed policy", exact: true }).click();
  const [applyRequest, applyResponse] = await Promise.all([applyRequestPromise, applyResponsePromise]);
  assert.deepEqual(applyRequest.postDataJSON(), { expectedRevision: decision.revision.revisionId, confirmation: "review" });
  assert.equal(applyResponse.status(), 201, `reviewed policy apply failed: ${await applyResponse.text()}`);
  const applied = (await applyResponse.json()).data;
  assert.equal(applied.applied, true);
  assert.equal(applied.routingApproved, true, "visible reviewed-policy apply did not advance routing approval");
  assert.equal(applied.effectiveSummary.routeEligible, skillCount - 1, "held uncovered policy item changed route eligibility outside its exact reviewed identity");
  assert.notEqual(applied.revision.revisionId, decision.revision.revisionId, "reviewed-policy apply did not publish a new revision");
  await page.locator("#toast-region").getByText("Reviewed policy applied and approved for routing.", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await heading(page, "Policies");
  const approved = await readCurrentBootstrap(page);
  assert.equal(approved.currentRevision?.revisionId, applied.revision.revisionId, "reviewed-policy apply revision did not become current");
  assert.equal(approved.routingReady, true, "reviewed-policy apply did not restore routing readiness");
  console.log("policy: exact revision-bound specialist proposal stayed redacted; hold remained unapproved until visible reviewed-policy apply");
}

async function assertFeedbackBacklog(page, { pendingRouteId, visualGate, visuals }) {
  const response = await authenticatedBrowserRevisionGet(page, "/api/v1/routes?limit=100");
  assert.equal(response.status, 200, `feedback backlog read failed: ${JSON.stringify(response.body)}`);
  const backlog = response.body.data.feedbackBacklog;
  assert.deepEqual(backlog, {
    reviewedRoutes: 1,
    pendingRoutes: 1,
    recordedFeedback: 1,
    outcomeCounts: { correct: 1, wrong: 0, missing: 0, unsafe: 0 },
    pendingRouteIds: [pendingRouteId]
  });
  const panel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Feedback backlog", exact: true }) });
  assert.equal(await panel.count(), 1);
  const text = String(await panel.textContent()).replace(/\s+/g, " ");
  assert.match(text, /Reviewed routes\s*1/);
  assert.match(text, /Pending routes\s*1/);
  assert.match(text, /Recorded outcomes\s*1/);
  assert.match(text, /Correct\s*1/);
  assert.match(text, /Awaiting operator feedback/);
  assert.equal(text.includes(pendingRouteId), true, "feedback backlog did not render the pending route ID");
  const reviewLink = panel.getByRole("link", { name: "Review trace", exact: true });
  assert.equal(await reviewLink.getAttribute("href"), `/app/${response.body.data.events[0].revision.workspaceId}/traces/${pendingRouteId}`);
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "activity-feedback-backlog"));
  console.log("activity: bounded feedback backlog showed one reviewed route and one prompt-free pending trace");
}

async function exerciseSettingsDiagnostics(page, { origin, workspaceId, forbidden, visualGate, visuals }) {
  const requests = [];
  const recordRequest = request => requests.push(request.url());
  page.on("request", recordRequest);
  let download;
  try {
    await page.goto(`${origin}/app/${workspaceId}/settings`, { waitUntil: "networkidle" });
    await heading(page, "Settings");
    await page.getByRole("heading", { name: "Diagnostics & updates", exact: true }).waitFor();
    const settingsText = String(await page.locator("#view-root").textContent()).replace(/\s+/g, " ");
    assert.match(settingsText, /Raw prompts and paths\s*Excluded/);
    assert.match(settingsText, /Update channel\s*Manual · no background network check/);
    const versionRow = page.locator("#view-root li").filter({ hasText: "Installed product version" });
    assert.equal(await versionRow.locator("small").textContent(), runtimeManifest.version, "Settings did not render the installed product version");
    if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "settings-diagnostics"));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export redacted diagnostics", exact: true }).click();
    download = await downloadPromise;
  } finally {
    page.off("request", recordRequest);
  }
  assert.match(download.suggestedFilename(), /^skillmap-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  assert.ok(stream, "diagnostics download stream was unavailable");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length > 0 && bytes.length <= 64 * 1024, `diagnostics export size was ${bytes.length} bytes`);
  const raw = bytes.toString("utf8");
  const diagnostics = JSON.parse(raw);
  assert.equal(diagnostics.kind, "skillmap.local-diagnostics");
  assert.equal(diagnostics.schemaVersion, 1);
  assert.equal(diagnostics.productVersion, runtimeManifest.version);
  assert.equal(diagnostics.connectionState, "connected");
  assert.equal(diagnostics.workspaceId, workspaceId);
  assert.deepEqual(diagnostics.privacy, { rawPromptPersistence: false, telemetry: false, cloudSync: false });
  assert.deepEqual(diagnostics.updateChannel, { mode: "manual", backgroundNetworkChecks: false });
  assert.match(diagnostics.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(Object.hasOwn(diagnostics, "roots"), false);
  assert.equal(Object.hasOwn(diagnostics, "prompts"), false);
  for (const value of forbidden) assert.equal(raw.includes(value), false, "diagnostics export contained private prompt or workspace text");
  assert.equal(requests.every(value => new URL(value).origin === origin), true, `Settings made a non-loopback request: ${requests.join(", ")}`);
  await page.locator("#toast-region").getByText("Redacted diagnostics exported.", { exact: true }).waitFor();
  console.log("settings: redacted <=64 KiB diagnostics export excluded prompts/paths and made no background network check");
}

async function assertCurationHandoff(page, { visualGate, visuals }) {
  const progress = await page.locator('progress').evaluate(element => ({ value: element.value, max: element.max }));
  assert.deepEqual(progress, { value: 3, max: 10 }, "onboarding inferred evidence that the fixture has not produced");
  await page.getByText("3 of 10 evidence gates observed", { exact: true }).waitFor();
  const curationRow = page.locator("ol.onboarding-steps li").filter({ hasText: "Review native-agent curation" });
  assert.equal(await curationRow.count(), 1);
  assert.match(await curationRow.textContent(), /Native-agent review remains outside browser authority/);
  assert.equal(await curationRow.locator(".job-action").count(), 0, "curation handoff was exposed as a browser-executed job");
  const handoff = page.locator("#curation-handoff");
  const expectedCommands = [
    "skillmap curate codex --prepare",
    "skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --dry-run",
    "skillmap curate codex --ingest .skillmap/proposals/policy.yml --rationale .skillmap/proposals/policy-rationale.md --model MODEL --confirm"
  ];
  assert.deepEqual((await handoff.locator("pre code").allTextContents()).map(value => value.trim()), expectedCommands);
  assert.equal(await handoff.locator(".job-action").count(), 0);
  assert.match(await page.locator("#view-root").textContent(), /browser will not execute an agent, ingest a proposal, or manufacture release evidence/i);
  const mutationRequests = [];
  const recordMutation = request => { if (request.method() !== "GET") mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`); };
  page.on("request", recordMutation);
  try {
    await page.getByRole("link", { name: "Review handoff", exact: true }).click();
    await handoff.scrollIntoViewIfNeeded();
    if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "onboarding-curation-handoff"));
    await page.getByRole("button", { name: "Copy prepare command", exact: true }).click();
    await page.locator("#toast-region").getByText(/Curation command copied|Clipboard access is unavailable/).waitFor();
  } finally {
    page.off("request", recordMutation);
  }
  assert.deepEqual(mutationRequests, [], `curation handoff unexpectedly mutated the connector: ${mutationRequests.join(", ")}`);
  assert.deepEqual((await handoff.locator("pre code").allTextContents()).map(value => value.trim()), expectedCommands, "copy action changed the reviewed command text");
  console.log("onboarding: 3/10 evidence-only progress and exact native-agent prepare/dry-run/confirm handoff passed without browser execution");
}

async function assertOnboardingProgressAfterDoctor(page) {
  await page.reload({ waitUntil: "networkidle" });
  await heading(page, "Set up this local workspace");
  const progress = await page.locator('progress').evaluate(element => ({ value: element.value, max: element.max }));
  assert.deepEqual(progress, { value: 4, max: 10 }, "successful doctor evidence did not advance exactly one onboarding gate");
  await page.getByText("4 of 10 evidence gates observed", { exact: true }).waitFor();
  const doctorRow = page.locator("ol.onboarding-steps li").filter({ hasText: "Run structural doctor" });
  assert.match(await doctorRow.textContent(), /recorded/i);
  assert.equal(await doctorRow.getByRole("button", { name: "Run", exact: true }).count(), 0);
  const curationRow = page.locator("ol.onboarding-steps li").filter({ hasText: "Review native-agent curation" });
  assert.match(await curationRow.textContent(), /outside browser authority/i);
  console.log("onboarding: completed doctor publication advanced progress from 3/10 to 4/10; later evidence remained incomplete");
}

async function exerciseEvalReviewImport(page, { origin, workspaceId, workspace, visualGate, visuals }) {
  await page.goto(`${origin}/app/${workspaceId}/evals`, { waitUntil: "networkidle" });
  await heading(page, "Evals");
  const prompt = "QA_EVAL_PROMPT_CANARY_7D3C inspect middleware for leaked credentials.";
  const suite = {
    version: 2,
    provenance: {
      labelAuthor: "SkillMap browser QA",
      sourceClass: "manual-reviewed",
      createdAt: "2026-07-10T12:00:00.000Z",
      reviewedAt: "2026-07-10T12:05:00.000Z",
      deduplicationResult: "passed",
      holdoutFrozen: true
    },
    baseline: { top1Rate: 0, top3Rate: 0, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 0 },
    evals: [{
      id: "browser-qa-case-1",
      prompt,
      expected: ["security-review"],
      avoid: [],
      primaryCaseType: "implicit-natural",
      membership: ""
    }]
  };
  const fixture = Buffer.from(`${JSON.stringify(suite)}\n`, "utf8");
  assert.ok(fixture.byteLength < 60 * 1024);
  await page.locator("#eval-suite-file").setInputFiles({ name: "reviewed-eval-suite.json", mimeType: "application/json", buffer: fixture });
  await page.getByRole("button", { name: "Open local review", exact: true }).click();
  await page.getByRole("heading", { name: "Legacy v2 migration review", exact: true }).waitFor();
  await page.getByText("Case 1 needs train or holdout membership.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Import legacy v2 candidate", exact: true }).isDisabled(), true, "invalid eval membership did not block import");
  await page.locator('[data-case-index="0"][data-field="membership"]').selectOption("holdout");
  const importButton = page.getByRole("button", { name: "Import legacy v2 candidate", exact: true });
  await importButton.waitFor();
  assert.equal(await importButton.isEnabled(), true, "reviewed valid eval suite did not become importable");
  const releaseMetric = page.locator(".eval-review-metric").filter({ hasText: "Release-counted" });
  assert.match((await releaseMetric.textContent()).replace(/\s+/g, " "), /Release-counted\s*1\s*minimum 150 · not met/);
  assert.equal((await page.locator("#eval-review-root").textContent()).includes(prompt), true, "selected eval prompt was not available in ephemeral review memory");
  await page.getByRole("heading", { name: "Legacy v2 migration review", exact: true }).scrollIntoViewIfNeeded();
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "eval-review-editor"));
  const before = await readCurrentBootstrap(page);
  await page.locator("#eval-review-confirm").check();
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/evals/import" && response.request().method() === "POST");
  const workspaceRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workspace" && response.request().method() === "GET" && response.status() === 200);
  const dashboardRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/dashboard" && response.request().method() === "GET" && response.status() === 200);
  await importButton.click();
  const response = await responsePromise;
  assert.equal(response.status(), 201, `eval import failed: ${await response.text()}`);
  const raw = await response.text();
  assert.equal(raw.includes(prompt), false, "eval import receipt echoed a private prompt");
  const envelope = JSON.parse(raw);
  assert.equal(envelope.data.imported, true);
  assert.equal(envelope.data.cases, 1);
  assert.equal(envelope.data.routingApprovalRequired, true);
  await Promise.all([workspaceRefresh, dashboardRefresh]);
  await page.getByText("1 legacy v2 cases were imported as an unapproved candidate revision. Private prompts and labels were cleared from this page. Migrate to eval-suite/v3 before making any release evidence claim.", { exact: true }).waitFor();
  assert.equal((await page.locator("body").textContent()).includes(prompt), false, "imported eval prompt remained rendered after explicit clearing");
  await assertBrowserStorageExcludes(page, [prompt]);
  const after = await readCurrentBootstrap(page);
  assert.notEqual(after.currentRevision?.revisionId, before.currentRevision?.revisionId, "eval import did not publish an unapproved revision");
  const persisted = JSON.parse(await readFile(path.join(workspace, ".skillmap", "real-evals.json"), "utf8"));
  assert.equal(persisted.evals[0].prompt, prompt, "explicit eval import did not persist the reviewed local suite");
  console.log("evals: in-memory validation blocked an incomplete case, reviewed edit enabled import, receipt stayed prompt-free, and page/storage cleared the prompt");
}

async function exerciseSourceAdoptionAndDiff(page, { origin, workspaceId, workspace, visualGate, visuals }) {
  await page.goto(`${origin}/app/${workspaceId}/sources`, { waitUntil: "networkidle" });
  await heading(page, "Sources");
  const form = page.locator(".source-adoption").first();
  await form.waitFor();
  const skillId = await form.getAttribute("data-skill-id");
  assert.match(skillId || "", /^sk_[A-Za-z0-9_-]{43}$/);
  const displayName = String(await form.evaluate(element => element.closest("article")?.querySelector("strong")?.textContent || "source")).trim();
  const repository = "owner/repository";
  const sourcePath = "skills/qa-adopted";
  const ref = "main";
  await form.locator('[name="sourceType"]').selectOption("github");
  await form.locator('[name="repository"]').fill(repository);
  await form.locator('[name="sourcePath"]').fill(sourcePath);
  await form.locator('[name="ref"]').fill(ref);
  await form.locator('[name="confirmAdoption"]').check();
  const before = await readCurrentBootstrap(page);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/sources/adoptions" && response.request().method() === "POST");
  const workspaceRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workspace" && response.request().method() === "GET" && response.status() === 200);
  const dashboardRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/dashboard" && response.request().method() === "GET" && response.status() === 200);
  await form.getByRole("button", { name: "Adopt source", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201, `source adoption failed: ${await response.text()}`);
  const raw = await response.text();
  assert.equal(raw.includes(repository), false, "source adoption receipt echoed repository coordinates");
  assert.equal(raw.includes(sourcePath), false, "source adoption receipt echoed a source path");
  assert.equal(raw.includes(workspace), false, "source adoption receipt exposed the workspace path");
  const envelope = JSON.parse(raw);
  assert.equal(envelope.data.state, "adopted");
  assert.equal(envelope.data.skillId, skillId);
  assert.equal(envelope.data.sourceType, "github");
  assert.equal(envelope.data.nextAction, "sources-check");
  assert.equal(envelope.data.routingApprovalRequired, true);
  await Promise.all([workspaceRefresh, dashboardRefresh]);
  await form.locator(".source-action-result").getByText(/source adopted/i).waitFor();
  const after = await readCurrentBootstrap(page);
  assert.notEqual(after.currentRevision?.revisionId, before.currentRevision?.revisionId, "source adoption did not publish an unapproved revision");
  const registry = JSON.parse(await readFile(path.join(workspace, ".skillmap", "sources.json"), "utf8"));
  const record = registry.records.find(item => item.skillId === skillId);
  assert.ok(record, "source adoption did not persist the qualified skill record");
  assert.deepEqual(record.source, { type: "github", repo: repository, path: sourcePath, ref });
  assert.equal(record.source.resolvedCommit, undefined, "deferred GitHub adoption resolved the source unexpectedly");
  await assert.rejects(readFile(path.join(workspace, ".skillmap", "source-status.json"), "utf8"), error => error?.code === "ENOENT", "source adoption silently ran Sources Check");

  let diffRequestBody;
  let sourceGetCalls = 0;
  let sourceRevisionConflicts = 0;
  const sourceGetHandler = async route => {
    sourceGetCalls += 1;
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const upstream = await route.fetch({ headers });
    const body = await upstream.json();
    if (upstream.status() === 409) {
      assert.equal(body?.ok, false);
      assert.equal(body?.error?.code, "REVISION_CHANGED_RETRY");
      assert.equal(body?.error?.retryable, true);
      sourceRevisionConflicts += 1;
      assert.ok(sourceRevisionConflicts <= 1, "source fixture exceeded the product's single revision-conflict retry");
      // Preserve the real transient response so the browser client exercises
      // its bounded revision retry before this fixture adapts the stable read.
      await route.fulfill({ response: upstream, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
      return;
    }
    assert.equal(upstream.status(), 200);
    body.data = {
      ...body.data,
      items: [{ skillId, displayName, contentRevision: record.contentRevision, sourceType: "github", checked: true, reviewable: true, state: "external-risky-update", risk: "high", upstreamCommit: "b".repeat(40) }]
    };
    await route.fulfill({ response: upstream, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
  };
  const diffCanary = "<script>globalThis.__skillmapDiffExecuted = true</script>";
  const diffHandler = async route => {
    diffRequestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: apiSuccessBody({
        skillId,
        state: "external-risky-update",
        risk: "high",
        upstreamCommit: "b".repeat(40),
        diff: {
          additions: 2,
          deletions: 1,
          changedLines: 2,
          truncated: false,
          lines: [
            { kind: "local", line: 7, text: diffCanary },
            { kind: "upstream", line: 7, text: 'Use "safe" & reviewed source content.' }
          ]
        },
        promptStored: false,
        persisted: false,
        revision: after.currentRevision
      }, after.currentRevision)
    });
  };
  await page.route("**/api/v1/sources", sourceGetHandler);
  await page.route("**/api/v1/sources/diff", diffHandler);
  try {
    await page.reload({ waitUntil: "networkidle" });
    await heading(page, "Sources");
    const diffButton = page.locator(".source-diff:visible").first();
    if (await diffButton.count() === 0) {
      const rendered = String(await page.locator("#view-root").textContent()).replace(/\s+/g, " ").trim().slice(0, 2400);
      throw new Error(`source diff fixture did not render an action; GET calls=${sourceGetCalls}, url=${page.url()}, view=${JSON.stringify(rendered)}`);
    }
    await diffButton.click();
    await page.getByRole("heading", { name: `Upstream diff · ${displayName}`, exact: true }).waitFor();
    assert.deepEqual(diffRequestBody, { skillId, expectedRevision: after.currentRevision.revisionId });
    const diffPanel = page.locator(".source-diff-panel");
    assert.match((await diffPanel.locator(".metric").filter({ hasText: "Additions" }).textContent()).replace(/\s+/g, " "), /Additions\s*2/);
    assert.match((await diffPanel.textContent()).replace(/\s+/g, " "), /Persisted\s*No/);
    assert.equal((await diffPanel.textContent()).includes(diffCanary), true, "escaped source line was not rendered as literal text");
    assert.equal(await diffPanel.locator("script").count(), 0, "source diff text created an executable script element");
    assert.equal(await page.evaluate(() => globalThis.__skillmapDiffExecuted), undefined, "source diff text executed in the page");
    await assertBrowserStorageExcludes(page, [diffCanary]);
    if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "source-upstream-diff"));
  } finally {
    await page.unroute("**/api/v1/sources/diff", diffHandler);
    await page.unroute("**/api/v1/sources", sourceGetHandler);
  }
  console.log("sources: real deferred GitHub adoption stayed unresolved/no-check; bounded escaped diff rendered memory-only without script execution or storage");
}

async function exerciseWorkspaceSwitch(page, options) {
  const {
    origin,
    originalWorkspace,
    originalWorkspaceId,
    originalSkillId,
    alternateWorkspace,
    alternateWorkspaceId,
    alternateSkillId,
    newWorkspaceCandidate,
    phase,
    diagnostics
  } = options;

  await page.goto(`${origin}/app/${originalWorkspaceId}/overview`, { waitUntil: "networkidle" });
  await heading(page, "Overview");
  const switcher = page.getByRole("button", { name: "Switch workspace", exact: true });
  assert.equal(await switcher.isEnabled(), true, "foreground workspace control remained disabled");
  await switcher.click();
  await heading(page, "Workspaces");
  assert.equal(page.url(), `${origin}/app/workspaces`);
  await page.reload({ waitUntil: "networkidle" });
  await heading(page, "Workspaces");
  assert.equal(page.url(), `${origin}/app/workspaces`, "workspace deep link did not survive reload");

  await page.getByRole("radio", { name: /Create new/ }).check();
  const createAcknowledgment = page.getByLabel("I intend to create this new local directory.", { exact: true });
  assert.equal(await createAcknowledgment.isVisible(), true, "create-new intent confirmation was not exposed");
  await createAcknowledgment.check();
  await page.getByLabel("Local directory", { exact: true }).fill(newWorkspaceCandidate);
  const createValidationRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/workspaces/validate" && request.method() === "POST");
  const createValidationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workspaces/validate" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Validate directory", exact: true }).click();
  const [createRequest, createResponse] = await Promise.all([createValidationRequest, createValidationResponse]);
  assert.deepEqual(createRequest.postDataJSON(), { candidate: newWorkspaceCandidate, mode: "create-new" });
  assert.ok([200, 201].includes(createResponse.status()), `create-new validation returned ${createResponse.status()}`);
  const createRaw = await createResponse.text();
  assert.equal(createRaw.includes(newWorkspaceCandidate), false, "create-new validation receipt echoed the directory path");
  await page.getByRole("button", { name: "Create and use workspace", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Local directory", { exact: true }).count(), 0, "validated create path form remained mounted during confirmation");
  assert.equal((await page.locator("#workspace-validation").textContent()).includes(newWorkspaceCandidate), false, "rendered create receipt exposed the path");
  await assertBrowserStorageExcludes(page, [newWorkspaceCandidate]);
  await assert.rejects(stat(newWorkspaceCandidate), error => error?.code === "ENOENT", "validation created the directory before confirmation");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("radio", { name: /Select existing/ }).check();
  await page.getByLabel("Local directory", { exact: true }).fill(alternateWorkspace);
  const selectValidationRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/workspaces/validate" && request.method() === "POST");
  const selectValidationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workspaces/validate" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Validate directory", exact: true }).click();
  const [validationRequest, validationResponse] = await Promise.all([selectValidationRequest, selectValidationResponse]);
  assert.deepEqual(validationRequest.postDataJSON(), { candidate: alternateWorkspace, mode: "select-existing" });
  assert.ok([200, 201].includes(validationResponse.status()), `existing-workspace validation returned ${validationResponse.status()}`);
  const validationRaw = await validationResponse.text();
  assert.equal(validationRaw.includes(alternateWorkspace), false, "existing-workspace validation receipt echoed the directory path");
  const confirm = page.getByRole("button", { name: "Use this workspace", exact: true });
  await confirm.waitFor();
  assert.equal(await page.getByLabel("Local directory", { exact: true }).count(), 0, "validated existing path form remained mounted during confirmation");
  assert.equal((await page.locator("#workspace-validation").textContent()).includes(alternateWorkspace), false, "rendered selection receipt exposed the path");
  await page.evaluate(() => {
    sessionStorage.setItem("skillmap:stale-probe", "old-client-cache");
    localStorage.setItem("skillmap:stale-probe", "old-client-cache");
  });

  await assertWorkspaceConflictGuidance(page, confirm, phase);

  await page.getByLabel('Local directory', { exact: true }).fill(alternateWorkspace);
  const retryValidationRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/workspaces/validate' && request.method() === 'POST');
  const retryValidationResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/workspaces/validate' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate directory', exact: true }).click();
  const [retryRequest, retryResponse] = await Promise.all([retryValidationRequest, retryValidationResponse]);
  assert.deepEqual(retryRequest.postDataJSON(), { candidate: alternateWorkspace, mode: 'select-existing' });
  assert.equal(retryResponse.status(), 200);
  assert.equal((await retryResponse.text()).includes(alternateWorkspace), false, 'retry validation receipt echoed the directory path');
  await confirm.waitFor();

  const { selectedRequest, selectedResponse, committedResponse, followUpResponses } = await selectWithLostCommitResponse(page, confirm, phase);
  const selectedBody = selectedRequest.postDataJSON();
  assert.deepEqual(Object.keys(selectedBody).sort(), ["confirm", "validationId"]);
  assert.equal(selectedBody.confirm, true);
  assert.equal(typeof selectedBody.validationId, "string");
  assert.equal(selectedBody.validationId.length > 0, true);
  assert.equal(JSON.stringify(selectedBody).includes(alternateWorkspace), false, "selection request reused the directory path instead of the opaque validation ID");
  assert.equal(committedResponse.status, 201, `backend workspace selection returned ${committedResponse.status} before the simulated response loss`);
  assert.equal(committedResponse.body.includes(alternateWorkspace), false, 'committed backend receipt echoed the directory path');
  assert.equal(selectedResponse.status(), 500, 'the browser did not exercise the outcome-unknown selection branch');
  const selectionRaw = await selectedResponse.text();
  assert.equal(selectionRaw.includes(alternateWorkspace), false, "workspace selection receipt echoed the directory path");
  for (const pathname of ["/api/v1/workspace", "/api/v1/dashboard"]) {
    assert.ok(followUpResponses.some(response => response.pathname === pathname && response.status === 200), `${pathname} did not complete after outcome-unknown reconciliation`);
  }
  for (const response of followUpResponses) {
    assert.ok(response.status === 200 || response.status === 409 && response.errorCode === "REVISION_CHANGED_RETRY", `unexpected post-selection ${response.pathname} response: ${response.status} ${response.body}`);
  }
  console.log(`workspaces: outcome-unknown reconciliation follow-up ${followUpResponses.map(response => `${response.pathname}=${response.status}`).join(", ")}`);
  try {
    await heading(page, "Overview");
  } catch (error) {
    throw new Error(`${error.message}; follow-up=${JSON.stringify(followUpResponses)}; first-unexpected=${JSON.stringify(diagnostics.unexpected[0] || null)}`, { cause: error });
  }
  await page.waitForFunction(expected => document.querySelector("#workspace-button")?.textContent === expected, alternateWorkspaceLabel);
  assert.match(page.url(), new RegExp(`/app/${alternateWorkspaceId}/overview$`), "selected workspace did not own the resumed URL");

  await page.goBack();
  await page.locator("h1").waitFor();
  await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
  assert.ok(["Overview", "Workspaces"].includes(await page.locator("h1").textContent()), "back navigation left the local app route set");
  assert.equal(page.url().includes(originalWorkspaceId), false, "back navigation restored the stale workspace ID");
  await page.goForward();
  await page.locator("h1").waitFor();
  await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
  assert.ok(["Overview", "Workspaces"].includes(await page.locator("h1").textContent()), "forward navigation left the local app route set");
  assert.equal(page.url().includes(originalWorkspaceId), false, "forward navigation restored the stale workspace ID");

  const storage = await browserStorage(page);
  assert.equal(storage.includes("old-client-cache"), false, "workspace switch retained a stale browser cache marker");
  assert.equal(storage.includes(originalWorkspaceId), false, "workspace switch retained the prior workspace cache");
  for (const candidate of [originalWorkspace, alternateWorkspace, newWorkspaceCandidate]) {
    assert.equal(storage.includes(candidate), false, "browser storage retained a workspace directory path");
  }
  const rendered = await page.locator("body").textContent();
  for (const candidate of [originalWorkspace, alternateWorkspace, newWorkspaceCandidate]) {
    assert.equal(rendered.includes(candidate), false, "post-switch UI rendered a workspace directory path");
  }
  assert.equal(rendered.includes('secret-workspace-label-canary'), false, 'post-switch UI rendered a secret-bearing workspace basename');
  await assertWorkspaceEventPrivacy([originalWorkspace, alternateWorkspace], [originalWorkspace, alternateWorkspace, newWorkspaceCandidate]);

  await page.goto(`${origin}/app/${originalWorkspaceId}/skills`, { waitUntil: "networkidle" });
  await heading(page, "Skills");
  assert.equal(page.url(), `${origin}/app/${alternateWorkspaceId}/skills`, "a stale workspace deep link rendered under the wrong workspace ID");
  const skillsText = await page.locator("tbody").textContent();
  assert.equal(skillsText.includes(alternateSkillId), true, "selected workspace did not replace the cached skill response");
  assert.equal(skillsText.includes(originalSkillId), false, "prior workspace skill response survived the switch");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await heading(page, "Overview");
  const overviewUrl = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await heading(page, "Overview");
  assert.equal(page.url(), overviewUrl, "selected workspace deep link did not resume after reload");

  await page.getByRole("button", { name: "Switch workspace", exact: true }).click();
  await heading(page, "Workspaces");
  await page.goBack();
  await heading(page, "Overview");
  await page.goForward();
  await heading(page, "Workspaces");
  console.log("workspaces: URL-owned deep link, explicit create validation, opaque existing selection, cache reset, and path privacy passed");
}

async function assertWorkspaceConflictGuidance(page, confirm, phase) {
  const scenarios = [
    {
      code: 'WORKSPACE_SWITCH_JOBS_ACTIVE',
      message: 'A workspace has a queued or running job. Finish or cancel it before switching.',
      expected: 'A workspace has a queued or running job. Finish or cancel it before switching.',
      tokenConsumed: false
    },
    {
      code: 'WORKSPACE_VALIDATION_INVALID',
      message: 'The workspace validation expired. Validate the directory again.',
      expected: 'Workspace validation changed or expired. Validate the directory again.',
      tokenConsumed: true
    }
  ];
  for (const scenario of scenarios) {
    const handler = route => route.fulfill({
      status: 409,
      contentType: 'application/json; charset=utf-8',
      body: apiErrorBody(scenario.code, scenario.message, true)
    });
    phase.workspaceConflict = true;
    await page.route('**/api/v1/workspaces/select', handler);
    try {
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/workspaces/select' && response.status() === 409);
      await confirm.click();
      const conflictResponse = await responsePromise;
      try { await page.getByText(scenario.expected, { exact: true }).waitFor(); }
      catch (error) {
        const toast = String(await page.locator('#toast-region').textContent()).replace(/\s+/g, ' ').trim();
        throw new Error(`${scenario.code} returned ${conflictResponse.status()} but expected guidance did not render; response=${await conflictResponse.text()} toast=${JSON.stringify(toast)}`, { cause: error });
      }
      if (scenario.tokenConsumed) {
        await page.getByLabel('Local directory', { exact: true }).waitFor();
        assert.equal(await confirm.count(), 0, `${scenario.code} left an unusable confirmation action mounted`);
      } else {
        assert.equal(await confirm.isEnabled(), true, `${scenario.code} did not preserve the retryable confirmation action`);
      }
    } finally {
      await page.unroute('**/api/v1/workspaces/select', handler);
      await new Promise(resolve => setTimeout(resolve, 100));
      phase.workspaceConflict = false;
    }
  }
}

async function selectWithLostCommitResponse(page, confirm, phase) {
  let committedResponse;
  const followUpReads = [];
  const captureFollowUp = response => {
    const pathname = new URL(response.url()).pathname;
    if (!["/api/v1/workspace", "/api/v1/dashboard"].includes(pathname) || response.request().method() !== "GET") return;
    followUpReads.push(response.text().then(body => {
      let errorCode = null;
      try { errorCode = JSON.parse(body)?.error?.code ?? null; } catch {}
      return { pathname, status: response.status(), errorCode, body: body.replace(/\s+/g, " ").slice(0, 1000) };
    }));
  };
  const handler = async route => {
    const committed = await route.fetch();
    committedResponse = { status: committed.status(), body: await committed.text() };
    await route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: apiErrorBody('INTERNAL_ERROR', 'The local connector could not complete the request.', false)
    });
  };
  phase.workspaceOutcomeUnknown = true;
  page.on("response", captureFollowUp);
  await page.route('**/api/v1/workspaces/select', handler);
  try {
    const selectionRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/workspaces/select' && request.method() === 'POST');
    const selectionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/workspaces/select' && response.request().method() === 'POST' && response.status() === 500);
    const bootstrapResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/bootstrap' && response.request().method() === 'GET' && response.status() === 200);
    const reconciledReads = Promise.all(['/api/v1/workspace', '/api/v1/dashboard'].map(pathname => page.waitForResponse(response =>
      new URL(response.url()).pathname === pathname
      && response.request().method() === 'GET'
      && response.status() === 200
    )));
    await confirm.click();
    const [selectedRequest, selectedResponse] = await Promise.all([selectionRequest, selectionResponse]);
    await Promise.all([bootstrapResponse, reconciledReads]);
    assert.ok(committedResponse, 'the simulated response loss did not reach the real backend selection endpoint');
    return { selectedRequest, selectedResponse, committedResponse, followUpResponses: await Promise.all(followUpReads) };
  } finally {
    page.off("response", captureFollowUp);
    await page.unroute('**/api/v1/workspaces/select', handler);
    await new Promise(resolve => setTimeout(resolve, 100));
    phase.workspaceOutcomeUnknown = false;
  }
}

async function browserStorage(page) {
  return page.evaluate(() => JSON.stringify({
    session: Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index), sessionStorage.getItem(sessionStorage.key(index))]),
    local: Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))]),
    history: history.state
  }));
}

async function assertBrowserStorageExcludes(page, excluded) {
  const storage = await browserStorage(page);
  for (const value of excluded) assert.equal(storage.includes(value), false, "browser storage retained an entered directory path");
}

async function assertWorkspaceEventPrivacy(workspaces, excluded) {
  let corpus = "";
  for (const workspace of workspaces) {
    const files = await jsonFiles(path.join(workspace, ".skillmap", "events"));
    corpus += (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n");
  }
  for (const value of excluded) assert.equal(corpus.includes(value), false, "workspace event history retained a directory path");
}

async function assertBootstrapIsOneTime(browserType, bootstrapUrl) {
  const context = await browserType.newContext(qaContextOptions({ width: 1024, height: 768 }));
  const page = await context.newPage();
  const diagnostics = captureDiagnostics(page, "bootstrap replay", event => event.url === bootstrapUrl && (
    event.kind === "response" && event.status === 401
    || event.kind === "console" && /status of 401|unauthorized/i.test(event.message)
  ));
  const response = await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 401);
  assert.match(response?.headers()["content-type"] || "", /^text\/html\b/i, "top-level bootstrap replay did not return bounded HTML");
  await page.getByRole("heading", { name: "Connector link unavailable", exact: true, level: 1 }).waitFor();
  const replayBody = await page.locator("body").textContent();
  assert.match(replayBody, /BOOTSTRAP_INVALID/);
  assert.match(replayBody, /invalid or expired/i);
  assert.equal(diagnostics.unexpected.length, 0, `unexpected bootstrap-replay diagnostics:\n${formatDiagnostics(diagnostics.unexpected)}`);
  assert.ok(diagnostics.expected.some(event => event.kind === "response" && event.status === 401), "bootstrap replay did not capture its expected 401 response");
  await context.close();
  console.log("security: one-time bootstrap replay rejected with expected 401");
}

async function assertOriginScopedSessionAuthorization(page, context, origin) {
  const snapshot = await page.evaluate(() => ({
    session: sessionStorage.getItem('skillmap.connector-auth.v1'),
    local: localStorage.getItem('skillmap.connector-auth.v1'),
    body: document.body.textContent || '',
    hash: location.hash,
    search: location.search
  }));
  assert.equal(snapshot.hash, '', 'connector authorization fragment remained in the browser URL');
  assert.equal(snapshot.search.includes('bootstrap='), false, 'one-time bootstrap query remained in the browser URL');
  assert.equal(snapshot.local, null, 'connector authorization entered persistent localStorage');
  assert.ok(snapshot.session, 'connector authorization was not retained for same-tab reloads');
  const auth = JSON.parse(snapshot.session);
  assert.deepEqual(Object.keys(auth).sort(), ['capability', 'csrf']);
  assert.match(auth.capability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(auth.csrf, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(snapshot.body.includes(auth.capability), false, 'connector capability leaked into rendered text');
  assert.equal(snapshot.body.includes(auth.csrf), false, 'connector CSRF proof leaked into rendered text');
  const connectorCookies = await context.cookies(origin);
  assert.equal(connectorCookies.some(cookie => /^skillmap_(?:cap|csrf)_\d{1,5}$/.test(cookie.name)), false, 'connector emitted a host-scoped SkillMap authorization cookie');

  let observedHeaders;
  const probe = createServer((request, response) => {
    if (request.url === '/probe') observedHeaders = request.headers;
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Loopback isolation probe</title>');
  });
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { probe.off('error', reject); resolve(); });
  });
  try {
    const address = probe.address();
    assert.ok(address && typeof address !== 'string');
    const target = `http://127.0.0.1:${address.port}/probe`;
    const popupPromise = context.waitForEvent('page');
    await page.evaluate(url => {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = 'probe';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }, target);
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.close();
  } finally {
    await new Promise(resolve => probe.close(resolve));
  }
  assert.ok(observedHeaders, 'second loopback port did not receive the browser navigation probe');
  assert.doesNotMatch(String(observedHeaders.cookie || ''), /(?:^|;\s*)skillmap_(?:cap|csrf)_\d{1,5}=/, 'another loopback port received SkillMap authorization cookies');
  assert.equal(observedHeaders.referer, undefined, 'connector page leaked its URL through a navigation referrer');
  console.log('security: connector proofs stayed in origin-scoped session storage with no cross-port cookies or referrer');
}

async function assertUnsupportedDashboardActionsStayUnavailable(page) {
  const actions = ['skillmap apply-policy', 'skillmap future-command --unsafe'];
  const handler = async route => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data.readiness = { ...(envelope.data.readiness || {}), nextActions: actions };
    await route.fulfill({ response, json: envelope });
  };
  await page.route('**/api/v1/dashboard', handler);
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await heading(page, 'Overview');
    for (const action of actions) {
      await page.getByText(`${action} · CLI`, { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: action, exact: true }).count(), 0, `${action} was exposed as a generic job`);
    }
  } finally {
    await page.unroute('**/api/v1/dashboard', handler);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await heading(page, 'Overview');
}

async function assertVersionMismatchBlocked(page) {
  const connectorAuth = await page.evaluate(() => sessionStorage.getItem('skillmap.connector-auth.v1'));
  assert.ok(connectorAuth, 'authenticated browser session was unavailable before compatibility probe');
  const handler = async route => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.data = {
      ...envelope.data,
      connectorCompatibility: {
        ...envelope.data.connectorCompatibility,
        localAppAssetVersion: 'v2'
      }
    };
    await route.fulfill({ response, json: envelope });
  };
  await page.route('**/api/v1/bootstrap', handler);
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await heading(page, 'Local app update required');
    const blocker = page.locator('#compatibility-blocked');
    assert.equal(await blocker.getAttribute('data-error-code'), 'LOCAL_APP_VERSION_MISMATCH');
    assert.equal(await page.locator('#connection-label').textContent(), 'Update required');
    assert.equal(await blocker.getByRole('button').count(), 0, 'compatibility block exposed an unusable retry control after authorization was cleared');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('skillmap.connector-auth.v1')), null, 'compatibility mismatch retained connector authorization');
    assert.equal(await page.locator('#view-root .metrics, #view-root .job-action, #view-root form').count(), 0, 'version mismatch exposed cached data or mutation controls');
  } finally {
    await page.unroute('**/api/v1/bootstrap', handler);
  }
  // Restore the captured proof only inside this test harness so the remaining
  // acceptance workflow can continue. The product instructs real operators to
  // restart the connector and open its newly printed one-time URL.
  await page.evaluate(value => sessionStorage.setItem('skillmap.connector-auth.v1', value), connectorAuth);
  await page.reload({ waitUntil: 'networkidle' });
  await heading(page, 'Overview');
  await page.waitForFunction(() => document.querySelector('#connection-dot')?.classList.contains('online'));
  console.log('compatibility: asset/API version mismatch cleared authorization and blocked cached data');
}

async function assertRevisionRetryRecovery(page, targetUrl, phase) {
  let attempts = 0;
  const handler = async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json; charset=utf-8",
        body: apiErrorBody("REVISION_CHANGED_RETRY", "The workspace changed while this view was being composed.", true)
      });
      return;
    }
    await route.continue();
  };
  phase.revisionRetry = true;
  await page.route("**/api/v1/bootstrap", handler);
  try {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await heading(page, "Activity");
    await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
    assert.equal(attempts, 2, `one retryable revision conflict should produce exactly two bootstrap attempts, got ${attempts}`);
  } finally {
    await page.unroute("**/api/v1/bootstrap", handler);
    await new Promise(resolve => setTimeout(resolve, 100));
    phase.revisionRetry = false;
  }
  console.log("resilience: one retryable revision conflict recovered on exactly one retry");
}

async function assertRevisionRetryIsBounded(page, phase) {
  let attempts = 0;
  const handler = async route => {
    attempts += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json; charset=utf-8",
      body: apiErrorBody("REVISION_CHANGED_RETRY", "The workspace is still changing.", true)
    });
  };
  phase.revisionRetry = true;
  await page.route("**/api/v1/bootstrap", handler);
  try {
    await page.reload({ waitUntil: "networkidle" });
    await heading(page, "Overview");
    await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Disconnected");
    assert.equal(attempts, 2, `persistent revision conflicts must stop after the one retry, got ${attempts} attempts`);
    assert.equal(await page.locator("#connection-banner").isVisible(), true);
  } finally {
    await page.unroute("**/api/v1/bootstrap", handler);
    await new Promise(resolve => setTimeout(resolve, 100));
    phase.revisionRetry = false;
  }
  await reconnectAndWait(page, "Overview");
  console.log("resilience: persistent revision conflicts stopped after exactly one retry and manual retry reconnected");
}

async function assertOtherConflictIsNotRetried(page, phase) {
  let attempts = 0;
  const handler = async route => {
    attempts += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json; charset=utf-8",
      body: apiErrorBody("REVISION_CONFLICT", "A mutation expected a different revision.", true)
    });
  };
  phase.revisionRetry = true;
  await page.route("**/api/v1/bootstrap", handler);
  try {
    await page.reload({ waitUntil: "networkidle" });
    await heading(page, "Overview");
    await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Disconnected");
    assert.equal(attempts, 1, `a different retryable 409 code must not be retried, got ${attempts} attempts`);
  } finally {
    await page.unroute("**/api/v1/bootstrap", handler);
    await new Promise(resolve => setTimeout(resolve, 100));
    phase.revisionRetry = false;
  }
  await reconnectAndWait(page, "Overview");
  console.log("resilience: a different retryable 409 code was not retried");
}

async function reconnectAndWait(page, headingName) {
  const workspaceResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workspace" && response.status() === 200);
  const dashboardResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/dashboard" && response.status() === 200);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await Promise.all([workspaceResponse, dashboardResponse]);
  await page.waitForFunction(() => document.querySelector("#connection-dot")?.classList.contains("online"));
  await heading(page, headingName);
}

async function assertKeyboardBasics(page) {
  const firstFocusable = await page.evaluate(() => [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].find(element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  })?.className || 'none');
  assert.match(String(firstFocusable), /skip-link/, "skip link was not the first focusable control in document order");
  await page.locator(".skip-link").focus();
  assert.equal(await page.locator(".skip-link").evaluate(element => element === document.activeElement), true, "skip link could not receive keyboard focus");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#main").evaluate(element => element === document.activeElement), true, "skip link did not focus main content");
  const routeLink = page.getByRole("link", { name: "Route Lab", exact: true });
  await routeLink.focus();
  await page.keyboard.press("Enter");
  await heading(page, "Route Lab");
  assert.equal(await page.getByLabel("What are you trying to do?").count(), 1, "Route Lab prompt is not labeled");
  await page.goBack();
  await heading(page, "Overview");
  console.log("a11y: skip link, main focus, labeled prompt, and keyboard navigation passed");
}

async function assertResponsiveLayout(page, origin, workspaceId, traceId) {
  const headings = {
    overview: "Overview",
    route: "Route Lab",
    skills: "Skills",
    policies: "Policies",
    evals: "Evals",
    sources: "Sources",
    trust: "Trust & privacy",
    integrations: "Integrations",
    activity: "Activity",
    settings: "Settings",
    onboarding: "Set up this local workspace",
    workspaces: "Workspaces",
    "trace-detail": "Activity"
  };
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 1024, height: 768 }
  ]) {
    await page.setViewportSize(viewport);
    for (const route of ["overview", "route", "skills", "policies", "evals", "sources", "trust", "integrations", "activity", "settings", "onboarding", "workspaces", "trace-detail"]) {
      const target = route === "workspaces"
        ? `${origin}/app/workspaces`
        : route === "trace-detail"
          ? `${origin}/app/${workspaceId}/traces/${traceId}`
          : `${origin}/app/${workspaceId}/${route}`;
      await page.goto(target, { waitUntil: "networkidle" });
      await heading(page, headings[route]);
      await assertNoHorizontalOverflow(page, `${route} ${viewport.width}px`);
      if (route === "trace-detail") await assertTraceGeometry(page, `${viewport.width}px trace detail`);
      const geometry = await page.evaluate(() => {
        const heading = document.querySelector("h1")?.getBoundingClientRect();
        const main = document.querySelector("main")?.getBoundingClientRect();
        const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
        return { heading, main, topbar, viewportWidth: innerWidth };
      });
      assert.ok(geometry.heading && geometry.main && geometry.topbar, `${route} ${viewport.width}px missing primary layout geometry`);
      assert.ok(geometry.heading.left >= -1 && geometry.heading.right <= geometry.viewportWidth + 1, `${route} ${viewport.width}px heading escaped viewport`);
      assert.ok(geometry.main.left >= -1 && geometry.main.right <= geometry.viewportWidth + 1, `${route} ${viewport.width}px main escaped viewport`);
      assert.ok(geometry.main.top >= geometry.topbar.bottom - 1, `${route} ${viewport.width}px main overlapped topbar`);
    }
  }
  const screenshot = await page.screenshot({ fullPage: true });
  assert.ok(screenshot.length > 8_000, "responsive visual evidence screenshot was unexpectedly empty");
  console.log("visual: 320/390/1024 responsive geometry and overflow passed; reviewed pixel comparisons run in the same visual lane");
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), id: element.id, className: typeof element.className === "string" ? element.className : "", left: Math.round(rect.left), right: Math.round(rect.right), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    }).filter(item => item.left < -1 || item.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1).slice(0, 12)
  }));
  const scrollWidth = Math.max(dimensions.bodyWidth, dimensions.documentWidth);
  assert.ok(scrollWidth <= dimensions.innerWidth + 1, `${label} horizontal overflow: ${scrollWidth}px > ${dimensions.innerWidth}px; offenders=${JSON.stringify(dimensions.offenders)}`);
}

async function assertTraceGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, width: value.width, height: value.height };
    };
    return {
      viewportWidth: innerWidth,
      detailGrids: [...document.querySelectorAll("#view-root .detail-grid")].map(rect),
      codeGroups: [...document.querySelectorAll("#view-root .trace-code-group")].map(rect),
      codes: [...document.querySelectorAll("#view-root code")].map(rect)
    };
  });
  assert.ok(geometry.detailGrids.length >= 2, `${label} did not render both revision/detail grids`);
  assert.ok(geometry.codeGroups.length >= 2, `${label} did not render bounded reason and warning groups`);
  for (const [kind, rects] of [["detail grid", geometry.detailGrids], ["decision code group", geometry.codeGroups], ["code", geometry.codes]]) {
    for (const rect of rects) {
      assert.ok(rect.left >= -1 && rect.right <= geometry.viewportWidth + 1, `${label} ${kind} escaped viewport: ${JSON.stringify(rect)}`);
      assert.ok(rect.width >= 0 && rect.height > 0, `${label} ${kind} collapsed: ${JSON.stringify(rect)}`);
    }
  }
}

async function assertRedactedPersistence(cwd, prompts, firstRouteId) {
  const feedbackFiles = await jsonFiles(path.join(cwd, ".skillmap", "events", "feedback"));
  assert.equal(feedbackFiles.length, 1);
  const feedbackRaw = await readFile(feedbackFiles[0], "utf8");
  const feedback = JSON.parse(feedbackRaw);
  assert.equal(feedback.routeId, firstRouteId);
  assert.equal(feedback.outcome, "correct");
  assert.equal(feedback.promptStored, false);
  assert.equal(feedback.commentStored, false);
  const routeFiles = await jsonFiles(path.join(cwd, ".skillmap", "events", "routes"));
  assert.equal(routeFiles.length, 2);
  const eventCorpus = `${feedbackRaw}\n${(await Promise.all(routeFiles.map(file => readFile(file, "utf8")))).join("\n")}`;
  for (const prompt of prompts) assert.equal(eventCorpus.includes(prompt), false, "redacted event storage contains a raw route prompt");
  assert.match(eventCorpus, /"promptStored": false/);
  console.log("privacy: 2 route events and 1 feedback receipt persisted without either raw prompt");
}

async function assertTracePermalink(page, { workspaceId, routeId, forbidden, visualGate, visuals }) {
  const detailResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/routes/${routeId}` && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Open redacted trace', exact: true }).click();
  const detailResponse = await detailResponsePromise;
  assert.equal(detailResponse.status(), 200, `route detail failed: ${await detailResponse.text()}`);
  const detailRaw = await detailResponse.text();
  for (const value of forbidden) assert.equal(detailRaw.includes(value), false, 'route detail response exposed private prompt or workspace text');
  const detail = JSON.parse(detailRaw).data;
  assert.equal(detail.routeId, routeId);
  assert.equal(detail.promptStored, false);
  assert.equal(Object.hasOwn(detail, 'prompt'), false);
  assert.equal(Object.hasOwn(detail, 'hookText'), false);
  await heading(page, 'Activity');
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/app/${workspaceId}/traces/${routeId}`);
  const rendered = String(await page.locator('#view-root').textContent());
  for (const value of forbidden) assert.equal(rendered.includes(value), false, 'route detail view exposed private prompt or workspace text');
  await assertNoHorizontalOverflow(page, "trace detail desktop");
  await assertTraceGeometry(page, "trace detail desktop");
  if (visualGate) visuals.push(await captureCriticalVisual(page, visualGate, "trace-detail"));

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/app/${workspaceId}/traces/${routeId}`);
  await page.getByRole('button', { name: 'Open Route Lab', exact: true }).click();
  await heading(page, 'Route Lab');
  assert.equal(new URL(page.url()).pathname, `/app/${workspaceId}/route`);
  await page.goBack();
  await heading(page, 'Activity');
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/app/${workspaceId}/traces/${routeId}`);
  await page.goForward();
  await heading(page, 'Route Lab');
  assert.equal(new URL(page.url()).pathname, `/app/${workspaceId}/route`);
  console.log('routes: stable redacted trace permalink survived click, reload, back, and forward navigation');
}

async function jsonFiles(root) {
  const files = [];
  async function visit(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}

async function waitForJob(page, jobId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const envelope = await authenticatedBrowserGet(page, `/api/v1/jobs/${jobId}`);
    assert.equal(envelope.status, 200);
    if (envelope.body.data.state === "succeeded") return envelope.body.data;
    if (["failed", "cancelled"].includes(envelope.body.data.state)) throw new Error(`doctor job ${envelope.body.data.state}: ${JSON.stringify(envelope.body.data.error)}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("doctor job did not complete within 20 seconds");
}

async function waitForStableRevisionEtag(page) {
  let previous = null;
  let stableReads = 0;
  let revisionConflicts = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await authenticatedBrowserGet(page, '/api/v1/bootstrap');
    if (current.status === 409 && current.body?.error?.code === 'REVISION_CHANGED_RETRY' && current.body.error.retryable === true) {
      revisionConflicts += 1;
      assert.ok(revisionConflicts <= 10, 'revision ETag settle exceeded 10 controlled retryable conflicts');
      await new Promise(resolve => setTimeout(resolve, 150));
      continue;
    }
    assert.equal(current.status, 200);
    assert.ok(current.etag, 'bootstrap did not expose a revision ETag');
    stableReads = current.etag === previous ? stableReads + 1 : 0;
    previous = current.etag;
    if (stableReads >= 4) return revisionConflicts;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('connector revision ETag did not settle after the maintenance job');
}

function captureDiagnostics(page, label, expected) {
  const pending = new Set();
  const result = {
    expected: [],
    unexpected: [],
    async flush() {
      while (pending.size) await Promise.allSettled([...pending]);
    }
  };
  const record = (event, isExpected = expected(event)) => (isExpected ? result.expected : result.unexpected).push(event);
  page.on("console", message => {
    if (message.type() === "error") record({ kind: "console", label, message: message.text(), url: message.location().url ?? "" });
  });
  page.on("pageerror", error => record({ kind: "pageerror", label, message: error.message, url: page.url() }));
  page.on("requestfailed", request => record({
    kind: "requestfailed",
    label,
    message: request.failure()?.errorText ?? "unknown",
    method: request.method(),
    url: request.url()
  }));
  page.on("response", response => {
    if (response.status() >= 400) {
      const event = { kind: "response", label, message: `HTTP ${response.status()}`, method: response.request().method(), status: response.status(), url: response.url(), body: "", errorCode: null };
      const expectedAtReceipt = expected(event);
      let bodyRead;
      bodyRead = response.text().then(body => {
        event.body = body.replace(/\s+/g, " ").trim().slice(0, 2_000);
        try { event.errorCode = JSON.parse(body)?.error?.code ?? null; } catch {}
      }, () => undefined).finally(() => {
        record(event, expectedAtReceipt || expected(event));
        pending.delete(bodyRead);
      });
      pending.add(bodyRead);
    }
  });
  return result;
}

function isNavigationAbort(event) {
  return event?.kind === "requestfailed"
    && ["net::ERR_ABORTED", "NS_BINDING_ABORTED", "Load request cancelled"].includes(event.message);
}

function formatDiagnostics(events) {
  return events.map(event => `${event.label} ${event.kind}: ${event.method ?? ""} ${event.url ?? ""} ${event.message}${event.body ? ` body=${event.body}` : ""}`).join("\n");
}

async function heading(page, name) {
  try {
    await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const body = await page.locator("body").textContent().catch(() => "<body unavailable>");
    throw new Error(`Timed out waiting for h1 ${JSON.stringify(name)} at ${page.url()}. Body: ${String(body).replace(/\s+/g, " ").trim().slice(0, 1_200)}`, { cause: error });
  }
}

function qaContextOptions(viewport) {
  return {
    viewport,
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce"
  };
}

function apiErrorBody(code, message, retryable) {
  return JSON.stringify({
    kind: "skillmap.api-response",
    schemaVersion: 1,
    ok: false,
    requestId: "00000000-0000-4000-8000-000000000000",
    servingRevision: null,
    currentRevision: null,
    compatibility: "compatible",
    error: { code, message, retryable }
  });
}

function apiSuccessBody(data, revision) {
  return JSON.stringify({
    kind: "skillmap.api-response",
    schemaVersion: 1,
    ok: true,
    requestId: "00000000-0000-4000-8000-000000000000",
    servingRevision: revision ?? null,
    currentRevision: revision ?? null,
    compatibility: "compatible",
    data
  });
}

async function readCurrentBootstrap(page) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await authenticatedBrowserGet(page, "/api/v1/bootstrap");
    if (response.status === 409 && response.body?.error?.code === "REVISION_CHANGED_RETRY" && response.body.error.retryable === true && attempt === 0) continue;
    break;
  }
  if (!response) throw new Error("bounded bootstrap read exhausted without a response");
  assert.equal(response.status, 200, `bootstrap preflight failed: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.ok, true);
  return response.body.data;
}

async function authenticatedBrowserGet(page, pathname) {
  return page.evaluate(async target => {
    let auth;
    try { auth = JSON.parse(sessionStorage.getItem('skillmap.connector-auth.v1') || 'null'); }
    catch { auth = null; }
    if (!auth || typeof auth.capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(auth.capability)) {
      throw new Error('connector authorization is unavailable in this browser tab');
    }
    const response = await fetch(target, {
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'x-skillmap-capability': auth.capability }
    });
    return {
      status: response.status,
      etag: response.headers.get('etag'),
      body: await response.json()
    };
  }, pathname);
}

async function authenticatedBrowserRevisionGet(page, pathname) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await authenticatedBrowserGet(page, pathname);
    if (response.status === 409
      && response.body?.error?.code === "REVISION_CHANGED_RETRY"
      && response.body.error.retryable === true
      && attempt === 0) continue;
    return response;
  }
  throw new Error(`bounded revision read exhausted without a response for ${pathname}`);
}

async function installFixedClock(context) {
  await context.addInitScript(iso => {
    const NativeDate = Date;
    const fixed = new NativeDate(iso).valueOf();
    class FixedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    }
    Object.setPrototypeOf(FixedDate, NativeDate);
    globalThis.Date = FixedDate;
  }, VISUAL_CLOCK_ISO);
}

async function captureCriticalVisual(page, visualGate, name) {
  const previous = page.viewportSize();
  await page.setViewportSize(VISUAL_VIEWPORT);
  try { return await visualGate.capture(page, name); }
  finally { if (previous) await page.setViewportSize(previous); }
}

async function beginTransitionMeasurement(page) {
  await page.evaluate(() => {
    const root = document.querySelector("#view-root");
    const measurement = { start: performance.now(), feedbackMs: null, observer: null };
    const observer = new MutationObserver(records => {
      if (measurement.feedbackMs === null && records.some(record => record.attributeName === "aria-busy")) {
        measurement.feedbackMs = performance.now() - measurement.start;
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true });
    measurement.observer = observer;
    globalThis.__skillmapQaTransition = measurement;
  });
}

async function finishTransitionMeasurement(page) {
  return page.evaluate(() => {
    const measurement = globalThis.__skillmapQaTransition;
    if (!measurement) throw new Error("route transition measurement was not initialized");
    const completeMs = performance.now() - measurement.start;
    measurement.observer?.disconnect();
    delete globalThis.__skillmapQaTransition;
    return { feedbackMs: measurement.feedbackMs ?? completeMs, completeMs };
  });
}

async function measureSkillFilter(page, query) {
  return page.evaluate(value => {
    const input = document.querySelector("#skill-search");
    if (!(input instanceof HTMLInputElement)) throw new Error("skill search input is unavailable");
    const started = performance.now();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      durationMs: performance.now() - started,
      countText: document.querySelector("#skills-count")?.textContent || "",
      rows: document.querySelectorAll("#skills-body tr").length
    };
  }, query);
}
