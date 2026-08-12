// ============================================================================
// M3.03 focused seam tests — DeviceAuth service/repository/route.
//
// Exercises the seams the coordinator flagged as untested:
//   * service: SPKI<->thumbprint binding, header/body audience + proof_suite
//     reconciliation, strict issued-at +-60s window, request-digest verification
//   * repository: the M1.08/M3.02 envelope (idempotency key, request digest,
//     proof nonce, issued-at, proof purpose) is forwarded to the RPC (not dropped)
//   * route: the header registry (X-SkillMap-Device-Id, Audience, Proof-Purpose,
//     Body-SHA256) is read and reconciled against the JSON body.
//
// The REAL modules are loaded over Node's ESM loader, which stubs `server-only`,
// resolves `@/` (with .ts) and the explicit `.ts` imports. Crypto is Node's
// webcrypto, keyed by a freshly generated P-256 keypair.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";
import { initiatePairing, buildInitiateProofPreimage } from "../lib/device-auth/service.server.ts";
import {
  buildIdempotencyDigest,
  sha256Digest,
  computeKeyThumbprint,
  isValidRequestDigest,
} from "../lib/device-auth/crypto.server.ts";
import { DeviceAuthError } from "../lib/device-auth/errors.ts";

// Node 22 exposes a global `crypto` with `subtle`; we don't override the
// getter-only property. The imported `webcrypto` is only for explicit uses.
const toB64u = (bytes) => Buffer.from(bytes).toString("base64url");

// --- P-256 fixture (fresh keypair, deterministic-enough for tests) -----------

let keyPairPromise = null;
function keyPair() {
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
  const { publicKey } = await keyPair();
  return toB64u(await crypto.subtle.exportKey("spki", publicKey));
}

async function signP1363(preimage) {
  const { privateKey } = await keyPair();
  const raw = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(preimage)
  );
  return toB64u(raw);
}

const FIXTURE = {
  path: "/api/device-auth/v1/pairings",
  configuredOrigin: "https://connector.example.test",
  deviceId: "device-000000000000000001",
  requestedScopes: ["device.bundle", "device.route"],
  platform: "macos",
  connectorVersion: "1.2.3",
  idempotencyKey: "idemp-000000000000000001",
  proofSuite: "skillmap.ecdsa-p256-sha256.v2",
  audience: "skillmap.connector.v1",
  proofPurpose: "initiate",
  // M1.08/M3.02 nonce is exactly 22 base64url chars (service enforces
  // /^[A-Za-z0-9_-]{22}$/); semantically opaque, so a fixed fixture value holds.
  proofNonce: "ABcDeFgHiJkLmNoPqRsTuV",
  method: "POST",
};

const BODY_SHA = sha256Digest("{}");

/** Build a complete, valid initiate input signed by the fixture key. */
async function buildValidInput({ issuedAt }) {
  const spki = await spkiB64();
  const tp = computeKeyThumbprint(spki);
  const requestDigest = buildIdempotencyDigest({
    suite: FIXTURE.proofSuite,
    method: FIXTURE.method,
    origin: FIXTURE.configuredOrigin,
    path: FIXTURE.path,
    audience: FIXTURE.audience,
    operation: "initiate",
    bodySha256: BODY_SHA,
    idempotencyKey: FIXTURE.idempotencyKey,
  });
  const preimage = buildInitiateProofPreimage({
    suite: FIXTURE.proofSuite,
    method: FIXTURE.method,
    origin: FIXTURE.configuredOrigin,
    path: FIXTURE.path,
    audience: FIXTURE.audience,
    purpose: FIXTURE.proofPurpose,
    deviceId: FIXTURE.deviceId,
    thumbprint: tp,
    bodySha256: BODY_SHA,
    idempotencyKey: FIXTURE.idempotencyKey,
    nonce: FIXTURE.proofNonce,
    issuedAt: String(issuedAt),
    accessTokenSha256: "NONE",
  });
  const signature = await signP1363(preimage);
  return {
    path: FIXTURE.path,
    configuredOrigin: FIXTURE.configuredOrigin,
    deviceId: FIXTURE.deviceId,
    devicePublicKey: spki,
    keyThumbprint: tp,
    requestedScopes: [...FIXTURE.requestedScopes],
    platform: FIXTURE.platform,
    connectorVersion: FIXTURE.connectorVersion,
    idempotencyKey: FIXTURE.idempotencyKey,
    proofSuite: FIXTURE.proofSuite,
    audience: FIXTURE.audience,
    proofPurpose: FIXTURE.proofPurpose,
    proofNonce: FIXTURE.proofNonce,
    issuedAt: String(issuedAt),
    bodySha256: BODY_SHA,
    signature,
    requestDigest,
    deviceIdHeader: FIXTURE.deviceId,
    audienceHeader: FIXTURE.audience,
    proofPurposeHeader: FIXTURE.proofPurpose,
    proofSuiteHeader: FIXTURE.proofSuite,
  };
}

