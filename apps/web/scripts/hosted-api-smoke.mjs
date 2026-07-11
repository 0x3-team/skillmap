#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.SKILLMAP_HOSTED_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const testDatabaseUrl = process.env.SKILLMAP_TEST_DB_URL;
const hiddenFixture = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_catalog_api_hidden.sql.inc", import.meta.url));
const hiddenCleanup = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_catalog_api_hidden_cleanup.sql.inc", import.meta.url));

if (!testDatabaseUrl) throw new Error("SKILLMAP_TEST_DB_URL is required to prove hidden-record API parity.");
runFixture(hiddenFixture, "install");

try {
  await waitForServer();

const hostileNext = encodeURIComponent("/%2e%2e//evil.example");
const callback = await fetch(`${baseUrl}/auth/callback?next=${hostileNext}`, { redirect: "manual", cache: "no-store" });
assert.equal(callback.status, 307);
const callbackLocation = new URL(callback.headers.get("location") ?? "", baseUrl);
assert.equal(callbackLocation.origin, new URL(baseUrl).origin);
assert.equal(callbackLocation.pathname, "/sign-in");
assert.equal(callbackLocation.searchParams.get("error"), "missing-code");
assertPrivateNoStore(callback, "callback redirect");

const anonymousAccount = await fetch(`${baseUrl}/account`, { redirect: "manual", cache: "no-store" });
assert.equal(anonymousAccount.status, 307);
const accountLocation = new URL(anonymousAccount.headers.get("location") ?? "", baseUrl);
assert.equal(accountLocation.origin, new URL(baseUrl).origin);
assert.equal(accountLocation.pathname, "/sign-in");
assert.equal(accountLocation.searchParams.get("next"), "/account");
assertPrivateNoStore(anonymousAccount, "anonymous account redirect");

const first = await getJson("/api/v1/skills?limit=1", 200);
assert.equal(first.body.ok, true);
assert.equal(first.body.data.items.length, 1);
assert.equal(first.body.data.items[0].slug, "skill-audit");
assert.equal(first.body.data.pagination.hasMore, true);
assert.match(first.headers.get("cache-control") ?? "", /no-store/);

const cursor = first.body.data.pagination.nextCursor;
assert.equal(typeof cursor, "string");
const second = await getJson(`/api/v1/skills?limit=1&cursor=${encodeURIComponent(cursor)}`, 200);
assert.equal(second.body.data.items[0].slug, "skill-quality-review");

const search = await getJson("/api/v1/skills?q=quality", 200);
assert.deepEqual(search.body.data.items.map((item) => item.slug), ["skill-quality-review"]);

const badLimit = await getJson("/api/v1/skills?limit=51", 400);
assert.equal(badLimit.body.error.code, "INVALID_QUERY");
const badCursor = await getJson("/api/v1/skills?cursor=not-a-real-cursor", 400);
assert.equal(badCursor.body.error.code, "INVALID_CURSOR");

const hidden = await getJson("/api/v1/skills/skl_00000000000000000000000000000004", 404);
const missing = await getJson("/api/v1/skills/skl_ffffffffffffffffffffffffffffffff", 404);
assert.equal(hidden.body.error.code, "NOT_FOUND");
assert.equal(missing.body.error.code, "NOT_FOUND");
assert.equal(hidden.body.error.message, missing.body.error.message);

const detail = await getJson("/api/v1/skills/skl_00000000000000000000000000000001", 200);
const repositoryUrl = new URL(detail.body.data.source.repositoryUrl);
assert.equal(repositoryUrl.protocol, "https:");
assert.equal(repositoryUrl.username, "");
assert.equal(repositoryUrl.password, "");
assert.equal(repositoryUrl.search, "");
assert.equal(repositoryUrl.hash, "");
assert.equal(detail.body.data.source.rawSnapshotDigest, null);
assert.equal(detail.body.data.artifact.normalizedDigest, null);
assert.equal(detail.body.data.evidence.provenance, "unverified");
assert.equal(detail.body.data.evidence.audit, "not-run");
assert.equal(detail.body.data.compatibility.state, "not-tested");
assert.equal(detail.body.data.currentVersion.grade.state, "ungraded");
assert.equal(detail.body.data.source.commit, "6e80296e4680c9f469a30e85af39549726573e3d");

for (const result of [first, second, search, badLimit, badCursor, hidden, missing, detail]) {
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /service_role|sb_secret_|super-secret-jwt|phase1-[ab]@skillmap|[?&](?:token|key|signature)=/i);
}

  process.stdout.write(`${JSON.stringify({
    result: "pass",
    list: "cursor-stable",
    search: "bounded",
    hiddenNotFoundParity: true,
    trustStates: "truthful",
    secretCanary: "absent"
  })}\n`);
} finally {
  runFixture(hiddenCleanup, "cleanup");
}

function runFixture(path, action) {
  try {
    execFileSync("psql", [testDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", path], { stdio: "ignore" });
  } catch {
    throw new Error(`Hosted API hidden fixture ${action} failed.`);
  }
}

function assertPrivateNoStore(response, label) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /\bprivate\b/i, `${label} must be private`);
  assert.match(cacheControl, /\bno-store\b/i, `${label} must be no-store`);
  assert.doesNotMatch(cacheControl, /\bpublic\b|s-maxage/i, `${label} must not be shared-cacheable`);
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/skills`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The development server may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SkillMap web did not become ready at ${baseUrl}.`);
}

async function getJson(pathname, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: "no-store" });
  assert.equal(response.status, expectedStatus, `${pathname} status`);
  return { body: await response.json(), headers: response.headers };
}
