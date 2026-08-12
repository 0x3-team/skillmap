import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { sha256Digest } from "../lib/device-auth/crypto.server.ts";
import { computeKeyThumbprint } from "../lib/device-auth/crypto.server.ts";
import { DeviceAuthError, DeviceAuthUnavailableError } from "../lib/device-auth/errors.ts";
import { createRefreshLookupCrypto, openRefreshResponseV1, sealRefreshResponseV1, UnavailableReplayKeyProvider } from "../lib/device-auth/refresh-crypto.server.ts";
import { REFRESH_PATH } from "../lib/device-auth/refresh-contracts.server.ts";
import { refreshDeviceToken } from "../lib/device-auth/refresh-service.server.ts";
import { buildProofPreimageV2 } from "../../../src/contracts/device-auth.ts";

const vector = JSON.parse(fs.readFileSync(new URL("../../../contracts/test-vectors/device-auth-refresh-replay-v1.json", import.meta.url), "utf8"));
const KEY = Uint8Array.from(Buffer.from(vector.key_hex_test_only, "hex"));
const NONCE = Uint8Array.from(Buffer.from(vector.nonce_hex, "hex"));
const NOW = vector.time_cases.response_issued_at;
const DEVICE_ID = "fghijklmnopqrstuvwxyzA";
const FAMILY_ID = "fam_" + "1".repeat(32);
const body = { refresh_token: "R".repeat(43), device_id: DEVICE_ID, audience: "skillmap.connector.v1", token_family_id: FAMILY_ID };
const rawBody = new TextEncoder().encode(JSON.stringify(body));

function proof(idempotencyKey = "QwErTyUiOpAsDfGhJkLzXc", nonce = "ZxCvBnMmAsDfGhJkLqWeRt") {
  return {
    configuredOrigin: "https://connector.example.test", path: REFRESH_PATH,
    proofSuite: "skillmap.ecdsa-p256-sha256.v2", audience: "skillmap.connector.v1", purpose: "refresh",
    proofNonce: nonce, issuedAt: String(NOW), bodySha256: sha256Digest(rawBody), signature: "A".repeat(86),
    proofSuiteHeader: "skillmap.ecdsa-p256-sha256.v2", audienceHeader: "skillmap.connector.v1",
    purposeHeader: "refresh", deviceIdHeader: DEVICE_ID, idempotencyKey
  };
}

async function signedProof(keyPair, publicKey, idempotencyKey = "QwErTyUiOpAsDfGhJkLzXc", nonce = "ZxCvBnMmAsDfGhJkLqWeRt") {
  const publicKeyB64 = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64url");
  const thumbprint = computeKeyThumbprint(publicKeyB64);
  const preimage = buildProofPreimageV2({ method: "POST", origin: "https://connector.example.test", path: REFRESH_PATH, purpose: "refresh", deviceId: DEVICE_ID, thumbprint, bodySha256: sha256Digest(rawBody), idempotencyKey, nonce, issuedAt: NOW, accessTokenSha256: "NONE" });
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, new TextEncoder().encode(preimage))).toString("base64url");
  return { ...proof(idempotencyKey, nonce), signature };
}

test("public vector seals to the exact AES-256-GCM bytes and rejects tampering", async () => {
  const provider = { async get() { return KEY; } };
  const sealed = await sealRefreshResponseV1({
    provider, replayKeyVersion: vector.replay_key_version, responseIssuedAt: NOW,
    replayUntil: vector.time_cases.replay_until_exclusive, runtimePurgeAfter: vector.time_cases.runtime_purge_after,
    aad: new TextEncoder().encode(vector.aad_utf8), body: new TextEncoder().encode(vector.plaintext_utf8), nonce: NONCE
  });
  assert.equal(sealed.ciphertext, vector.ciphertext_and_tag_base64url);
  const opened = await openRefreshResponseV1({ provider, sealed, aad: new TextEncoder().encode(vector.aad_utf8), now: NOW });
  assert.equal(new TextDecoder().decode(opened), vector.plaintext_utf8);
  await assert.rejects(openRefreshResponseV1({ provider, sealed: { ...sealed, ciphertext: (sealed.ciphertext[0] === "A" ? "B" : "A") + sealed.ciphertext.slice(1) }, aad: new TextEncoder().encode(vector.aad_utf8), now: NOW }));
  await assert.rejects(openRefreshResponseV1({ provider, sealed, aad: new TextEncoder().encode(vector.aad_utf8.replace("family-public-01", "family-tampered")), now: NOW }));
  await assert.rejects(openRefreshResponseV1({ provider, sealed, aad: new TextEncoder().encode(vector.aad_utf8), now: vector.time_cases.replay_until_exclusive }));
});

