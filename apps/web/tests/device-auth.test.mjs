import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeScopes,
  normalizeDisplayName,
  normalizeLocale,
  isValidSemVer,
  verificationUriFromOrigin,
  DEVICE_AUTH_SCOPES
} from "../lib/device-auth/contracts.ts";
import {
  DeviceAuthError,
  DeviceAuthUnavailableError,
  DEVICE_AUTH_ERROR_STATUS
} from "../lib/device-auth/errors.ts";
import { redactSecrets, safeDeviceAuthLogLine } from "../lib/device-auth/redaction.ts";
import {
  parseStrictDeviceAuthJson,
  toDeviceAuthRequestError,
  StrictDeviceAuthJsonError,
  DEVICE_AUTH_MAX_BODY_BYTES
} from "../lib/device-auth/raw-json.server.ts";
import { deviceAuthErrorResponse } from "../lib/device-auth/response.server.ts";
import { getDeviceAuthServerConfig, parseDeviceAuthRefreshMode, DeviceAuthConfigurationError } from "../lib/device-auth/config.ts";

// ============================================================================
// M3.03 focused web tests — DeviceAuth pairing seams.
// Pure-logic modules: contracts, errors, redaction, strict raw-JSON parser.
// Server-only seams (service/repository/route/config/crypto.subtle) require a
// runtime that resolves "server-only" and WebCrypto; those are covered by the
// app typecheck and later M3 integration, not this Node unit run.
// ============================================================================

test("canonicalizeScopes: accepted scope set is closed and ordered", () => {
  const out = canonicalizeScopes(["device.bundle", "device.route", "device.route"]);
  assert.deepEqual(out, ["device.bundle", "device.route"]);
});

test("canonicalizeScopes: rejects empty, non-declared, and malformed scopes", () => {
  assert.equal(canonicalizeScopes([]), null);
  assert.equal(canonicalizeScopes(["device.nope"]), null);
  assert.equal(canonicalizeScopes(["notdevice.route"]), null);
  assert.equal(canonicalizeScopes(["DEVICE.ROUTE"]), null);
  assert.equal(canonicalizeScopes(["device.route.initiate"]), null);
});

test("canonicalizeScopes: closed scope list is stable", () => {
  assert.deepEqual([...DEVICE_AUTH_SCOPES].sort(), [
    "device.bundle",
    "device.feedback",
    "device.import",
    "device.route",
    "device.status"
  ]);
});

test("normalizeDisplayName: bounds and control-char stripping", () => {
  assert.equal(normalizeDisplayName("  My Connector  "), "My Connector");
  assert.equal(normalizeDisplayName("a".repeat(64)), "a".repeat(64));
  assert.equal(normalizeDisplayName("a".repeat(65)), null);
  assert.equal(normalizeDisplayName("   "), null);
  assert.equal(normalizeDisplayName("tab\there"), "tabhere");
});

test("normalizeLocale: accepts locales, rejects malformed/oversized", () => {
  assert.equal(normalizeLocale("EN-us"), "en-us");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("en-US.UTF-8"), null);
  assert.equal(normalizeLocale("a".repeat(40)), null);
});

test("isValidSemVer: loose semver gate", () => {
  assert.equal(isValidSemVer("1.2.3"), true);
  assert.equal(isValidSemVer("1.2.3-beta.1"), true);
  assert.equal(isValidSemVer("1.2.3+build"), true);
  assert.equal(isValidSemVer("1.2"), false);
  assert.equal(isValidSemVer("v1.2.3"), false);
  assert.equal(isValidSemVer("1.2.3.4"), false);
});

test("verificationUriFromOrigin: appends /device, strips trailing slash", () => {
  assert.equal(verificationUriFromOrigin("https://skillmap.dev"), "https://skillmap.dev/device");
  assert.equal(verificationUriFromOrigin("https://skillmap.dev/"), "https://skillmap.dev/device");
});

test("DeviceAuthError: carries code, HTTP status mapping, identity", () => {
  const err = new DeviceAuthError("invalid_scope");
  assert.equal(err.code, "invalid_scope");
  assert.equal(err.httpStatus, DEVICE_AUTH_ERROR_STATUS.invalid_scope);
  assert.equal(err.httpStatus, 400);
  assert.ok(err instanceof DeviceAuthError);
  assert.deepEqual(err.toJSON(), {
    error: "invalid_scope",
    error_description: "The requested scope is invalid.",
    retry_after: 0
  });
});

test("DeviceAuthError: status mapping per M1.08", () => {
  assert.equal(DEVICE_AUTH_ERROR_STATUS.invalid_client, 401);
  assert.equal(DEVICE_AUTH_ERROR_STATUS.rate_limited, 429);
  assert.equal(DEVICE_AUTH_ERROR_STATUS.idempotency_conflict, 409);
  assert.equal(DEVICE_AUTH_ERROR_STATUS.temporarily_unavailable, 503);
});

test("DeviceAuthError: retryAfter only on rate_limited / slow_down", () => {
  const rate = new DeviceAuthError("rate_limited", { retryAfter: 5 });
  assert.equal(rate.retryAfter, 5);
  const other = new DeviceAuthError("access_denied", { retryAfter: 9 });
  assert.equal(other.retryAfter, 0);
});

test("DeviceAuthUnavailableError: maps to 503", () => {
  const unavailable = new DeviceAuthUnavailableError("db down");
  assert.equal(unavailable.status, 503);
});

