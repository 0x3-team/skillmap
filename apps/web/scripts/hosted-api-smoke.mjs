#!/usr/bin/env node

import assert from "node:assert/strict";

const baseUrl = (process.env.SKILLMAP_HOSTED_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

await waitForServer();

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
assert.equal(detail.body.data.source.rawSnapshotDigest, null);
assert.equal(detail.body.data.artifact.normalizedDigest, null);
assert.equal(detail.body.data.evidence.provenance, "unverified");
assert.equal(detail.body.data.evidence.audit, "not-run");
assert.equal(detail.body.data.compatibility.state, "not-tested");
assert.equal(detail.body.data.currentVersion.grade.state, "ungraded");
assert.equal(detail.body.data.source.commit, "6e80296e4680c9f469a30e85af39549726573e3d");

for (const result of [first, second, search, badLimit, badCursor, hidden, missing, detail]) {
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /service_role|sb_secret_|super-secret-jwt|phase1-[ab]@skillmap/i);
}

process.stdout.write(`${JSON.stringify({
  result: "pass",
  list: "cursor-stable",
  search: "bounded",
  hiddenNotFoundParity: true,
  trustStates: "truthful",
  secretCanary: "absent"
})}\n`);

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