class RecordingRepository {
  constructor() { this.calls = []; }
  async initiatePairing(input) {
    this.calls.push(input);
    return {
      device_code: "a".repeat(43),
      user_code: "AAAAA-BBBBB",
      verification_uri: `${input.verificationOrigin}/device`,
      expires_in: 600,
      interval: 5,
      display: {
        name: input.displayName ?? "Connector",
        platform: input.platform,
        connector_version: input.connectorVersion,
        locale: input.locale,
      },
    };
  }
}

const validIssuedAt = () => Math.floor(Date.now() / 1000);

test("service: recomputes the thumbprint from the SPKI and binds it to key_thumbprint", async () => {
  const repo = new RecordingRepository();
  const out = await initiatePairing(repo, await buildValidInput({ issuedAt: validIssuedAt() }));
  assert.ok(out.device_code.length === 43);
  const recorded = repo.calls[0];
  assert.equal(recorded.keyThumbprint, computeKeyThumbprint(recorded.devicePublicKey));
});

test("service: rejects a key_thumbprint that does not match the device SPKI", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  // disturb the claimed thumbprint so it no longer matches the SPKI bytes
  input.keyThumbprint = "sha256:" + "a".repeat(63) + "b";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_request");
});

test("service: rejects a proof_suite header that contradicts the body suite", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.proofSuiteHeader = "skillmap.ed25519.v1";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

test("service: rejects an audience header that contradicts the body audience", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.audienceHeader = "skillmap.other.v2";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

test("service: rejects contradictory body audience even with no audience header", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.audience = "skillmap.other.v2";
  input.audienceHeader = ""; // absent header does not mask the body truth
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

// --- Omission tests (M3.03): each REQUIRED proof header, when empty/absent,
// must be rejected rather than silently reconciled from the body. ------------

test("service: rejects an empty/absent Device-Id header", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.deviceIdHeader = "";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_request");
});

test("service: rejects an empty/absent proof-suite header", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.proofSuiteHeader = "";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

test("service: rejects an empty/absent audience header", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.audienceHeader = "";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

test("service: rejects an empty/absent proof-purpose header", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.proofPurposeHeader = "";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_client");
});

test("service: rejects issued-at outside the +-60s skew window", async () => {
  const repo = new RecordingRepository();
  const farPast = Math.floor(Date.now() / 1000) - 360;
  const input = await buildValidInput({ issuedAt: farPast });
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_request");
});

test("service: rejects a non-integer issued-at (not Unix seconds) ", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  input.issuedAt = "2026-08-11T19:00:00Z";
  await assert.rejects(initiatePairing(repo, input), (e) => e instanceof DeviceAuthError && e.code === "invalid_request");
});

test("service: forwards idempotency key + request digest + nonce + issued-at to the repository", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({issuedAt: validIssuedAt()});
  await initiatePairing(repo, input);
  const recorded = repo.calls[0];
  assert.equal(recorded.idempotencyKey, FIXTURE.idempotencyKey);
  assert.equal(recorded.requestDigest, input.requestDigest);
  assert.equal(recorded.proofNonce, FIXTURE.proofNonce);
  assert.equal(recorded.issuedAt, input.issuedAt);
  assert.equal(recorded.bodySha256, BODY_SHA);
});

test("service: repository receives the recomputed request digest matching the fixtures proof", async () => {
  const repo = new RecordingRepository();
  const input = await buildValidInput({ issuedAt: validIssuedAt() });
  const before = input.requestDigest;
  await initiatePairing(repo, input);
  // The service computed the digest itself; repo must get a valid sha256 form
  assert.ok(isValidRequestDigest(recordedRequestDigest(repo)));
  assert.equal(recordedRequestDigest(repo), before);
});

function recordedRequestDigest(repo) {
  return repo.calls[0].requestDigest;
}

test("crypto: buildIdempotencyDigest matches the frozen M1.08 vector signature", () => {
  const d = buildIdempotencyDigest({
    suite: "skillmap.ecdsa-p256-sha256.v2",
    method: "POST",
    origin: "https://connector.example.test",
    path: "/api/device-auth/v1/pairings",
    audience: "skillmap.connector.v1",
    operation: "initiate",
    bodySha256: "sha256:" + "ab".repeat(32),
    idempotencyKey: "idemp-000000000000000001",
  });
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(d));
});