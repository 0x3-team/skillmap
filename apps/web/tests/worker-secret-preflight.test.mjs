import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  WORKER_SECRET_NAME,
  buildWorkerSecretListCommand,
  parseWorkerName,
  parseWorkerSecretList,
  assertWorkerSecretProvisioned
} from "../scripts/check-worker-secret.mjs";

test("Worker secret parser accepts only strict JSON secret-name arrays", () => {
  assert.equal(parseWorkerName('{\n  "name": "skillmap",\n  "vars": {}\n}'), "skillmap");
  assert.deepEqual(parseWorkerSecretList(JSON.stringify([{ name: WORKER_SECRET_NAME }])), { name: WORKER_SECRET_NAME });
  assert.throws(() => parseWorkerSecretList("notice\n[]"), /valid JSON/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ name: "OTHER_SECRET" }])), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.throws(() => parseWorkerSecretList(JSON.stringify([{ value: "must-not-be-used" }])), /invalid secret entry/);
});

test("Worker secret preflight uses the pinned local Wrangler command and never passes the secret value", async () => {
  const appRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const command = buildWorkerSecretListCommand({ appRoot, workerName: "skillmap" });
  assert.match(command.executable, /node_modules[\\/]\.bin[\\/]wrangler$/);
  assert.deepEqual(command.args, [
    "secret", "list", "--config", `${appRoot}/wrangler.jsonc`,
    "--name", "skillmap", "--format", "json"
  ]);

  const previous = process.env[WORKER_SECRET_NAME];
  process.env[WORKER_SECRET_NAME] = "test-secret-must-not-cross-boundary";
  try {
    await assertWorkerSecretProvisioned({
      appRoot,
      configSource: '{"name":"skillmap"}',
      execFileImpl: async (executable, args, options) => {
        assert.equal(executable, command.executable);
        assert.deepEqual(args, command.args);
        assert.equal(options.cwd, appRoot);
        assert.equal(options.env[WORKER_SECRET_NAME], undefined);
        assert.equal(options.shell, false);
        return { stdout: JSON.stringify([{ name: WORKER_SECRET_NAME }]), stderr: "" };
      }
    });
  } finally {
    if (previous === undefined) delete process.env[WORKER_SECRET_NAME];
    else process.env[WORKER_SECRET_NAME] = previous;
  }
});

test("ordinary builds stay provider-free while deploy runs the secret preflight first", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.deploy, /^node scripts\/check-worker-secret\.mjs && opennextjs-cloudflare build && opennextjs-cloudflare deploy$/);
  assert.match(packageJson.scripts.build, /^node --experimental-strip-types scripts\/check-hosted-release-config\.mts && next build$/);
  assert.doesNotMatch(packageJson.scripts.build, /check-worker-secret|wrangler/);
});