test("one transition gives exact replay bytes and changed digest is a conflict", async () => {
  const replayKeyVersion = Math.floor(NOW / 300);
  const provider = { async get(epochId) { return epochId === replayKeyVersion ? KEY : null; } };
  const randomValues = Array.from({ length: 8 }, (_, index) => Uint8Array.from({ length: 32 }, () => index + 1));
  const lookup = createRefreshLookupCrypto({ key: Uint8Array.from({ length: 32 }, () => 9), keyVersion: 11, randomBytes: (n) => randomValues.shift().subarray(0, n) });
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyB64 = Buffer.from(publicKey).toString("base64url");
  const thumbprint = computeKeyThumbprint(publicKeyB64);
  let committed;
  let failClosed = false;
  const repository = {
    async getActiveProofKey() { return { publicKey: publicKeyB64, keyThumbprint: thumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" }; },
    async failClosed() { failClosed = true; },
    async getRefreshContext() { return { devicePublicId: "dev_" + "2".repeat(32), accountPublicId: "acct_" + "3".repeat(32), tokenFamilyId: FAMILY_ID, currentGeneration: 1, absoluteExpiresAt: NOW + 7_776_000 }; },
    async refreshToken(input) {
      if (committed) {
        if (committed.requestDigest !== input.requestDigest) return { outcome: "idempotency_conflict" };
        return { outcome: "exact_replay", devicePublicId: "dev_" + "2".repeat(32), accountPublicId: "acct_" + "3".repeat(32), tokenFamilyId: FAMILY_ID, priorGeneration: 1, successorGeneration: 2, replay: committed.replay };
      }
      committed = { requestDigest: input.requestDigest, replay: { replayKeyVersion: input.replayKeyVersion, nonce: input.replayNonce, ciphertext: input.replayCiphertext, bodyDigest: input.replayBodyDigest, bodyLength: input.replayBodyLength, responseIssuedAt: input.responseIssuedAt, replayUntil: input.replayUntil, runtimePurgeAfter: input.runtimePurgeAfter, responseFormatVersion: input.responseFormatVersion } };
      return { outcome: "committed", devicePublicId: "dev_" + "2".repeat(32), accountPublicId: "acct_" + "3".repeat(32), tokenFamilyId: FAMILY_ID, priorGeneration: 1, successorGeneration: 2, responseIssuedAt: NOW };
    }
  };
  const deps = { repository, lookupCrypto: lookup, replayKeys: provider, now: () => NOW, randomBytes: (n) => NONCE.subarray(0, n) };
  const first = await refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(keyPair, keyPair.publicKey) });
  const retry = await refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(keyPair, keyPair.publicKey, "QwErTyUiOpAsDfGhJkLzXc", "QwErTyUiOpAsDfGhJkLzXc") });
  assert.deepEqual([...retry.body], [...first.body]);
  committed.replay.ciphertext = (committed.replay.ciphertext[0] === "A" ? "B" : "A") + committed.replay.ciphertext.slice(1);
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(keyPair, keyPair.publicKey, "QwErTyUiOpAsDfGhJkLzXc", "AsDfGhJkLzXcVbNmQwErTy") }), (error) => error instanceof DeviceAuthError && error.code === "temporarily_unavailable");
  assert.equal(failClosed, true);
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(keyPair, keyPair.publicKey, "LmNoPqRsTuVwXyZaBcDeFg", "VbNmQwErTyUiOpAsDfGhJk") }), (error) => error instanceof DeviceAuthError && error.code === "idempotency_conflict");
});

test("unavailable replay provider fails closed before the refresh transition", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKeyB64 = Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64url");
  const thumbprint = computeKeyThumbprint(publicKeyB64);
  let transitions = 0;
  const repository = {
    async getActiveProofKey() { return { publicKey: publicKeyB64, keyThumbprint: thumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" }; },
    async getRefreshContext() { return { devicePublicId: "dev_" + "2".repeat(32), accountPublicId: "acct_" + "3".repeat(32), tokenFamilyId: FAMILY_ID, currentGeneration: 1, absoluteExpiresAt: NOW + 7_776_000 }; },
    async refreshToken() { transitions += 1; return { outcome: "committed" }; }
  };
  const lookup = createRefreshLookupCrypto({ key: Uint8Array.from({ length: 32 }, () => 9), keyVersion: 11, randomBytes: (n) => Uint8Array.from({ length: n }, () => 7) });
  const deps = { repository, lookupCrypto: lookup, replayKeys: new UnavailableReplayKeyProvider(), now: () => NOW, randomBytes: (n) => NONCE.subarray(0, n) };
  await assert.rejects(
    refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(keyPair, keyPair.publicKey) }),
    (error) => error instanceof DeviceAuthUnavailableError && error.status === 503
  );
  assert.equal(transitions, 0, "no token-family transition is allowed without replay sealing");
});

test("fabricated, wrong-path, wrong-body, and wrong-key proofs never reach refresh transition", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKeyB64 = Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64url");
  const thumbprint = computeKeyThumbprint(publicKeyB64);
  let transitions = 0;
  const repository = {
    async getActiveProofKey() { return { publicKey: publicKeyB64, keyThumbprint: thumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" }; },
    async refreshToken() { transitions += 1; return { outcome: "unavailable" }; }
  };
  const lookup = createRefreshLookupCrypto({ key: Uint8Array.from({ length: 32 }, () => 7), keyVersion: 11 });
  const deps = { repository, lookupCrypto: lookup, replayKeys: { async get() { return KEY; } }, now: () => NOW, randomBytes: (n) => NONCE.subarray(0, n) };
  const valid = await signedProof(keyPair, keyPair.publicKey);
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: { ...valid, signature: "A".repeat(86) } }));
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: { ...valid, path: "/wrong" } }));
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: { ...valid, bodySha256: "sha256:" + "0".repeat(64) } }));
  const otherKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  await assert.rejects(refreshDeviceToken(deps, { body, rawBody, proof: await signedProof(otherKey, otherKey.publicKey) }));
  assert.equal(transitions, 0);
});
