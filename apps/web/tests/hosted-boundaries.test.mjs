import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthApiError,
  AuthError,
  AuthInvalidJwtError,
  AuthSessionMissingError
} from "@supabase/supabase-js";
import {
  classifyVerifiedClaims,
  shouldRedirectForAuthError
} from "../lib/auth/errors.ts";
import { safeNextPath } from "../lib/auth/paths.ts";
import {
  SupabaseConfigurationError,
  getPublicSupabaseConfig,
  getSiteUrl
} from "../lib/supabase/config.ts";
import {
  SavedSkillsCursorError,
  decodeSavedSkillsCursor,
  encodeSavedSkillsCursor
} from "../lib/registry/saved-cursor.ts";
import { CatalogInputError, CatalogQueryError } from "../lib/registry/errors.ts";
import {
  CatalogFetchAbortError,
  createBoundedCatalogFetch
} from "../lib/security/bounded-fetch.ts";
import {
  PRIVATE_ALPHA_ROBOTS_VALUE,
  buildContentSecurityPolicy,
  buildResponseSecurityHeaders,
  getSupabaseConnectSources,
  isPublicIndexingEnabled
} from "../lib/security/policy.ts";
import { classifyPublicCatalogFailure } from "../lib/security/public-catalog-errors.ts";
import {
  InMemoryFixedWindowRateLimiter,
  applyRateLimitHeaders,
  getAnonymousClientKey,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest
} from "../lib/security/rate-limit.ts";

const APP_ORIGIN = "https://skillmap.invalid";
const SKILL_ID = `skl_${"0".repeat(31)}1`;

test("safe next paths remain same-origin after URL normalization", () => {
  const valid = "/skills/0x3-team/skill-audit?q=quality#evidence";
  assert.equal(safeNextPath(valid), valid);
  assert.equal(new URL(safeNextPath(valid), APP_ORIGIN).origin, APP_ORIGIN);

  for (const hostile of [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/%5cevil.example/",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2e%2e//evil.example",
    "/a/%2e%2e//evil.example",
    "/%"
  ]) {
    const sanitized = safeNextPath(hostile);
    assert.equal(sanitized, "/account", hostile);
    assert.equal(new URL(sanitized, APP_ORIGIN).origin, APP_ORIGIN, hostile);
  }
});

test("verified claims distinguish terminal sessions from retryable auth failures", () => {
  assert.equal(shouldRedirectForAuthError(null), true);
  assert.equal(shouldRedirectForAuthError(new AuthSessionMissingError()), true);
  assert.equal(shouldRedirectForAuthError(new AuthInvalidJwtError("invalid token")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("expired", 400, "session_expired")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("unauthorized", 401, "unexpected_failure")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("forbidden", 403, "unexpected_failure")), true);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("rate limited", 429, "over_request_rate_limit")), false);
  assert.equal(shouldRedirectForAuthError(new AuthApiError("upstream", 503, "unexpected_failure")), false);
  assert.equal(shouldRedirectForAuthError(new AuthError("network unavailable")), false);

  assert.deepEqual(classifyVerifiedClaims({ claims: { sub: "user-1" } }, null), {
    state: "authenticated",
    userId: "user-1"
  });
  assert.equal(classifyVerifiedClaims({ claims: {} }, null).state, "signed-out");
  assert.equal(classifyVerifiedClaims({ claims: { sub: "" } }, null).state, "signed-out");
  assert.equal(classifyVerifiedClaims(null, new AuthApiError("rate limited", 429, "over_request_rate_limit")).state, "unavailable");
});

