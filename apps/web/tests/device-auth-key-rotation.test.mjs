import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildIdempotencyDigest, computeKeyThumbprint, sha256Digest } from "../lib/device-auth/crypto.server.ts";
import { DeviceAuthError } from "../lib/device-auth/errors.ts";
import { isDeviceKeyRotationRequest, isDeviceKeyRotationResponse } from "../lib/device-auth/key-rotation-contracts.server.ts";
import { digestRotationIdempotencyKey } from "../lib/device-auth/key-rotation-crypto.server.ts";
import { SupabaseDeviceKeyRotationRepository } from "../lib/device-auth/key-rotation-repository.server.ts";
import { rotateDeviceKey, rotationProofPreimage } from "../lib/device-auth/key-rotation-service.server.ts";
import { POST as rotatePOST } from "../app/api/device-auth/v1/devices/[devicePublicId]/rotate/route.ts";

const DEVICE_ID = "fghijklmnopqrstuvwxyzA";
const DEVICE_PUBLIC_ID = "dev_" + "1".repeat(32);
const ORIGIN = "https://connector.example.test";
const NOW = 1_750_000_000;
const LOOKUP_KEYS = [{ version: 7, key: new Uint8Array(32).fill(7) }];

async function keyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function publicKeyB64(pair) {
  return Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
}

function bodyFor(newPublicKey, newThumbprint) {
  return {
    device_id: DEVICE_ID,
    new_device_public_key: newPublicKey,
    new_device_public_key_thumbprint: newThumbprint,
    audience: "skillmap.connector.v1"
  };
}

async function signedInput(oldPair, newPair, overrides = {}) {
  const oldPublicKey = await publicKeyB64(oldPair);
  const newPublicKey = await publicKeyB64(newPair);
  const oldThumbprint = computeKeyThumbprint(oldPublicKey);
  const newThumbprint = computeKeyThumbprint(newPublicKey);
  const body = bodyFor(newPublicKey, newThumbprint);
  const rawBody = new TextEncoder().encode(JSON.stringify(body));
  const idempotencyKey = overrides.idempotencyKey ?? "QwErTyUiOpAsDfGhJkLzXc";
  const oldNonce = overrides.oldNonce ?? "ZxCvBnMmAsDfGhJkLqWeRt";
  const newNonce = overrides.newNonce ?? "AsDfGhJkLqWeRtYxCvBnMm";
  const path = `/api/device-auth/v1/devices/${DEVICE_PUBLIC_ID}/rotate`;
  const proof = {
    configuredOrigin: ORIGIN,
    path,
    proofSuite: "skillmap.ecdsa-p256-sha256.v2",
    audience: "skillmap.connector.v1",
    proofSuiteHeader: "skillmap.ecdsa-p256-sha256.v2",
    audienceHeader: "skillmap.connector.v1",
    deviceIdHeader: DEVICE_ID,
    bodySha256: sha256Digest(rawBody),
    idempotencyKey,
    oldPurpose: "rotate-old",
    newPurpose: "rotate-new",
    oldNonce,
    newNonce,
    oldIssuedAt: String(NOW),
    newIssuedAt: String(NOW),
    oldSignature: "",
    newSignature: ""
  };
  const oldPreimage = rotationProofPreimage(proof, path, "rotate-old", DEVICE_ID, oldThumbprint, oldNonce, NOW);
  const newPreimage = rotationProofPreimage(proof, path, "rotate-new", DEVICE_ID, newThumbprint, newNonce, NOW, oldThumbprint, newPublicKey);
  proof.oldSignature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, oldPair.privateKey, new TextEncoder().encode(oldPreimage))).toString("base64url");
  proof.newSignature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, newPair.privateKey, new TextEncoder().encode(newPreimage))).toString("base64url");
  return { devicePublicId: DEVICE_PUBLIC_ID, body, proof, rawBody, oldPublicKey, oldThumbprint, newPublicKey, newThumbprint };
}

