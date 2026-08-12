import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const webRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(webRoot, ".open-next", "worker.js");
const wranglerPath = path.join(webRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const wranglerStateRoot = path.join(webRoot, ".wrangler");

assert.equal(existsSync(workerPath), true, "OpenNext worker is missing; run opennextjs-cloudflare build first");
assert.equal(existsSync(wranglerPath), true, "Wrangler is missing; run npm ci in apps/web first");
assert.equal(existsSync(wranglerStateRoot), false, "refusing to overwrite pre-existing repo-local Wrangler state");

const port = await reservePort();
const scratch = mkdtempSync(path.join(tmpdir(), "skillmap-m3-workerd-"));
const providerSentinel = await startProviderSentinel();
const child = spawn(process.execPath, [
  wranglerPath,
  "dev",
  "--local",
  "--config",
  path.join(webRoot, "wrangler.jsonc"),
  "--persist-to",
  path.join(scratch, "state"),
  "--var",
  `NEXT_PUBLIC_SUPABASE_URL:http://127.0.0.1:${providerSentinel.port}`,
  "--port",
  String(port)
], {
  cwd: scratch,
  env: {
    ...process.env,
    SUPABASE_SERVICE_ROLE_KEY: "local-workerd-smoke-not-a-provider-secret",
    DEVICE_AUTH_LOOKUP_KEY: "local-workerd-smoke-not-a-provider-secret"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  await waitForWorker(port, child, () => `${stdout}\n${stderr}`);

  const invalidType = await fetch(`http://127.0.0.1:${port}/api/device-auth/v1/pairings`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
    signal: AbortSignal.timeout(5_000)
  });
  await assertClosedError(invalidType, "invalid_request");

  const duplicateKey = await fetch(`http://127.0.0.1:${port}/api/device-auth/v1/pairings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"device_id":"one","device_id":"two"}',
    signal: AbortSignal.timeout(5_000)
  });
  await assertClosedError(duplicateKey, "invalid_request");

  const query = await fetch(`http://127.0.0.1:${port}/api/device-auth/v1/pairings?secret=canary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5_000)
  });
  await assertClosedError(query, "invalid_request");

  const devicePublicId = `dev_${"a".repeat(32)}`;
  const rotation = await fetch(`http://127.0.0.1:${port}/api/device-auth/v1/devices/${devicePublicId}/rotate`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
    signal: AbortSignal.timeout(5_000)
  });
  await assertClosedError(rotation, "invalid_request");

  assert.equal(providerSentinel.requestCount, 0, "a malformed request reached the Supabase provider boundary");
  assert.doesNotMatch(`${stdout}\n${stderr}`, /local-workerd-smoke-not-a-provider-secret|secret=canary/);
  process.stdout.write("OpenNext DeviceAuth Workerd smoke passed: 4/4; provider requests: 0\n");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000)
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000)
    ]);
  }
  assert.notEqual(child.exitCode, null, "Wrangler process did not terminate");
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) }));
  await providerSentinel.close();
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(scratch), false, "Workerd scratch state was not removed");
  removeEmptyWranglerDirectories();
  assert.equal(existsSync(wranglerStateRoot), false, "repo-local Wrangler state was not removed");
}

async function assertClosedError(response, expectedError) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const body = await response.json();
  assert.deepEqual(body, {
    error: expectedError,
    error_description: "The request is invalid.",
    retry_after: 0
  });
}

async function waitForWorker(portNumber, processHandle, output) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Wrangler exited before readiness (${processHandle.exitCode}): ${output().slice(-1_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_000)
      });
      if (response.status > 0) return;
    } catch {
      // Wrangler is still starting.
    }
    await delay(250);
  }
  throw new Error(`Wrangler did not become ready: ${output().slice(-1_000)}`);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const selected = address.port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

async function startProviderSentinel() {
  let requestCount = 0;
  const server = createHttpServer((_request, response) => {
    requestCount += 1;
    response.writeHead(503, { "content-type": "application/json" });
    response.end('{"error":"sentinel"}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    get requestCount() { return requestCount; },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function removeEmptyWranglerDirectories() {
  for (const directory of [
    path.join(wranglerStateRoot, "tmp", "email"),
    path.join(wranglerStateRoot, "tmp"),
    wranglerStateRoot
  ]) {
    if (!existsSync(directory)) continue;
    assert.deepEqual(readdirSync(directory), [], `refusing to remove non-empty Wrangler directory: ${directory}`);
    rmdirSync(directory);
  }
}
