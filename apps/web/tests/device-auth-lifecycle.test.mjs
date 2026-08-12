import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { computeKeyThumbprint, sha256Digest } from "../lib/device-auth/crypto.server.ts";
import { buildLifecycleProofPreimage, authenticateAccessToken, getDeviceStatus } from "../lib/device-auth/lifecycle-service.server.ts";
import { deviceAuthLookupKeysFromEnvironment, digestWithLookupCandidates, strictBearerToken } from "../lib/device-auth/lifecycle-crypto.server.ts";

const ORIGIN = "https://connector.example.test";
const DEVICE_ID = "fghijklmnopqrstuvwxyzA";
const TOKEN = "A".repeat(43);
const PUBLIC_ID = `dev_${"1".repeat(32)}`;
const ACCOUNT_ID = `acct_${"2".repeat(32)}`;
const KEY_BYTES = new Uint8Array(32).fill(7);
const LOOKUP = { version: 4, key: KEY_BYTES };

let pairPromise;
function pair() {
  pairPromise ??= crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return pairPromise;
}
async function fixture() {
  const { publicKey, privateKey } = await pair();
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64url");
  const thumbprint = computeKeyThumbprint(spki);
  const rawBody = new TextEncoder().encode(JSON.stringify({ device_id: DEVICE_ID, audience: "skillmap.connector.v1" }));
  const bodySha256 = sha256Digest(rawBody);
  const nonce = "QwErTyUiOpAsDfGhJkLzXc";
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const proof = {
    configuredOrigin: ORIGIN, path: "/api/device-auth/v1/tokens/authenticate", method: "POST",
    proofSuite: "skillmap.ecdsa-p256-sha256.v2", audience: "skillmap.connector.v1", purpose: "authenticate",
    deviceIdHeader: DEVICE_ID, keyThumbprint: "", nonce, issuedAt, bodySha256,
    idempotencyKey: "", accessTokenSha256: sha256Digest(TOKEN), signature: ""
  };
  const preimage = buildLifecycleProofPreimage({ ...proof, origin: ORIGIN, deviceId: DEVICE_ID, thumbprint, accessTokenSha256: sha256Digest(TOKEN) });
  proof.signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(preimage))).toString("base64url");
  return { spki, thumbprint, rawBody, proof };
}

function repository(fixtureValue) {
  return {
    async getActiveProofKey() { return { publicKey: fixtureValue.spki, keyThumbprint: fixtureValue.thumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" }; },
    async authenticate() { return { active: true, device_public_id: PUBLIC_ID, account_public_id: ACCOUNT_ID, scopes: ["device.status"], audience: "skillmap.connector.v1", expires_at: Math.floor(Date.now() / 1000) + 300 }; },
    async getStatus() { return { device_public_id: PUBLIC_ID, account_public_id: ACCOUNT_ID, state: "active", scopes: ["device.status"], expires_at: Math.floor(Date.now() / 1000) + 300, key_thumbprint: fixtureValue.thumbprint }; },
    async cancelPairing() { return { status: "cancelled" }; },
    async revoke() { return { status: "revoked", device_public_id: PUBLIC_ID }; }
  };
}

test("canonical access proof verifies before the lifecycle repository is called", async () => {
  const value = await fixture();
  const { publicKey } = await pair();
  const direct = buildLifecycleProofPreimage({ origin: ORIGIN, path: value.proof.path, method: "POST", purpose: "authenticate", deviceId: DEVICE_ID, thumbprint: value.thumbprint, bodySha256: value.proof.bodySha256, idempotencyKey: "", nonce: value.proof.nonce, issuedAt: value.proof.issuedAt, accessTokenSha256: sha256Digest(TOKEN) });
  assert.equal(direct, buildLifecycleProofPreimage({ ...value.proof, origin: ORIGIN, deviceId: DEVICE_ID, thumbprint: value.thumbprint, accessTokenSha256: sha256Digest(TOKEN) }));
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(value.proof.signature, "base64url"), new TextEncoder().encode(direct)), true);
  let calls = 0;
  const repo = { ...repository(value), async authenticate(input) { calls++; assert.deepEqual(input.p_access_token_key_versions, [4]); return repository(value).authenticate(input); } };
  const result = await authenticateAccessToken({ repository: repo, lookupKeys: [LOOKUP] }, { body: { device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, rawBody: value.rawBody, proof: value.proof, proofAccessToken: TOKEN });
  assert.equal(result.device_public_id, PUBLIC_ID);
  assert.equal(calls, 1);
});

test("access proof binds the bearer hash and path; stolen token and wrong path fail closed", async () => {
  const value = await fixture();
  await assert.rejects(authenticateAccessToken({ repository: repository(value), lookupKeys: [LOOKUP] }, { body: { device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, rawBody: value.rawBody, proof: value.proof, proofAccessToken: "B".repeat(43) }), { code: "proof_invalid" });
  const wrongPath = { ...value.proof, path: "/api/device-auth/v1/tokens/other" };
  await assert.rejects(authenticateAccessToken({ repository: repository(value), lookupKeys: [LOOKUP] }, { body: { device_id: DEVICE_ID, audience: "skillmap.connector.v1" }, rawBody: value.rawBody, proof: wrongPath, proofAccessToken: TOKEN }), { code: "proof_invalid" });
});

test("status requires the exact public path and protected.status proof", async () => {
  const value = await fixture();
  const statusProof = { ...value.proof, path: `/api/device-auth/v1/devices/${PUBLIC_ID}`, purpose: "protected.status", method: "GET", accessTokenSha256: sha256Digest(TOKEN) };
  const emptyBody = new Uint8Array();
  statusProof.bodySha256 = sha256Digest(emptyBody);
  const { publicKey, privateKey } = await pair();
  const preimage = buildLifecycleProofPreimage({ origin: ORIGIN, path: statusProof.path, method: "GET", purpose: "protected.status", deviceId: DEVICE_ID, thumbprint: value.thumbprint, bodySha256: statusProof.bodySha256, idempotencyKey: "", nonce: statusProof.nonce, issuedAt: statusProof.issuedAt, accessTokenSha256: sha256Digest(TOKEN) });
  statusProof.signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(preimage))).toString("base64url");
  const result = await getDeviceStatus({ repository: repository(value), lookupKeys: [LOOKUP] }, { body: undefined, rawBody: emptyBody, proof: statusProof, proofAccessToken: TOKEN }, PUBLIC_ID);
  assert.equal(result.device_public_id, PUBLIC_ID);
  await assert.rejects(getDeviceStatus({ repository: repository(value), lookupKeys: [LOOKUP] }, { body: undefined, rawBody: emptyBody, proof: { ...statusProof, purpose: "revoke" }, proofAccessToken: TOKEN }, PUBLIC_ID), { code: "proof_invalid" });
});

