import assert from "node:assert/strict";
import { test } from "node:test";

import { createDeviceAuthTokenCrypto } from "../lib/device-auth/poll-exchange-crypto.server.ts";
import { exchangePairing, pollPairing } from "../lib/device-auth/poll-exchange-service.server.ts";
import { computeKeyThumbprint, sha256Digest } from "../lib/device-auth/crypto.server.ts";
import { isExchangeRequest, isPollRequest, isPollSuccess } from "../lib/device-auth/poll-exchange-contracts.server.ts";
import { SupabaseDeviceAuthPollExchangeRepository } from "../lib/device-auth/poll-exchange-repository.server.ts";
import { buildProofPreimageV2 } from "../../../src/contracts/device-auth.ts";

const DEVICE_ID = "fghijklmnopqrstuvwxyzA";
let keyPairPromise;
const keyPair = () => keyPairPromise ??= crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const proof = async (purpose) => {
  const { publicKey, privateKey } = await keyPair();
  const publicKeyBase64 = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64url");
  const keyThumbprint = computeKeyThumbprint(publicKeyBase64);
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const bodySha256 = sha256Digest("{}");
  const base = {
  configuredOrigin: "https://connector.example.test",
  path: `/api/device-auth/v1/pairings/${purpose}`,
  proofSuite: "skillmap.ecdsa-p256-sha256.v2",
  audience: "skillmap.connector.v1",
  purpose,
  proofNonce: "QwErTyUiOpAsDfGhJkLzXc",
  issuedAt,
  bodySha256,
  proofSuiteHeader: "skillmap.ecdsa-p256-sha256.v2",
  audienceHeader: "skillmap.connector.v1",
  purposeHeader: purpose,
  deviceIdHeader: DEVICE_ID,
  idempotencyKey: "Kx2PzQ9aBvN4MtYrLc7VdW"
  };
  const preimage = buildProofPreimageV2({ suite: base.proofSuite, method: "POST", origin: base.configuredOrigin, path: base.path, audience: base.audience, purpose, deviceId: DEVICE_ID, thumbprint: keyThumbprint, bodySha256, idempotencyKey: base.idempotencyKey, nonce: base.proofNonce, issuedAt: Number(issuedAt), accessTokenSha256: "NONE" });
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(preimage))).toString("base64url");
  return { ...base, signature, keyThumbprint, publicKey: publicKeyBase64 };
};
const proofKey = async (value) => ({ publicKey: value.publicKey, keyThumbprint: value.keyThumbprint, proofSuite: value.proofSuite });

