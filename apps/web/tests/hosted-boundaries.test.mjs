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
