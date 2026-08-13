import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceAuthIpRateLimiterCore } from "../cloudflare/device-auth-ip-rate-limiter.ts";

const BUCKET_KEY = "A".repeat(43);

function createSqlMock(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  return {
    rows,
    exec(query, ...bindings) {
      const normalized = query.trimStart();
      if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) return [];
      if (normalized.startsWith("SELECT")) {
        return rows
          .filter((row) => row.bucketKey === bindings[0])
          .sort((left, right) => left.observedAt - right.observedAt)
          .map((row) => ({ observedAt: row.observedAt }));
      }
      if (normalized.startsWith("DELETE")) {
        const [bucketKey, cutoff] = bindings;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index].bucketKey === bucketKey && rows[index].observedAt <= cutoff) rows.splice(index, 1);
        }
        return [];
      }
      if (normalized.startsWith("INSERT")) {
        rows.push({ bucketKey: bindings[0], observedAt: bindings[1] });
        return [];
      }
      throw new Error(`unexpected SQL: ${query}`);
    }
  };
}

function createLimiter(initialRows = []) {
  const sql = createSqlMock(initialRows);
  return { limiter: new DeviceAuthIpRateLimiterCore({ storage: { sql } }), sql };
}

function request(now, body = {
  bucketKey: BUCKET_KEY,
  limit: 5,
  windowMs: 600_000,
  now
}) {
  return new Request("https://device-auth.invalid/check", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

test("Durable Object authority enforces exact 5/600 N/N+1 with same-ms attempts", async () => {
  const { limiter } = createLimiter();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await limiter.fetch(request(1_000));
    const decision = await result.json();
    assert.equal(decision.allowed, true);
    assert.equal(decision.remaining, 5 - attempt);
  }
  const denied = await (await limiter.fetch(request(1_000))).json();
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 600);
  assert.equal(denied.resetAfterSeconds, 600);
  assert.equal(denied.resetAt, 601_000);
});

test("rolling window rejects a boundary burst that a wall-clock fixed window would allow", async () => {
  const { limiter } = createLimiter();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await (await limiter.fetch(request(599_999))).json()).allowed, true);
  }
  const boundary = await (await limiter.fetch(request(600_000))).json();
  assert.equal(boundary.allowed, false);
  assert.equal(boundary.retryAfterSeconds, 600);
  assert.equal(boundary.resetAt, 1_199_999);
});

test("rolling window discards timestamps at the cutoff and then resets", async () => {
  const { limiter } = createLimiter();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await (await limiter.fetch(request(1_000))).json()).allowed, true);
  }
  const reset = await (await limiter.fetch(request(601_000))).json();
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 4);
  assert.equal(reset.retryAfterSeconds, 0);
});

test("corrupt stored buckets fail closed and do not grant a request", async () => {
  const { limiter } = createLimiter([
    { bucketKey: BUCKET_KEY, observedAt: "not-a-timestamp" }
  ]);
  const result = await limiter.fetch(request(1_000));
  assert.equal(result.status, 503);
  assert.match(await result.text(), /authority_unavailable/);
});

test("Durable Object authority rejects malformed, open, and unknown-field input", async () => {
  const { limiter } = createLimiter();
  assert.equal((await limiter.fetch(new Request("https://device-auth.invalid/check"))).status, 404);
  for (const body of [
    "{}",
    JSON.stringify({ bucketKey: BUCKET_KEY, limit: 5, windowMs: 600_000, now: 0, extra: true }),
    JSON.stringify({ bucketKey: BUCKET_KEY, limit: 5, windowMs: 600_000, now: -1 }),
    "{not-json"
  ]) {
    const result = await limiter.fetch(new Request("https://device-auth.invalid/check", {
      method: "POST",
      body
    }));
    assert.equal(result.status, 400);
  }
});