function fakeRepository(oldPublicKey, oldThumbprint) {
  let active = { publicKey: oldPublicKey, keyThumbprint: oldThumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" };
  const pairings = [
    { pairingId: "old-lineage", keyThumbprint: oldThumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2", state: "pending" },
    { pairingId: "unrelated", keyThumbprint: "sha256:" + "b".repeat(64), proofSuite: "skillmap.ecdsa-p256-sha256.v2", state: "pending" }
  ];
  let winner = null;
  let calls = 0;
  return {
    get calls() { return calls; },
    get active() { return active; },
    get pairings() { return pairings; },
    async getRotationReceipt(_devicePublicId, idempotencyKeys, requestDigest) {
      if (!winner) return null;
      const candidate = idempotencyKeys.find((value) => value.digest === winner.idempotencyKeyDigest && value.version === winner.idempotencyKeyVersion);
      if (!candidate) return null;
      if (winner.requestDigest !== requestDigest) throw new DeviceAuthError("idempotency_conflict");
      return winner.response;
    },
    async getActiveProofKey() { return active; },
    async rotateKey(input) {
      calls += 1;
      if (winner) {
        if (winner.requestDigest !== input.requestDigest) throw new DeviceAuthError("idempotency_conflict");
        return winner.response;
      }
      if (input.oldKeyThumbprint !== active.keyThumbprint) throw new DeviceAuthError("proof_invalid");
      const oldLineage = pairings.find((pairing) => pairing.keyThumbprint === input.oldKeyThumbprint && pairing.proofSuite === input.proofSuite && pairing.state === "pending");
      if (oldLineage) oldLineage.state = "cancelled";
      const response = {
        device_public_id: DEVICE_PUBLIC_ID,
        new_device_public_key_thumbprint: input.newKeyThumbprint,
        rotation_receipt_digest: "sha256:" + "a".repeat(64),
        effective_at: NOW
      };
      winner = { idempotencyKeyDigest: input.idempotencyKeyDigest, idempotencyKeyVersion: input.idempotencyKeyVersion, requestDigest: input.requestDigest, response };
      active = { publicKey: input.newPublicKey, keyThumbprint: input.newKeyThumbprint, proofSuite: input.proofSuite };
      return response;
    }
  };
}

test("valid dual P-256 proofs authorize one same-suite rotation", async () => {
  const oldPair = await keyPair();
  const newPair = await keyPair();
  const oldPublicKey = await publicKeyB64(oldPair);
  const oldThumbprint = computeKeyThumbprint(oldPublicKey);
  const repository = fakeRepository(oldPublicKey, oldThumbprint);
  const input = await signedInput(oldPair, newPair);
  const result = await rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, input);
  assert.equal(result.new_device_public_key_thumbprint, input.newThumbprint);
  assert.equal(repository.calls, 1);
  assert.equal(repository.pairings.find((pairing) => pairing.pairingId === "old-lineage").state, "cancelled");
  assert.equal(repository.pairings.find((pairing) => pairing.pairingId === "unrelated").state, "pending");
  assert.equal(isDeviceKeyRotationResponse(result), true);
  assert.equal(isDeviceKeyRotationRequest(input.body), true);
  const newTranscript = rotationProofPreimage(input.proof, input.proof.path, "rotate-new", DEVICE_ID, input.newThumbprint, input.proof.newNonce, NOW, input.oldThumbprint, input.newPublicKey);
  assert.match(newTranscript, /SKILLMAP-DEVICE-ROTATION-NEW-PROOF-V2/);
  assert.ok(newTranscript.includes(input.oldThumbprint));
  assert.ok(newTranscript.includes(input.newPublicKey));
  assert.notEqual(newTranscript, rotationProofPreimage(input.proof, input.proof.path, "rotate-old", DEVICE_ID, input.oldThumbprint, input.proof.oldNonce, NOW));
});

test("wrong old key, wrong new key, path, body, thumbprint, or suite never reaches mutation", async () => {
  const oldPair = await keyPair();
  const newPair = await keyPair();
  const otherPair = await keyPair();
  const oldPublicKey = await publicKeyB64(oldPair);
  const oldThumbprint = computeKeyThumbprint(oldPublicKey);
  const repository = fakeRepository(oldPublicKey, oldThumbprint);
  const valid = await signedInput(oldPair, newPair);
  const cases = [
    signedInput(otherPair, newPair),
    Promise.resolve({ ...valid, proof: { ...valid.proof, newSignature: "A".repeat(86) } }),
    Promise.resolve({ ...valid, proof: { ...valid.proof, path: "/wrong" } }),
    Promise.resolve({ ...valid, rawBody: new TextEncoder().encode(JSON.stringify({ ...valid.body, device_id: "xxxxxxxxxxxxxxxxxxxxxY" })) }),
    Promise.resolve({ ...valid, body: { ...valid.body, new_device_public_key_thumbprint: "sha256:" + "0".repeat(64) } }),
    Promise.resolve({ ...valid, body: { ...valid.body, new_device_public_key: "A".repeat(122) } }),
    Promise.resolve({ ...valid, proof: { ...valid.proof, proofSuite: "skillmap.ed25519.v1", proofSuiteHeader: "skillmap.ed25519.v1" } })
  ];
  for (const candidate of cases) await assert.rejects(candidate.then((value) => rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, value)));
  assert.equal(repository.calls, 0);
});

