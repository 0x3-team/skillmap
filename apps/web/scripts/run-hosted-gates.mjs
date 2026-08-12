import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoDir = join(appDir, "..", "..");
const port = parsePort(process.env.SKILLMAP_HOSTED_GATE_PORT ?? "3108");
const baseUrl = `http://127.0.0.1:${port}`;

if (!existsSync(join(appDir, ".next", "BUILD_ID"))) {
  throw new Error("Hosted browser gates require an existing optimized web build. Run npm --prefix apps/web run build first.");
}

const local = parseSupabaseEnvironment(execFileSync("supabase", ["status", "-o", "env"], {
  cwd: repoDir,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
}));
for (const key of ["API_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
  if (!local[key]) throw new Error(`Local Supabase status omitted ${key}; start the complete disposable stack before this gate.`);
}

let server = startWebServer("private-alpha", "private-alpha");

let primaryError;
try {
  await waitForServer(server, baseUrl);
  const gateEnvironment = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    SKILLMAP_TEST_DB_URL: local.DB_URL,
    SKILLMAP_ALLOW_LOCAL_DOCKER_PSQL_FALLBACK: "1",
    SKILLMAP_HOSTED_BASE_URL: baseUrl,
    SKILLMAP_WEB_BASE_URL: baseUrl
  };
  process.stdout.write("[hosted-browser-gate] hosted-api-smoke.mjs\n");
  await run(process.execPath, [join(appDir, "scripts", "hosted-api-smoke.mjs")], gateEnvironment);
  for (const browserName of ["chromium", "firefox", "webkit"]) {
    process.stdout.write(`[hosted-browser-gate] hosted-auth-browser-smoke.mjs (${browserName})\n`);
    await run(process.execPath, [join(appDir, "scripts", "hosted-auth-browser-smoke.mjs")], {
      ...gateEnvironment,
      SKILLMAP_HOSTED_BROWSER: browserName
    });
  }
  process.stdout.write("[hosted-browser-gate] launch-report-evidence-smoke.mjs\n");
  await run(process.execPath, [join(appDir, "scripts", "launch-report-evidence-smoke.mjs")], gateEnvironment);
  process.stdout.write("[hosted-browser-gate] hosted-frontend-qa.mjs\n");
  await run(process.execPath, [join(appDir, "scripts", "hosted-frontend-qa.mjs")], gateEnvironment);
  const privateStopError = await stopServer(server);
  if (privateStopError) throw privateStopError;
  server = startWebServer("public-alpha", "public");
  await waitForServer(server, baseUrl);
  await assertPublicReleaseStage(baseUrl);
  process.stdout.write(`${JSON.stringify({ result: "pass", gates: ["hosted-api", "hosted-auth-cross-browser", "hosted-launch", "hosted-frontend-a11y-visual", "public-stage-runtime"], releaseStages: ["private-alpha", "public-alpha"] })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupError = await stopServer(server);
  if (cleanupError) {
    if (!primaryError) throw cleanupError;
    process.stderr.write(`Hosted browser server cleanup also failed: ${cleanupError.message}\n`);
  }
}

function parseSupabaseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, encoded] = match;
    try {
      values[key] = JSON.parse(encoded);
    } catch {
      values[key] = encoded;
    }
  }
  return values;
}

function startWebServer(releaseStage, indexingMode) {
  // Spawn Next directly so the process we stop is the process that owns the
  // listener. Killing an npm wrapper can briefly leave its child serving the
  // previous release-stage environment and make the restart assertion race
  // against stale private-alpha responses.
  return spawn(process.execPath, [
    join(appDir, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port)
  ], {
    cwd: appDir,
    env: {
      ...publicServerProcessEnvironment(),
      NEXT_PUBLIC_SITE_URL: baseUrl,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      SKILLMAP_RELEASE_STAGE: releaseStage,
      SKILLMAP_INDEXING_MODE: indexingMode,
      SKILLMAP_SUPPORT_URL: `${baseUrl}/support`
    },
    stdio: "inherit"
  });
}

function publicServerProcessEnvironment() {
  const safeKeys = [
    "CI",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LC_ALL",
    "NEXT_TELEMETRY_DISABLED",
    "NO_COLOR",
    "PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ"
  ];
  return Object.fromEntries(
    safeKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])
  );
}

async function assertPublicReleaseStage(origin) {
  const landing = await fetch(`${origin}/`, { cache: "no-store" });
  if (landing.status !== 200 || landing.headers.has("x-robots-tag")) {
    throw new Error("Public release stage retained a private indexing header.");
  }
  const landingText = await landing.text();
  if (!landingText.includes("Free curated trust alpha · public alpha")) {
    throw new Error("Public release stage did not render truthful public-alpha copy.");
  }
  const robotsMeta = [...landingText.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => ({
      name: readHtmlAttribute(tag, "name"),
      content: readHtmlAttribute(tag, "content")
    }))
    .find((entry) => entry.name?.toLowerCase() === "robots");
  const robotsMetaTokens = new Set(
    (robotsMeta?.content ?? "")
      .toLowerCase()
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
  );
  if (!robotsMetaTokens.has("index") || !robotsMetaTokens.has("follow") || robotsMetaTokens.has("noindex")) {
    throw new Error("Public release stage did not render indexable page-level robots metadata.");
  }
  const support = await fetch(`${origin}/support`, { cache: "no-store" });
  const supportText = await support.text();
  if (support.status !== 200 || !supportText.includes(`href="${origin}/support"`)) {
    throw new Error("Public release stage did not render the configured approved support intake.");
  }
  const robots = await fetch(`${origin}/robots.txt`, { cache: "no-store" });
  const robotsText = await robots.text();
  if (robots.status !== 200 || !/^Allow: \/$/m.test(robotsText) || /Disallow: \/$/m.test(robotsText)) {
    throw new Error("Public release stage did not enable the request-time robots allow rule.");
  }
}

function readHtmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

async function waitForServer(serverProcess, origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Hosted web server exited before readiness (${serverProcess.exitCode}).`);
    try {
      const response = await fetch(`${origin}/release-status`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status >= 200 && response.status < 500) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Hosted web server did not become ready at ${origin}.`);
}

async function run(command, args, environment) {
  const child = spawn(command, args, { cwd: appDir, env: environment, stdio: "inherit" });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw new Error(`${args.at(-1)} failed (${signal ?? code ?? "unknown"}).`);
}

async function stopServer(serverProcess) {
  if (serverProcess.exitCode !== null) return null;
  const exitPromise = once(serverProcess, "exit").then(() => true);
  serverProcess.kill("SIGTERM");
  const exited = Promise.race([
    exitPromise,
    delay(5_000).then(() => false)
  ]);
  if (await exited) return null;
  serverProcess.kill("SIGKILL");
  await exitPromise.catch(() => {});
  return new Error("Hosted web server required SIGKILL during cleanup.");
}

function parsePort(value) {
  if (!/^[0-9]{4,5}$/.test(value)) throw new Error("SKILLMAP_HOSTED_GATE_PORT must be a decimal port from 1024 through 65535.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error("SKILLMAP_HOSTED_GATE_PORT must be a decimal port from 1024 through 65535.");
  return parsed;
}
