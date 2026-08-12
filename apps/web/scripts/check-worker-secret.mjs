import process from "node:process";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WRANGLER_VERSION = "4.121.0";
export const WORKER_SECRET_NAME = "SUPABASE_SERVICE_ROLE_KEY";
export const WORKER_CONFIG_FILE = "wrangler.jsonc";

const execFileAsync = promisify(execFile);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Extract the top-level Worker name from the checked-in JSONC config. */
export function parseWorkerName(configSource) {
  if (typeof configSource !== "string") throw new Error("Worker config must be text.");
  const match = configSource.match(/(?:^|[,{\n])\s*"name"\s*:\s*"([^"\r\n]+)"\s*,?/);
  if (!match?.[1]) throw new Error("Worker config must declare a name.");
  return match[1];
}

/**
 * Parse Wrangler's JSON secret-name response without accepting text around it
 * or reading any value field. Secret list responses contain names only.
 */
export function parseWorkerSecretList(raw, expectedName = WORKER_SECRET_NAME) {
  if (typeof raw !== "string" || raw.length > 64 * 1024) {
    throw new Error("Wrangler secret list output was not bounded JSON.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Wrangler secret list output was not valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("Wrangler secret list output must be an array.");
  const names = parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error("Wrangler secret list output contained an invalid secret entry.");
    }
    return entry.name;
  });
  if (!names.includes(expectedName)) {
    throw new Error(`${expectedName} is not provisioned for the configured Worker.`);
  }
  return Object.freeze({ name: expectedName });
}

export function buildWorkerSecretListCommand({
  appRoot = APP_ROOT,
  configFile = resolve(appRoot, WORKER_CONFIG_FILE),
  workerName,
  executable = resolve(appRoot, "node_modules/.bin/wrangler")
} = {}) {
  if (!workerName) throw new Error("Worker name is required.");
  return Object.freeze({
    executable,
    args: Object.freeze([
      "secret",
      "list",
      "--config",
      configFile,
      "--name",
      workerName,
      "--format",
      "json"
    ]),
    cwd: appRoot
  });
}

/**
 * Run the pinned local Wrangler secret-name check. The service-role value is
 * deliberately removed from the child environment: listing names does not
 * need the value and must never print or transport it.
 */
export async function assertWorkerSecretProvisioned({
  appRoot = APP_ROOT,
  configSource,
  execFileImpl = execFileAsync
} = {}) {
  const source = configSource ?? await readFile(resolve(appRoot, WORKER_CONFIG_FILE), "utf8");
  const workerName = parseWorkerName(source);
  const command = buildWorkerSecretListCommand({ appRoot, workerName });
  const packageJson = JSON.parse(await readFile(resolve(appRoot, "node_modules/wrangler/package.json"), "utf8"));
  if (packageJson.version !== WRANGLER_VERSION) {
    throw new Error(`Pinned Wrangler ${WRANGLER_VERSION} is required for the Worker secret preflight.`);
  }
  const safeEnvironment = { ...process.env };
  delete safeEnvironment[WORKER_SECRET_NAME];
  let result;
  try {
    result = await execFileImpl(command.executable, command.args, {
      cwd: command.cwd,
      env: safeEnvironment,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      shell: false
    });
  } catch {
    throw new Error("Wrangler could not list secrets for the configured Worker.");
  }
  parseWorkerSecretList(result.stdout);
  return command;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await assertWorkerSecretProvisioned();
    process.stdout.write(`[skillmap] Worker secret preflight passed: ${WORKER_SECRET_NAME} is provisioned.\n`);
  } catch (error) {
    process.stderr.write(`[skillmap] Worker secret preflight failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