test("one concurrent winner leaves one active successor and retires the old proof", async () => {
  const oldPair = await keyPair();
  const newPair = await keyPair();
  const oldPublicKey = await publicKeyB64(oldPair);
  const repository = fakeRepository(oldPublicKey, computeKeyThumbprint(oldPublicKey));
  const input = await signedInput(oldPair, newPair);
  const results = await Promise.allSettled([
    rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, input),
    rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, { ...input, proof: { ...input.proof, idempotencyKey: "LmNoPqRsTuVwXyZaBcDeFg", oldNonce: "VbNmQwErTyUiOpAsDfGhJk" } })
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(results.filter((value) => value.status === "rejected").length, 1);
  assert.equal(repository.calls, 1);
  assert.equal(repository.active.keyThumbprint, input.newThumbprint);
});

test("same idempotency key is safe at the repository boundary and changed digest conflicts", async () => {
  const oldPair = await keyPair();
  const newPair = await keyPair();
  const oldPublicKey = await publicKeyB64(oldPair);
  const repository = fakeRepository(oldPublicKey, computeKeyThumbprint(oldPublicKey));
  const input = await signedInput(oldPair, newPair);
  const first = await rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, input);
  const inputIdempotency = digestRotationIdempotencyKey(LOOKUP_KEYS[0], input.proof.idempotencyKey);
  const replay = await repository.rotateKey({
    devicePublicId: DEVICE_PUBLIC_ID, deviceId: DEVICE_ID, oldKeyThumbprint: input.oldThumbprint,
    newPublicKey: input.newPublicKey, newKeyThumbprint: input.newThumbprint, audience: "skillmap.connector.v1",
    proofSuite: "skillmap.ecdsa-p256-sha256.v2", oldProofPurpose: "rotate-old", newProofPurpose: "rotate-new",
    oldProofNonce: input.proof.oldNonce, newProofNonce: input.proof.newNonce, oldIssuedAt: String(NOW), newIssuedAt: String(NOW),
    requestDigest: buildIdempotencyDigest({ suite: input.proof.proofSuite, method: "POST", origin: ORIGIN, path: input.proof.path, audience: input.proof.audience, operation: "rotate", bodySha256: input.proof.bodySha256, idempotencyKey: input.proof.idempotencyKey }), idempotencyKeyDigest: inputIdempotency.digest, idempotencyKeyVersion: inputIdempotency.version
  }).catch((error) => error);
  assert.deepEqual(replay, first);
  await assert.rejects(repository.rotateKey({
    devicePublicId: DEVICE_PUBLIC_ID, deviceId: DEVICE_ID, oldKeyThumbprint: input.oldThumbprint,
    newPublicKey: input.newPublicKey, newKeyThumbprint: input.newThumbprint, audience: "skillmap.connector.v1",
    proofSuite: "skillmap.ecdsa-p256-sha256.v2", oldProofPurpose: "rotate-old", newProofPurpose: "rotate-new",
    oldProofNonce: input.proof.oldNonce, newProofNonce: input.proof.newNonce, oldIssuedAt: String(NOW), newIssuedAt: String(NOW),
    requestDigest: "sha256:" + "2".repeat(64), idempotencyKeyDigest: inputIdempotency.digest, idempotencyKeyVersion: inputIdempotency.version
  }));
});