test("production Supabase and site configuration accepts HTTPS origins only", () => {
  withEnvironment({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SITE_URL: "https://skillmap.example"
  }, () => {
    assert.deepEqual(getPublicSupabaseConfig(), {
      url: "https://project.supabase.co",
      publishableKey: "test-publishable-key"
    });
    assert.equal(getSiteUrl(), "https://skillmap.example");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    assert.equal(getPublicSupabaseConfig().url, "http://127.0.0.1:54321");
    assert.equal(getSiteUrl(), "http://127.0.0.1:3000");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SITE_URL = "https://skillmap.example";

    for (const url of [
      "http://project.supabase.co",
      "https://user:secret@project.supabase.co",
      "https://project.supabase.co/rest/v1",
      "https://project.supabase.co?token=secret",
      "https://project.supabase.co#fragment"
    ]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      assert.throws(() => getPublicSupabaseConfig(), SupabaseConfigurationError, url);
    }

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    for (const url of [
      "http://skillmap.example",
      "https://user:secret@skillmap.example",
      "https://skillmap.example/app",
      "https://skillmap.example?token=secret",
      "https://skillmap.example#fragment"
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = url;
      assert.throws(() => getSiteUrl(), SupabaseConfigurationError, url);
    }
  });

  withEnvironment({
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000"
  }, () => {
    assert.equal(getPublicSupabaseConfig().url, "http://127.0.0.1:54321");
    assert.equal(getSiteUrl(), "http://127.0.0.1:3000");
  });
});

test("saved-skill cursors are exact, versioned, canonical, and account-free", () => {
  const cursor = encodeSavedSkillsCursor({
    savedAt: "2026-07-11T18:00:00.000Z",
    skillId: SKILL_ID
  });
  assert.deepEqual(decodeSavedSkillsCursor(cursor), {
    kind: "saved-skills",
    v: 1,
    savedAt: "2026-07-11T18:00:00.000Z",
    skillId: SKILL_ID
  });
  assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /user|account|email/i);

  const invalidPayloads = [
    { kind: "wrong", v: 1, savedAt: "2026-07-11T18:00:00.000Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 2, savedAt: "2026-07-11T18:00:00.000Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00Z", skillId: SKILL_ID },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00.000Z", skillId: "sk_invalid" },
    { kind: "saved-skills", v: 1, savedAt: "2026-07-11T18:00:00.000Z", skillId: SKILL_ID, extra: true }
  ];
  for (const payload of invalidPayloads) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    assert.throws(() => decodeSavedSkillsCursor(encoded), SavedSkillsCursorError);
  }
  for (const malformed of ["not+a+cursor", "a".repeat(513), "e30"]) {
    assert.throws(() => decodeSavedSkillsCursor(malformed), SavedSkillsCursorError);
  }
});