test("bearer grammar and HMAC candidate ring are bounded and purpose-separated", () => {
  assert.equal(strictBearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.throws(() => strictBearerToken(null), { code: "invalid_token" });
  assert.throws(() => strictBearerToken(`bearer ${TOKEN}`));
  assert.throws(() => strictBearerToken(`Bearer ${TOKEN}x`));
  const access = digestWithLookupCandidates([LOOKUP], "access-token", TOKEN).digests[0];
  const idem = digestWithLookupCandidates([LOOKUP], "idempotency-key", TOKEN).digests[0];
  assert.notEqual(access, idem);
  assert.throws(() => digestWithLookupCandidates([LOOKUP, LOOKUP, LOOKUP], "access-token", TOKEN));
});

test("lifecycle SQL is additive, lock-bound, safe-projection, and feature-off", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20260810070000_skillmap_device_auth_lifecycle.sql", import.meta.url), "utf8");
  for (const name of ["device_auth_cancel_v1", "device_auth_authenticate_v1", "device_auth_get_status_v1", "device_auth_revoke_v1"]) assert.match(sql, new RegExp(name));
  assert.match(sql, /security definer set search_path = ''/g);
  assert.match(sql, /pg_advisory_xact_lock/g);
  assert.match(sql, /revoke all on function api\.device_auth_cancel_v1/);
  assert.match(sql, /revoke all on function api\.device_auth_authenticate_v1/);
  assert.match(sql, /revoke all on function api\.device_auth_get_status_v1/);
  assert.match(sql, /revoke all on function api\.device_auth_revoke_v1/);
  assert.doesNotMatch(sql, /access_token\s*[,)]\s*[^_]/i);
});

test("revoke pairing fixture preserves foreign confirmed and ambiguous unconfirmed rows", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20260810070000_skillmap_device_auth_lifecycle.sql", import.meta.url), "utf8");
  const target = { accountId: "account-a", pairingId: "pairing-a" };
  const shouldCancel = (pairing) =>
    (pairing.confirmedUserId !== null && pairing.confirmedUserId === target.accountId)
    || (pairing.confirmedUserId === null && pairing.pairingId === target.pairingId);
  assert.equal(shouldCancel({ confirmedUserId: "account-a", pairingId: "pairing-a" }), true);
  assert.equal(shouldCancel({ confirmedUserId: "account-b", pairingId: "pairing-b" }), false);
  assert.equal(shouldCancel({ confirmedUserId: null, pairingId: "pairing-b" }), false);
  assert.match(sql, /p\.confirmed_user_id\s+is\s+not\s+null\s+and\s+p\.confirmed_user_id\s*=\s*v_device\.account_id/s);
  assert.match(sql, /p\.confirmed_user_id\s+is\s+null\s+and\s+p\.pairing_id\s*=\s*v_family\.pairing_id\s+and\s+p\.key_thumbprint\s*=\s*v_family\.key_thumbprint/s);
  assert.doesNotMatch(sql, /p\.account_public_id\s*=\s*v_family\.account_public_id/);
});