test("exact committed retry returns only the receipt while a new request rejects the retired old key", async () => {
  const oldPair = await keyPair();
  const newPair = await keyPair();
  const thirdPair = await keyPair();
  const oldPublicKey = await publicKeyB64(oldPair);
  const repository = fakeRepository(oldPublicKey, computeKeyThumbprint(oldPublicKey));
  const input = await signedInput(oldPair, newPair);
  const first = await rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, input);
  const retry = await rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, input);
  assert.deepEqual(retry, first);
  const fresh = await signedInput(oldPair, thirdPair, { idempotencyKey: "LmNoPqRsTuVwXyZaBcDeFg", oldNonce: "VbNmQwErTyUiOpAsDfGhJk" });
  await assert.rejects(rotateDeviceKey({ repository, lookupKeys: LOOKUP_KEYS, now: () => NOW }, fresh), (error) => error instanceof DeviceAuthError && error.code === "proof_invalid");
});

test("route rejects query, path, content-type, and missing strict proof headers before configuration or mutation", async () => {
  const body = JSON.stringify({});
  const base = `https://connector.example.test/api/device-auth/v1/devices/${DEVICE_PUBLIC_ID}/rotate`;
  const response = (url, init = {}) => rotatePOST(new Request(url, init), { params: Promise.resolve({ devicePublicId: DEVICE_PUBLIC_ID }) });
  assert.equal((await response(`${base}?extra=1`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 400);
  assert.equal((await response(`${base}/wrong`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
  assert.equal((await response(base, { method: "POST", headers: { "content-type": "text/plain" }, body })).status, 400);
  assert.equal((await response(base, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 400);
});

test("structured retired or invalid-grant active-key results are fixed auth rejection, never 503 or detail leakage", async () => {
  for (const error of ["invalid_grant", "retired"]) {
    const repository = new SupabaseDeviceKeyRotationRepository(() => ({
      rpc() { return { single: async () => ({ data: { error, error_description: "internal key detail" }, error: null }) }; }
    }));
    await assert.rejects(repository.getActiveProofKey(DEVICE_ID), (caught) => {
      assert.ok(caught instanceof DeviceAuthError);
      assert.equal(caught.code, "invalid_grant");
      assert.equal(caught.httpStatus, 400);
      assert.equal(caught.message.includes("internal"), false);
      return true;
    });
  }
});

test("rotation idempotency uses a versioned purpose-separated HMAC handle and never passes raw key material to SQL", () => {
  const first = digestRotationIdempotencyKey(LOOKUP_KEYS[0], "QwErTyUiOpAsDfGhJkLzXc");
  const replay = digestRotationIdempotencyKey(LOOKUP_KEYS[0], "QwErTyUiOpAsDfGhJkLzXc");
  const changed = digestRotationIdempotencyKey(LOOKUP_KEYS[0], "LmNoPqRsTuVwXyZaBcDeFg");
  assert.deepEqual(replay, first);
  assert.notEqual(changed.digest, first.digest);
  assert.equal(first.version, 7);
  assert.match(first.digest, /^hmac-sha256:[0-9a-f]{64}$/);
  const sql = readFileSync(new URL("../../../supabase/migrations/20260810050000_skillmap_device_auth_key_rotation.sql", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../lib/device-auth/key-rotation-repository.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /idempotency_key\s+text/);
  assert.doesNotMatch(sql, /p_idempotency_key\s+text/);
  assert.doesNotMatch(repository, /p_idempotency_key\s*:/);
});
