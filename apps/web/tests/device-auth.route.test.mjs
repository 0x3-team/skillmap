// ============================================================================
// M3.03 route regression test — DeviceAuth POST /api/device-auth/v1/pairings.
//
// Exercises the REAL route (apps/web/app/api/device-auth/v1/pairings/route.ts)
// over Node's ESM loader, with server-only stubbed by the loader, env injected
// so getDeviceAuthServerConfig() resolves, and globalThis.fetch stubbed to
// serve a PostgREST RPC success so the repository's supabase-js client
// completes without any network.
//
// Asserts the contract the coordinator flagged: the FROZEN accepted header
// names X-SkillMap-Device-Audience / -Device-Purpose / -Device-Body-SHA256
// (plus X-SkillMap-Device-Proof-Suite) are read and reconcile against the
// closed body, so an accepted client is NOT rejected; and the RPC receives the
// recomputed request digest in p_request_digest (never the body SHA).
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIdempotencyDigest,
  sha256Digest,
  computeKeyThumbprint,
} from "../lib/device-auth/crypto.server.ts";
import { buildInitiateProofPreimage } from "../lib/device-auth/service.server.ts";

// Server-only env MUST be set before importing the route modules.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.DEVICE_AUTH_VERIFICATION_URL = "https://connector.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test_only_do_not_use_live";

const { POST } = await import("../app/api/device-auth/v1/pairings/route.ts");

const ORIGIN = "https://connector.example.test";
const PATH = "/api/device-auth/v1/pairings";
const AUDIENCE = "skillmap.connector.v1";
const PROOF_SUITE = "skillmap.ecdsa-p256-sha256.v2";
const DEVICE_ID = "fghijklmnopqrstuvwxyzA"; // 22 base64url chars
const IDEMPOTENCY_KEY = "Kx2PzQ9aBvN4MtYrLc7VdW"; // 22 chars
const NONCE = "QwErTyUiOpAsDfGhJkLzXc"; // 22 chars

let keyPairPromise = null;
function kp() {
  if (!keyPairPromise) {
    keyPairPromise = crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
  }
  return keyPairPromise;
}

async function spkiB64() {
  const { publicKey } = await kp();
  return Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64url");
}

async function signB64(preimage) {
  const { privateKey } = await kp();
  const raw = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(preimage)
  );
  return Buffer.from(raw).toString("base64url");
}

function validIssuedAt() {
  return String(Math.floor(Date.now() / 1000));
}

/** Stub globalThis.fetch with a single PostgREST RPC success; record the call. */
function stubRpc() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ?? null });
    // PostgREST `.single()` expects a JSON OBJECT (not an array) for one row.
    return new Response(
      JSON.stringify({
        device_code: "d".repeat(43),
        user_code: "ABCDE-FGHJK",
        verification_uri: `${ORIGIN}/device`,
        expires_in: 600,
        interval: 5,
        display: { name: "Connector", platform: "macos", connector_version: "1.2.3", locale: "en-US" },
        error: null,
        error_description: null,
        retry_after: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Build a fully valid initiation request that the accepted client sends. */
async function buildAcceptedRequest() {
  const spki = await spkiB64();
  const tp = computeKeyThumbprint(spki);
  const issuedAt = validIssuedAt();

  const body = {
    device_id: DEVICE_ID,
    device_public_key: spki,
    key_thumbprint: tp,
    proof_suite: PROOF_SUITE,
    audience: AUDIENCE,
    requested_scopes: ["device.bundle", "device.route"],
    platform: "macos",
    connector_version: "1.2.3",
  };
  // The Body-SHA256 is over the EXACT request bytes, matching the route.
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  const bodySha = sha256Digest(bodyBytes);

  const requestDigest = buildIdempotencyDigest({
    suite: PROOF_SUITE,
    method: "POST",
    origin: ORIGIN,
    path: PATH,
    audience: AUDIENCE,
    operation: "initiate",
    bodySha256: bodySha,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

  const preimage = buildInitiateProofPreimage({
    suite: PROOF_SUITE,
    method: "POST",
    origin: ORIGIN,
    path: PATH,
    audience: AUDIENCE,
    purpose: "initiate",
    deviceId: DEVICE_ID,
    thumbprint: tp,
    bodySha256: bodySha,
    idempotencyKey: IDEMPOTENCY_KEY,
    nonce: NONCE,
    issuedAt,
    accessTokenSha256: "NONE",
  });
  const signature = await signB64(preimage);

  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": IDEMPOTENCY_KEY,
    "x-skillmap-device-id": DEVICE_ID,
    "x-skillmap-device-proof-suite": PROOF_SUITE,
    "x-skillmap-device-audience": AUDIENCE,
    "x-skillmap-device-purpose": "initiate",
    "x-skillmap-device-nonce": NONCE,
    "x-skillmap-device-issued-at": issuedAt,
    "x-skillmap-device-proof": signature,
    "x-skillmap-device-body-sha256": bodySha,
  });

  const request = new Request(ORIGIN + PATH, { method: "POST", headers, body: bodyBytes });
  return { request, requestDigest, bodySha };
}

test("route: accepted client with frozen header names is not rejected and reaches the RPC with the recomputed request digest", async () => {
  const { calls, restore } = stubRpc();
  try {
    const { request, requestDigest, bodySha } = await buildAcceptedRequest();
    const res = await POST(request);
    const text = await res.text();
    assert.equal(res.status, 200, `accepted client must be accepted, got ${res.status}: ${text}`);
    assert.ok(calls.length >= 1, "repository RPC must be invoked");
    const sent = JSON.parse(calls[0].body);
    // The route recomputed the digest server-side; p_request_digest must carry it,
    // never the body SHA of the request.
    assert.equal(sent.p_request_digest, requestDigest, "RPC must receive the recomputed request digest");
    assert.notEqual(sent.p_request_digest, bodySha, "p_request_digest must never be the body sha");
    // The frozen header-parallel values reconcile against the body (accepted client).
    assert.equal(sent.p_audience, AUDIENCE);
    assert.equal(sent.p_proof_suite, PROOF_SUITE);
    assert.equal(sent.p_device_id, DEVICE_ID);
  } finally {
    restore();
  }
});