test("private-alpha indexing fails closed and requires one exact public opt-in", () => {
  for (const value of [undefined, "", "private", "PUBLIC", " public ", "true", "1"]) {
    assert.equal(isPublicIndexingEnabled({ SKILLMAP_INDEXING_MODE: value }), false, String(value));
  }
  assert.equal(isPublicIndexingEnabled({ SKILLMAP_INDEXING_MODE: "public" }), true);

  const privateHeaders = buildResponseSecurityHeaders({
    contentSecurityPolicy: "default-src 'self';",
    https: true,
    publicIndexing: false
  });
  assert.equal(privateHeaders["X-Robots-Tag"], PRIVATE_ALPHA_ROBOTS_VALUE);
  assert.equal(privateHeaders["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");

  const publicHeaders = buildResponseSecurityHeaders({
    contentSecurityPolicy: "default-src 'self';",
    https: false,
    publicIndexing: true
  });
  assert.equal(publicHeaders["X-Robots-Tag"], undefined);
  assert.equal(publicHeaders["Strict-Transport-Security"], undefined);
});

test("nonce CSP is strict, environment-aware, and rejects malformed sources", () => {
  const nonce = "bm9uY2UtZm9yLXRlc3Rz";
  const production = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: "https://project.supabase.co",
    development: false,
    upgradeInsecureRequests: true
  });
  assert.match(production, new RegExp(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`));
  assert.match(production, new RegExp(`style-src 'self' 'nonce-${nonce}'`));
  assert.match(production, new RegExp(`style-src-elem 'self' 'nonce-${nonce}'`));
  assert.match(production, /style-src-attr 'unsafe-inline'/);
  assert.match(production, /connect-src 'self' https:\/\/project\.supabase\.co wss:\/\/project\.supabase\.co/);
  assert.match(production, /frame-ancestors 'none'/);
  assert.match(production, /upgrade-insecure-requests/);
  assert.doesNotMatch(production, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(production, /style-src-elem [^;]*'unsafe-inline'/);
  assert.doesNotMatch(production, /'unsafe-eval'/);

  const development = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: "http://127.0.0.1:54321",
    development: true
  });
  assert.match(development, /connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
  assert.match(development, /'unsafe-eval'/);
  assert.doesNotMatch(development, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(development, /style-src-elem [^;]*'unsafe-inline'/);

  for (const hostile of [
    "https://user:secret@project.supabase.co",
    "https://project.supabase.co/rest/v1",
    "https://project.supabase.co?token=PRIVATE-CANARY",
    "https://project.supabase.co#PRIVATE-CANARY",
    "javascript:alert(1)",
    "https://project.supabase.co\nconnect-src https://evil.example"
  ]) {
    const policy = buildContentSecurityPolicy({ nonce, supabaseUrl: hostile, development: false });
    assert.equal(getSupabaseConnectSources(hostile, false).length, 0, hostile);
    assert.doesNotMatch(policy, /evil\.example|PRIVATE-CANARY|user:secret/, hostile);
    assert.equal(policy.match(/connect-src [^;]+/)?.[0], "connect-src 'self'", hostile);
  }
  assert.throws(
    () => buildContentSecurityPolicy({
      nonce: "validnoncevalue1234'; connect-src https://evil.example",
      development: false
    }),
    TypeError
  );
});

test("catalog rate limiting covers API and server-rendered read paths only", () => {
  for (const pathname of [
    "/skills",
    "/skills/",
    "/skills/0x3-team/skill-audit",
    "/api/v1/skills",
    "/api/v1/skills/skl_00000000000000000000000000000001"
  ]) {
    assert.equal(isPublicCatalogReadRequest(pathname, "GET"), true, pathname);
    assert.equal(isPublicCatalogReadRequest(pathname, "HEAD"), true, pathname);
  }
  for (const [pathname, method] of [
    ["/skills", "POST"],
    ["/skill", "GET"],
    ["/skills-preview", "GET"],
    ["/api/v1/skills-preview", "GET"],
    ["/account", "GET"]
  ]) assert.equal(isPublicCatalogReadRequest(pathname, method), false, `${method} ${pathname}`);

  assert.equal(isPublicCatalogApiPath("/api/v1/skills"), true);
  assert.equal(isPublicCatalogApiPath("/api/v1/skills/example"), true);
  assert.equal(isPublicCatalogApiPath("/skills"), false);
});

test("anonymous rate limiting is bounded, resets deterministically, and emits bounded headers", () => {
  const limiter = new InMemoryFixedWindowRateLimiter({ limit: 2, windowMs: 1_000, maxEntries: 2 });
  assert.deepEqual(limiter.consume("client-a", 10), {
    allowed: true,
    limit: 2,
    remaining: 1,
    retryAfterSeconds: 0,
    resetAfterSeconds: 1,
    resetAt: 1_010
  });
  assert.equal(limiter.consume("client-a", 20).remaining, 0);
  const limited = limiter.consume("client-a", 30);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 1);

  assert.equal(limiter.consume("client-b", 40).allowed, true);
  assert.equal(limiter.consume("client-c", 50).allowed, false, "entry cap must fail closed");
  assert.equal(limiter.consume("client-c", 1_041).allowed, true, "expired entries must be evicted");

  const response = applyRateLimitHeaders(new Response(null), limited);
  assert.equal(response.headers.get("ratelimit-limit"), "2");
  assert.equal(response.headers.get("ratelimit-remaining"), "0");
  assert.equal(response.headers.get("ratelimit-reset"), "1");

  for (const policy of [
    { limit: 0, windowMs: 1_000, maxEntries: 1 },
    { limit: 1, windowMs: Number.NaN, maxEntries: 1 },
    { limit: 1, windowMs: 1_000, maxEntries: -1 }
  ]) assert.throws(() => new InMemoryFixedWindowRateLimiter(policy), TypeError);
});

test("anonymous rate-limit identity prefers provider headers and never exposes raw addresses", () => {
  const providerHeaders = new Headers({
    "x-vercel-forwarded-for": "203.0.113.10",
    "x-real-ip": "203.0.113.20",
    "x-forwarded-for": "203.0.113.30, 198.51.100.1"
  });
  assert.equal(
    getAnonymousClientKey(providerHeaders),
    getAnonymousClientKey(new Headers({ "x-vercel-forwarded-for": "203.0.113.10" }))
  );
  assert.equal(
    getAnonymousClientKey(new Headers({
      "x-vercel-forwarded-for": "not-an-ip",
      "x-real-ip": "203.0.113.20",
      "x-forwarded-for": "203.0.113.30"
    })),
    getAnonymousClientKey(new Headers({ "x-real-ip": "203.0.113.20" }))
  );

  const unknown = getAnonymousClientKey(new Headers({ "x-forwarded-for": "PRIVATE-CANARY" }));
  assert.equal(unknown, getAnonymousClientKey(new Headers()));
  assert.doesNotMatch(unknown, /203\.0\.113|PRIVATE-CANARY/);
  assert.match(unknown, /^[A-Za-z0-9_-]{43}$/);
});

test("public catalog fetch is no-store, aborts on timeout, and redacts target details", async () => {
  let observedInit;
  const successfulFetch = createBoundedCatalogFetch({
    timeoutMs: 100,
    fetchImplementation: async (_input, init) => {
      observedInit = init;
      return new Response("ok", { status: 200 });
    }
  });
  assert.equal((await successfulFetch("https://project.supabase.co/rest/v1/catalog")).status, 200);
  assert.equal(observedInit.cache, "no-store");
  assert.equal(observedInit.signal instanceof AbortSignal, true);

  const timeoutFetch = createBoundedCatalogFetch({
    timeoutMs: 5,
    fetchImplementation: () => new Promise(() => {})
  });
  await assert.rejects(
    timeoutFetch("https://project.supabase.co/rest/v1/catalog?token=PRIVATE-CANARY"),
    (error) => {
      assert.equal(error instanceof CatalogFetchAbortError, true);
      assert.equal(error.name, "AbortError");
      assert.equal(error.code, "ABORT_ERR");
      assert.doesNotMatch(error.message, /project\.supabase\.co|PRIVATE-CANARY/);
      return true;
    }
  );

  for (const timeoutMs of [0, -1, 60_001, 1.5, Number.NaN]) {
    assert.throws(() => createBoundedCatalogFetch({ timeoutMs }), TypeError);
  }
});

test("public catalog failures distinguish retryable upstream 503 from unexpected 500", () => {
  assert.deepEqual(classifyPublicCatalogFailure(new CatalogQueryError()), {
    status: 503,
    code: "CATALOG_UPSTREAM_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  });
  assert.deepEqual(classifyPublicCatalogFailure(new CatalogInputError("INVALID_QUERY", "Bad query.")), {
    status: 400,
    code: "INVALID_QUERY",
    message: "Bad query.",
    retryable: false
  });
  assert.deepEqual(classifyPublicCatalogFailure(new Error("PRIVATE-CANARY")), {
    status: 500,
    code: "CATALOG_UNAVAILABLE",
    message: "The hosted catalog is temporarily unavailable.",
    retryable: true
  });
});

function withEnvironment(values, callback) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