test("poll/exchange contracts are closed and reject raw-shaped or extra fields", () => {
  assert.equal(isPollRequest({ device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }), true);
  assert.equal(isPollRequest({ device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1", secret: "leak" }), false);
  assert.equal(isExchangeRequest({
    exchange_code: "A".repeat(43), device_id: DEVICE_ID, device_public_key_thumbprint: "sha256:" + "b".repeat(64),
    audience: "skillmap.connector.v1", requested_scopes: ["device.route"]
  }), true);
});

test("repository strips RPC envelope metadata before validating the public success shape", async () => {
  const repository = new SupabaseDeviceAuthPollExchangeRepository(() => ({
    rpc() { return { single: async () => ({ data: { exchange_code: "A".repeat(43), expires_in: 600, scopes: ["device.route"], error: null, error_description: null, retry_after: 0 }, error: null }) }; }
  }));
  assert.deepEqual(await repository.pollPairing({ deviceCodeDigest: "a".repeat(64), deviceId: DEVICE_ID, audience: "skillmap.connector.v1", proofSuite: "skillmap.ecdsa-p256-sha256.v2", proofPurpose: "poll", proofNonce: "QwErTyUiOpAsDfGhJkLzXc", issuedAt: String(Math.floor(Date.now() / 1000)), requestDigest: "sha256:" + "b".repeat(64), idempotencyKey: "Kx2PzQ9aBvN4MtYrLc7VdW" }), { exchange_code: "A".repeat(43), expires_in: 600, scopes: ["device.route"] });
});

test("poll success contract rejects a near-expiry zero-second grant", () => {
  assert.equal(isPollSuccess({ exchange_code: "A".repeat(43), expires_in: 0, scopes: ["device.route"] }), false);
});

test("poll binds device and preserves stable pending/slow-down/approved terminal outcomes", async () => {
  const calls = [];
  const repo = { async pollPairing(input) { calls.push(input); return { exchange_code: "B".repeat(43), expires_in: 600, scopes: ["device.route"] }; } };
  const validProof = await proof("poll");
  const validProofKey = await proofKey(validProof);
  const out = await pollPairing(repo, { device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, validProof, validProofKey);
  assert.equal(out.exchange_code, "B".repeat(43));
  assert.equal(calls[0].deviceId, DEVICE_ID);
  await assert.rejects(
    pollPairing(repo, { device_code: "A".repeat(43), device_id: "other-device-id-000000", audience: "skillmap.connector.v1" }, validProof, validProofKey),
    (error) => error?.code === "proof_invalid"
  );
});

test("poll and exchange reject fabricated, wrong-path, and wrong-key proofs before operation RPC", async () => {
  let operationCalls = 0;
  const repo = { async pollPairing() { operationCalls += 1; return { exchange_code: "B".repeat(43), expires_in: 600, scopes: ["device.route"] }; }, async exchangePairing() { operationCalls += 1; throw new Error("must not call"); } };
  const valid = await proof("poll");
  const key = await proofKey(valid);
  await assert.rejects(pollPairing(repo, { device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, { ...valid, signature: "A".repeat(86) }, key), (error) => error?.code === "proof_invalid");
  await assert.rejects(pollPairing(repo, { device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, { ...valid, path: "/wrong" }, key), (error) => error?.code === "proof_invalid");
  keyPairPromise = null;
  const wrongKey = await proof("poll");
  await assert.rejects(pollPairing(repo, { device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, wrongKey, key), (error) => error?.code === "proof_invalid");
  assert.equal(operationCalls, 0);
});

test("exchange generates independent raw credentials in memory and sends only HMAC digests", async () => {
  const calls = [];
  const crypto = createDeviceAuthTokenCrypto({
    key: new Uint8Array(32).fill(7), keyVersion: 9,
    randomBytes: (() => { const values = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)]; return () => values.shift(); })()
  });
  const repo = { async exchangePairing(input) { calls.push(input); return {
    device_public_id: "dev_" + "1".repeat(32), account_public_id: "acct_" + "2".repeat(32), token_family_id: "fam_" + "3".repeat(32),
    access_token: "", refresh_token: "", expires_in: 600, refresh_idle_expires_in: 2592000, refresh_absolute_expires_in: 7776000
  }; } };
  const validProof = await proof("exchange");
  const out = await exchangePairing(repo, {
    exchange_code: "C".repeat(43), device_id: DEVICE_ID, device_public_key_thumbprint: validProof.keyThumbprint,
    audience: "skillmap.connector.v1", requested_scopes: ["device.route"]
  }, validProof, crypto, await proofKey(validProof));
  assert.match(out.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(out.refresh_token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(out.access_token, out.refresh_token);
  assert.match(calls[0].accessTokenDigest, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.match(calls[0].refreshTokenDigest, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(calls[0], "accessToken"), false);
  assert.equal(Object.hasOwn(calls[0], "refreshToken"), false);
});

test("terminal poll outcomes are passed through without widening the error surface", async () => {
  const validProof = await proof("poll");
  const validProofKey = await proofKey(validProof);
  for (const code of ["authorization_pending", "slow_down", "access_denied", "expired_token"]) {
    const repo = { async pollPairing() { const error = new Error(code); error.code = code; throw error; } };
    await assert.rejects(
      pollPairing(repo, { device_code: "A".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, validProof, validProofKey),
      (error) => error?.code === code
    );
  }
});

test("two concurrent exchange callers share one repository transition and cannot create two lineages", async () => {
  let committed = false;
  const crypto = createDeviceAuthTokenCrypto({ key: new Uint8Array(32).fill(8), keyVersion: 1 });
  const repo = { async exchangePairing(input) {
    if (committed) { const error = new Error("already consumed"); error.code = "already_consumed"; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (committed) { const error = new Error("already consumed"); error.code = "already_consumed"; throw error; }
    committed = true;
    return { device_public_id: "dev_" + "1".repeat(32), account_public_id: "acct_" + "2".repeat(32), token_family_id: "fam_" + "3".repeat(32), access_token: "", refresh_token: "", expires_in: 600, refresh_idle_expires_in: 2592000, refresh_absolute_expires_in: 7776000 };
  } };
  const validProof = await proof("exchange");
  const validProofKey = await proofKey(validProof);
  const input = { exchange_code: "C".repeat(43), device_id: DEVICE_ID, device_public_key_thumbprint: validProof.keyThumbprint, audience: "skillmap.connector.v1", requested_scopes: ["device.route"] };
  const secondProof = await proof("exchange");
  const results = await Promise.allSettled([exchangePairing(repo, input, validProof, crypto, validProofKey), exchangePairing(repo, input, secondProof, crypto, validProofKey)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.code === "already_consumed").length, 1);
});