test("redactSecrets: replaces secret-named fields", () => {
  const redacted = redactSecrets({
    device_code: "ABC",
    user_code: "XXXXX-XXXXX",
    idempotency_key: "abc",
    display_name: "keepme"
  });
  assert.deepEqual(redacted, {
    device_code: "[REDACTED]",
    user_code: "[REDACTED]",
    idempotency_key: "[REDACTED]",
    display_name: "keepme"
  });
});

test("redactSecrets: also redacts high-entropy values in any field", () => {
  const redacted = redactSecrets({ note: "sha256:" + "a".repeat(64) });
  assert.equal(redacted.note, "[REDACTED]");
});

test("redactSecrets: removes private paths by field name and value shape", () => {
  const privatePath = "/Users/alice/Library/Application Support/SkillMap/private/device-auth.json";
  const redacted = redactSecrets({
    path: privatePath,
    configPath: "relative/private/config.json",
    message: privatePath,
    windows: "C:\\Users\\alice\\SkillMap\\device-auth.json",
    unc: "\\\\server\\private\\device-auth.json",
    fileUrl: "file:///Users/alice/private/device-auth.json",
    safe: "device-auth unavailable"
  });
  assert.deepEqual(redacted, {
    path: "[REDACTED]",
    configPath: "[REDACTED]",
    message: "[REDACTED]",
    windows: "[REDACTED]",
    unc: "[REDACTED]",
    fileUrl: "[REDACTED]",
    safe: "device-auth unavailable"
  });
});

test("safeDeviceAuthLogLine: never emits secret values", () => {
  const line = safeDeviceAuthLogLine("initiate", "success", {
    deviceId: "skskdkskdks",
    refresh_token: "abc123xyz"
  });
  assert.ok(line.includes("initiate"));
  assert.ok(line.includes("[REDACTED]"));
  assert.ok(!line.includes("abc123xyz"));
});

test("parseStrictDeviceAuthJson: accepts valid nested object", () => {
  const result = parseStrictDeviceAuthJson('{"a":{"b":1}}');
  assert.deepEqual(result, { a: { b: 1 } });
});

test("parseStrictDeviceAuthJson: rejects duplicate keys", () => {
  assert.throws(() => parseStrictDeviceAuthJson('{"a":1,"a":2}'), StrictDeviceAuthJsonError);
});

test("parseStrictDeviceAuthJson: rejects trailing commas and comments", () => {
  assert.throws(() => parseStrictDeviceAuthJson('{"a":1,}'), StrictDeviceAuthJsonError);
  assert.throws(() => parseStrictDeviceAuthJson('{"a":1} /* x */'), StrictDeviceAuthJsonError);
});

test("parseStrictDeviceAuthJson: rejects single quotes", () => {
  assert.throws(() => parseStrictDeviceAuthJson("{'a':1}"), StrictDeviceAuthJsonError);
});

test("parseStrictDeviceAuthJson: rejects depth beyond the bound", () => {
  const deep = "[".repeat(40) + "]" + "]".repeat(40);
  assert.throws(() => parseStrictDeviceAuthJson(deep), StrictDeviceAuthJsonError);
});

test("parseStrictDeviceAuthJson: rejects unescaped control characters in strings", () => {
  const ctrl = String.fromCharCode(0x01); // , a real JSON control char
  const raw = '{"a":"x' + ctrl + 'y"}';
  // The parser rejects c < 0x20 in strings; DEL (0x7f) is permitted by JSON.
  assert.throws(() => parseStrictDeviceAuthJson(raw), StrictDeviceAuthJsonError);
});

test("parseStrictDeviceAuthJson: array round-trips at top level", () => {
  assert.deepEqual(parseStrictDeviceAuthJson("[1,2,3]"), [1, 2, 3]);
});

test("DEVICE_AUTH_MAX_BODY_BYTES: caps the request body", () => {
  assert.equal(DEVICE_AUTH_MAX_BODY_BYTES, 16 * 1024);
});

test("toDeviceAuthRequestError: invalid-body maps to invalid_request", () => {
  const mapped = toDeviceAuthRequestError(new Error("syntax"));
  assert.ok(mapped instanceof DeviceAuthError);
  assert.equal(mapped.code, "invalid_request");
});

test("deviceAuthErrorResponse: strict request errors stay closed 400 responses", async () => {
  const response = deviceAuthErrorResponse(new StrictDeviceAuthJsonError("private parser detail"));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await response.json(), {
    error: "invalid_request",
    error_description: "The request is invalid.",
    retry_after: 0
  });
});

test("refresh configuration accepts only the explicit alpha or exact modes", () => {
  assert.equal(parseDeviceAuthRefreshMode("alpha-single-shot"), "alpha-single-shot");
  assert.equal(parseDeviceAuthRefreshMode("exact-replay"), "exact-replay");
  assert.throws(() => parseDeviceAuthRefreshMode("shared-fake-key"), DeviceAuthConfigurationError);
});

test("hosted alpha configuration uses a bare verification origin and explicit single-shot mode", () => {
  const config = getDeviceAuthServerConfig({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    DEVICE_AUTH_VERIFICATION_URL: "https://skillmap.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only",
    DEVICE_AUTH_REFRESH_MODE: "alpha-single-shot"
  });
  assert.equal(config.verificationUrl, "https://skillmap.example.test");
  assert.equal(config.refreshMode, "alpha-single-shot");
  assert.throws(() => getDeviceAuthServerConfig({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    DEVICE_AUTH_VERIFICATION_URL: "https://skillmap.example.test/device",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only",
    DEVICE_AUTH_REFRESH_MODE: "alpha-single-shot"
  }), DeviceAuthConfigurationError);
});
