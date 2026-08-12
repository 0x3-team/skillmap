import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  WORKER_SECRET_NAME,
  WORKER_SECRET_NAMES,
  WORKER_SECRET_ROTATION_NAME,
  buildWorkerSecretListCommand,
  parseWorkerName,
  parseWorkerSecretList,
  assertWorkerSecretProvisioned
} from "../scripts/check-worker-secret.mjs";

test("Worker secret parser accepts only strict JSON secret-name arrays", () => {
  assert.equal(parseWorkerName('{\n  "name": "skillmap",\n  "vars": {}\n}'), "skillmap");
  assert.deepEqual(
    parseWorkerSecretList(JSON.stringify(WORKER_SECRET_NAMES.map((name) => ({ name })))),
    { names: WORKER_SECRET_NAMES }
  );
  assert.throws(() => parseWorkerSecretList("notice\n[]"), /valid JSON/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ name: WORKER_SECRET_NAME }])), /DEVICE_AUTH_LOOKUP_KEY, DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY.*not provisioned/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ name: "DEVICE_AUTH_LOOKUP_KEY" }])), /SUPABASE_SERVICE_ROLE_KEY, DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY.*not provisioned/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify(WORKER_SECRET_NAMES.slice(0, 2).map((name) => ({ name })))), /DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY.*not provisioned/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ name: "OTHER_SECRET" }])), /SUPABASE_SERVICE_ROLE_KEY.*DEVICE_AUTH_LOOKUP_KEY.*DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY/);
  assert.doesNotThrow(() => parseWorkerSecretList(JSON.stringify([
    ...WORKER_SECRET_NAMES.map((name) => ({ name })),
    { name: WORKER_SECRET_ROTATION_NAME }
  ])));
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ value: "must-not-be-used" }])), /invalid secret entry/);
});

test("Worker secret preflight uses the exact pinned local Wrangler command and never passes secret values", async () => {
  const appRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const command = buildWorkerSecretListCommand({ appRoot, workerName: "skillmap" });
  assert.match(command.executable, /node_modules[\\/]\.bin[\\/]wrangler$/);
  assert.deepEqual(command.args, [
    "secret", "list", "--config", `${appRoot}/wrangler.jsonc`,
    "--name", "skillmap", "--format", "json"
  ]);

  const previous = process.env[WORKER_SECRET_NAME];
  const previousLookup = process.env.DEVICE_AUTH_LOOKUP_KEY;
  const previousIpPrimary = process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY;
  const previousIpPrevious = process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS;
  process.env[WORKER_SECRET_NAME] = "test-secret-must-not-cross-boundary";
  process.env.DEVICE_AUTH_LOOKUP_KEY = "test-lookup-secret-must-not-cross-boundary";
  process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY = "test-ip-primary-must-not-cross-boundary";
  process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS = "test-ip-previous-must-not-cross-boundary";
  try {
    await assertWorkerSecretProvisioned({
      appRoot,
      configSource: '{"name":"skillmap"}',
      execFileImpl: async (executable, args, options) => {
        assert.equal(executable, command.executable);
        assert.deepEqual(args, command.args);
        assert.equal(options.cwd, appRoot);
        assert.equal(options.env[WORKER_SECRET_NAME], undefined);
        assert.equal(options.env.DEVICE_AUTH_LOOKUP_KEY, undefined);
        assert.equal(options.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY, undefined);
        assert.equal(options.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS, undefined);
        assert.equal(options.shell, false);
        return { stdout: JSON.stringify(WORKER_SECRET_NAMES.map((name) => ({ name }))), stderr: "" };
      }
    });
  } finally {
    if (previous === undefined) delete process.env[WORKER_SECRET_NAME];
    else process.env[WORKER_SECRET_NAME] = previous;
    if (previousLookup === undefined) delete process.env.DEVICE_AUTH_LOOKUP_KEY;
    else process.env.DEVICE_AUTH_LOOKUP_KEY = previousLookup;
    if (previousIpPrimary === undefined) delete process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY;
    else process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY = previousIpPrimary;
    if (previousIpPrevious === undefined) delete process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS;
    else process.env.DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS = previousIpPrevious;
  }
});

test("ordinary builds stay provider-free while deploy runs the secret preflight first", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.deploy, /^node scripts\/check-worker-secret\.mjs && opennextjs-cloudflare build && opennextjs-cloudflare deploy$/);
  assert.match(packageJson.scripts.build, /^node --experimental-strip-types scripts\/check-hosted-release-config\.mts && next build$/);
  assert.doesNotMatch(packageJson.scripts.build, /check-worker-secret|wrangler/);
});
