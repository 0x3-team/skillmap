#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.SKILLMAP_HOSTED_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const smokeClientIp = "203.0.113.76";
const testDatabaseUrl = process.env.SKILLMAP_TEST_DB_URL;
const hiddenFixture = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_catalog_api_hidden.sql.inc", import.meta.url));
const hiddenCleanup = fileURLToPath(new URL("../../../supabase/tests/fixtures/hosted_catalog_api_hidden_cleanup.sql.inc", import.meta.url));

if (!testDatabaseUrl) throw new Error("SKILLMAP_TEST_DB_URL is required to prove hidden-record API parity.");

let primaryError;
try {
  runFixture(hiddenFixture, "install");
  await waitForServer();

const landingResponse = await smokeFetch(`${baseUrl}/`, { cache: "no-store" });
assert.equal(landingResponse.status, 200);
const contentSecurityPolicy = landingResponse.headers.get("content-security-policy") ?? "";
assert.match(contentSecurityPolicy, /script-src 'self' 'nonce-([^']+)' 'strict-dynamic'/);
assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
assert.doesNotMatch(contentSecurityPolicy, /script-src [^;]*'unsafe-inline'/);
assert.doesNotMatch(contentSecurityPolicy, /style-src-elem [^;]*'unsafe-inline'/);
assert.match(contentSecurityPolicy, /style-src-attr 'unsafe-inline'/);
assert.equal(landingResponse.headers.get("x-content-type-options"), "nosniff");
assert.equal(landingResponse.headers.get("x-frame-options"), "DENY");
assert.match(landingResponse.headers.get("x-robots-tag") ?? "", /noindex/);
const landingHtml = await landingResponse.text();
const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)?.[1];
assert.equal(typeof nonce, "string");
assert.match(landingHtml, new RegExp(`nonce=["']${escapeRegExp(nonce)}["']`));

const robotsResponse = await smokeFetch(`${baseUrl}/robots.txt`, { cache: "no-store" });
assert.equal(robotsResponse.status, 200);
assert.match(await robotsResponse.text(), /^Disallow: \/$/m);

const hostileNext = encodeURIComponent("/%2e%2e//evil.example");
const callback = await smokeFetch(`${baseUrl}/auth/callback?next=${hostileNext}`, { redirect: "manual", cache: "no-store" });
assert.equal(callback.status, 307);
const callbackLocation = new URL(callback.headers.get("location") ?? "", baseUrl);
assert.equal(callbackLocation.origin, new URL(baseUrl).origin);
assert.equal(callbackLocation.pathname, "/sign-in");
assert.equal(callbackLocation.searchParams.get("error"), "missing-code");
assertPrivateNoStore(callback, "callback redirect");

const anonymousAccount = await smokeFetch(`${baseUrl}/account`, { redirect: "manual", cache: "no-store" });
assert.equal(anonymousAccount.status, 307);
const accountLocation = new URL(anonymousAccount.headers.get("location") ?? "", baseUrl);
assert.equal(accountLocation.origin, new URL(baseUrl).origin);
assert.equal(accountLocation.pathname, "/sign-in");
assert.equal(accountLocation.searchParams.get("next"), "/account");
assertPrivateNoStore(anonymousAccount, "anonymous account redirect");

const accountLookalike = await smokeFetch(`${baseUrl}/account-info`, { redirect: "manual", cache: "no-store" });
assert.equal(accountLookalike.status, 404);

const repeatedNext = await smokeFetch(`${baseUrl}/sign-in?next=/skills&next=//evil.example`, { cache: "no-store" });
assert.equal(repeatedNext.status, 200);
assert.match(await repeatedNext.text(), /name="next" value="\/account"/);

for (const [query, parameter] of [
  ["q=quality&q=audit", "q"],
  ["limit=1&limit=2", "limit"],
  ["cursor=first&cursor=second", "cursor"]
]) {
  const repeatedCatalogQuery = await smokeFetch(`${baseUrl}/skills?${query}`, { cache: "no-store" });
  assert.equal(repeatedCatalogQuery.status, 200);
  assert.match(
    await repeatedCatalogQuery.text(),
    new RegExp(`Repeated ${parameter} parameters are not allowed`)
  );
}

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

