import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;
const appDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoDir = resolve(appDir, "../..");
const baseUrl = process.env.SKILLMAP_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const expectedSource = process.env.SKILLMAP_EXPECT_SOURCE ?? "fixture";
const recoverableRuntimeFailure =
  /Host system is missing dependencies to run browsers|Executable doesn't exist/i;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runDirect(browser) {
  return run(process.execPath, ["scripts/browser-smoke.mjs"], {
    env: { ...process.env, SKILLMAP_BROWSERS: browser }
  });
}

function runInDocker(browser) {
  const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;
  return run("docker", [
    "run",
    "--rm",
    "--network",
    "host",
    "--ipc=host",
    "-e",
    "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
    "-e",
    `SKILLMAP_WEB_BASE_URL=${baseUrl}`,
    "-e",
    `SKILLMAP_EXPECT_SOURCE=${expectedSource}`,
    "-e",
    `SKILLMAP_BROWSERS=${browser}`,
    "-v",
    `${repoDir}:/work:ro`,
    "-w",
    "/work/apps/web",
    image,
    "node",
    "scripts/browser-smoke.mjs"
  ]);
}

for (const browser of ["chromium", "firefox", "webkit"]) {
  const direct = runDirect(browser);
  if (direct.status === 0) {
    printResult(direct);
    continue;
  }

  const directOutput = `${direct.stdout ?? ""}\n${direct.stderr ?? ""}`;
  if (!recoverableRuntimeFailure.test(directOutput)) {
    printResult(direct);
    process.exit(direct.status ?? 1);
  }

  process.stdout.write(
    `${browser}: native Playwright runtime unavailable; retrying in the pinned official image v${playwrightVersion}.\n`
  );
  const docker = runInDocker(browser);
  printResult(docker);
  if (docker.status !== 0) {
    process.stderr.write(`Native ${browser} failure:\n${directOutput}\n`);
    process.exit(docker.status ?? 1);
  }
}

console.log("Chromium, Firefox, and WebKit browser acceptance passed");