const microsecondFirst = await getJson("/api/v1/skills?q=microsecond&limit=1", 200);
assert.equal(microsecondFirst.body.data.items[0].skillId, "skl_00000000000000000000000000000005");
const microsecondCursor = JSON.parse(
  Buffer.from(microsecondFirst.body.data.pagination.nextCursor, "base64url").toString("utf8")
);
assert.equal(microsecondCursor.publishedAt, "2026-07-11T17:00:01.123456Z");
const microsecondSecond = await getJson(
  `/api/v1/skills?q=microsecond&limit=1&cursor=${encodeURIComponent(microsecondFirst.body.data.pagination.nextCursor)}`,
  200
);
assert.deepEqual(
  microsecondSecond.body.data.items.map((item) => item.skillId),
  ["skl_00000000000000000000000000000006"]
);
assert.equal(microsecondSecond.body.data.pagination.hasMore, false);

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
assert.equal(detail.body.data.source.commit, "d1c23990af82d1c8c99997cb8d9a2c23707d91fa");

for (const result of [first, second, search, badLimit, badCursor, hidden, missing, detail]) {
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /service_role|sb_secret_|super-secret-jwt|phase1-[ab]@skillmap|[?&](?:token|key|signature)=/i);
}

let rateLimited;
for (let requestNumber = 1; requestNumber <= 61; requestNumber += 1) {
  const response = await smokeFetch(`${baseUrl}/api/v1/skills?limit=0`, {
    cache: "no-store",
    headers: { "x-vercel-forwarded-for": "203.0.113.77" }
  });
  if (requestNumber <= 60) {
    assert.equal(response.status, 400, `rate-limit warmup request ${requestNumber}`);
    await response.arrayBuffer();
    continue;
  }
  rateLimited = { body: await response.json(), headers: response.headers, status: response.status };
}
assert.equal(rateLimited?.status, 429);
assert.equal(rateLimited.body.error.code, "RATE_LIMITED");
assert.equal(rateLimited.body.error.retryable, true);
assert.match(rateLimited.headers.get("retry-after") ?? "", /^[1-9][0-9]*$/);
assert.equal(rateLimited.headers.get("ratelimit-limit"), "60");
assert.equal(rateLimited.headers.get("ratelimit-remaining"), "0");

const rateLimitedPage = await smokeFetch(`${baseUrl}/skills`, {
  cache: "no-store",
  headers: { "x-vercel-forwarded-for": "203.0.113.77" }
});
assert.equal(rateLimitedPage.status, 429);
assert.match(rateLimitedPage.headers.get("retry-after") ?? "", /^[1-9][0-9]*$/);
assert.equal(rateLimitedPage.headers.get("ratelimit-remaining"), "0");
assert.match(await rateLimitedPage.text(), /Too many catalog requests/);

  process.stdout.write(`${JSON.stringify({
    result: "pass",
    list: "cursor-stable",
    search: "bounded",
    microsecondPagination: "no-gap",
    hiddenNotFoundParity: true,
    privateAlphaHeaders: "nonce-csp-noindex",
    rateLimit: "shared-api-and-page-429",
    trustStates: "truthful",
    secretCanary: "absent"
  })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  try {
    runFixture(hiddenCleanup, "cleanup");
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError;
    process.stderr.write(`Hosted API fixture cleanup also failed: ${errorMessage(cleanupError)}\n`);
  }
}

function runFixture(path, action) {
  try {
    execFileSync("psql", [testDatabaseUrl, "-X", "-1", "-v", "ON_ERROR_STOP=1", "-f", path], { stdio: "ignore" });
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
      const response = await smokeFetch(`${baseUrl}/skills`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The development server may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SkillMap web did not become ready at ${baseUrl}.`);
}

async function getJson(pathname, expectedStatus) {
  const response = await smokeFetch(`${baseUrl}${pathname}`, { cache: "no-store" });
  assert.equal(response.status, expectedStatus, `${pathname} status`);
  return { body: await response.json(), headers: response.headers };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function smokeFetch(input, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("x-vercel-forwarded-for")) {
    headers.set("x-vercel-forwarded-for", smokeClientIp);
  }
  return fetch(input, { ...init, headers });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
