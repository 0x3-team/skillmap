import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { executeImportOperation, importIdempotencyUuid } from "../lib/import/import-service.server.ts";
import { authenticateImportRequest } from "../lib/import/import-auth.server.ts";
import { buildLifecycleProofPreimage } from "../lib/device-auth/lifecycle-service.server.ts";
import { computeKeyThumbprint, sha256Digest } from "../lib/device-auth/crypto.server.ts";
import { DeviceAuthError } from "../lib/device-auth/errors.ts";
import { SupabaseImportRepository } from "../lib/import/import-repository.server.ts";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const DEVICE_PUBLIC_ID = `dev_${"b".repeat(32)}`;
const SESSION_ID = `imp_${"c".repeat(32)}`;
const FILE_ID = `msf_${"d".repeat(32)}`;
const VERSION_ID = `msv_${"e".repeat(32)}`;
const SKILL_ID = `msk_${"f".repeat(32)}`;
const RELEASE_ID = `msr_${"1".repeat(32)}`;
const DIGEST = `sha256:${"2".repeat(64)}`;
const CONTENT_DIGEST = `sha256:${"3".repeat(64)}`;
const IDEMPOTENCY_KEY = "A".repeat(22);
const context = { accountPublicId: ACCOUNT_ID, devicePublicId: DEVICE_PUBLIC_ID, scopes: ["device.import"] };

function sessionRow(overrides = {}) {
  return {
    session_id: SESSION_ID,
    state: "in_progress",
    expected_file_count: 1,
    expected_byte_total: 4,
    accepted_file_count: 0,
    accepted_byte_total: 0,
    revision: 1,
    expiry_at: "2026-08-20T12:00:00Z",
    ...overrides
  };
}

test("M4 route service maps a prepared target without internal identifiers", async () => {
  let received;
  const repository = {
    async prepareTarget(params) {
      received = params;
      return {
        skill_public_id: SKILL_ID,
        version_public_id: VERSION_ID,
        release_public_id: RELEASE_ID,
        manifest_digest: DIGEST,
        content_digest: CONTENT_DIGEST,
        file_count: 1,
        byte_total: 4,
        reused: false,
        files: [{
          file_public_id: FILE_ID,
          relative_path: "SKILL.md",
          media_type: "text/markdown; charset=utf-8",
          byte_size: 4,
          file_digest: DIGEST,
          storage_key: `v1/${VERSION_ID}/${FILE_ID}`,
          executable: false,
          ordinal: 0
        }]
      };
    }
  };
  const projection = Buffer.from("{\"schema_version\":\"1.0\"}\n");
  const result = await executeImportOperation({
    operation: "prepare-target",
    body: {
      display_name: "Test skill",
      description: "Test",
      manifest_schema_version: "1.0",
      manifest_projection_base64: projection.toString("base64"),
      manifest_digest: DIGEST,
      content_digest: CONTENT_DIGEST,
      canonical_metadata: { identity: { public_id: "fixture" } },
      source: { kind: "local" },
      provenance_state: "verified",
      files: [{ relative_path: "SKILL.md", media_type: "text/markdown; charset=utf-8", byte_size: 4, file_digest: DIGEST, executable: false, ordinal: 0 }],
      idempotency_key: IDEMPOTENCY_KEY
    },
    params: {}, context, idempotencyKey: IDEMPOTENCY_KEY, repository
  });
  assert.equal(received.p_manifest_projection, `\\x${projection.toString("hex")}`);
  assert.match(received.p_idempotency_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(result).sort(), [
    "byte_total", "content_digest", "file_count", "files", "manifest_digest", "release_public_id",
    "reused", "skill_public_id", "version_public_id"
  ]);
  assert.equal(result.files[0].file_public_id, FILE_ID);
  assert.equal("id" in result, false);
});

test("M4 deterministic idempotency UUID is stable and operation-bound", () => {
  const first = importIdempotencyUuid("begin", IDEMPOTENCY_KEY);
  assert.equal(first, importIdempotencyUuid("begin", IDEMPOTENCY_KEY));
  assert.notEqual(first, importIdempotencyUuid("finalize", IDEMPOTENCY_KEY));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("M4 begin maps the stored pre-finalization revision for verified recovery", async () => {
  const repository = {
    async beginSession() {
      return sessionRow({
        state: "verified",
        accepted_file_count: 1,
        accepted_byte_total: 4,
        revision: 4,
        finalization_expected_revision: 3
      });
    }
  };
  const result = await executeImportOperation({
    operation: "begin",
    body: {
      skill_public_id: SKILL_ID,
      version_public_id: VERSION_ID,
      manifest_schema_version: "1.0",
      manifest_digest: DIGEST,
      content_digest: CONTENT_DIGEST,
      expected_file_count: 1,
      expected_byte_total: 4,
      idempotency_key: IDEMPOTENCY_KEY,
      expires_at: "2026-08-20T12:00:00Z"
    },
    params: {}, context, idempotencyKey: IDEMPOTENCY_KEY, repository
  });

  assert.equal(result.state, "verified");
  assert.equal(result.revision, 4);
  assert.equal(result.finalization_expected_revision, 3);
});

test("M4 normalizes PostgreSQL UTC offsets without truncating fractional precision", async () => {
  const repository = {
    async beginSession() {
      return sessionRow({ expiry_at: "2026-08-20T12:00:00.123456+00:00" });
    }
  };
  const result = await executeImportOperation({
    operation: "begin",
    body: {
      skill_public_id: SKILL_ID,
      version_public_id: VERSION_ID,
      manifest_schema_version: "1.0",
      manifest_digest: DIGEST,
      content_digest: CONTENT_DIGEST,
      expected_file_count: 1,
      expected_byte_total: 4,
      idempotency_key: IDEMPOTENCY_KEY,
      expires_at: "2026-08-20T12:00:00Z"
    },
    params: {}, context, idempotencyKey: IDEMPOTENCY_KEY, repository
  });

  assert.equal(result.expires_at, "2026-08-20T12:00:00.123456Z");
});

test("M4 prepare-upload returns the signed URL and public version binding", async () => {
  const calls = [];
  const repository = {
    async prepareUpload(params) {
      calls.push(params);
      return {
        session_id: SESSION_ID,
        session_revision: 1,
        file_public_id: FILE_ID,
        version_public_id: VERSION_ID,
        bucket_id: "skill-vault-private",
        object_name: `v1/${VERSION_ID}/${FILE_ID}`,
        expires_at: "2026-08-20T12:00:00Z",
        content_type: "text/plain",
        declared_size: 4,
        file_digest: DIGEST,
        ordinal: 0
      };
    },
    async createSignedUploadUrl(bucket, objectName) {
      assert.equal(bucket, "skill-vault-private");
      assert.equal(objectName, `v1/${VERSION_ID}/${FILE_ID}`);
      return `https://storage.example.test/object/upload/sign/${objectName}?token=test`;
    }
  };
  const result = await executeImportOperation({
    operation: "prepare-upload",
    body: { expected_revision: 1 },
    params: { sessionId: SESSION_ID, fileId: FILE_ID },
    context, idempotencyKey: IDEMPOTENCY_KEY, repository,
    now: () => new Date("2026-08-20T11:55:00Z")
  });
  assert.equal(calls[0].p_expected_session_revision, 1);
  assert.equal(result.version_public_id, VERSION_ID);
  assert.match(result.upload_url, /^https:\/\/storage\.example\.test\//);
  assert.equal("upload_authorization" in result, false);
});

test("M4 accept rejects a changed digest before the accept RPC", async () => {
  let accepted = false;
  const repository = {
    async prepareUpload() {
      return { file_digest: DIGEST, declared_size: 4 };
    },
    async acceptFile() {
      accepted = true;
      return sessionRow();
    }
  };
  await assert.rejects(
    executeImportOperation({
      operation: "accept",
      body: { expected_revision: 1, file_digest: CONTENT_DIGEST, byte_size: 4 },
      params: { sessionId: SESSION_ID, fileId: FILE_ID },
      context, idempotencyKey: IDEMPOTENCY_KEY, repository,
      now: () => new Date("2026-08-20T11:55:00Z")
    }),
    (error) => error?.code === "invalid_request"
  );
  assert.equal(accepted, false);
});

test("M4 accept hashes the stored object bytes before the accept RPC", async () => {
  let accepted = false;
  const expectedBytes = new TextEncoder().encode("test");
  const digest = `sha256:${createHash("sha256").update(expectedBytes).digest("hex")}`;
  const repository = {
    async prepareUpload() {
      return {
        bucket_id: "skill-vault-private",
        object_name: `v1/${VERSION_ID}/${FILE_ID}`,
        file_digest: digest,
        declared_size: expectedBytes.byteLength
      };
    },
    async readStoredObject() {
      return new TextEncoder().encode("tampered");
    },
    async acceptFile() {
      accepted = true;
      return sessionRow();
    }
  };

  await assert.rejects(
    executeImportOperation({
      operation: "accept",
      body: { expected_revision: 1, file_digest: digest, byte_size: expectedBytes.byteLength },
      params: { sessionId: SESSION_ID, fileId: FILE_ID },
      context, idempotencyKey: IDEMPOTENCY_KEY, repository,
      now: () => new Date("2026-08-20T11:55:00Z")
    }),
    (error) => error?.code === "invalid_request"
  );
  assert.equal(accepted, false);

  repository.readStoredObject = async () => expectedBytes;
  const result = await executeImportOperation({
    operation: "accept",
    body: { expected_revision: 1, file_digest: digest, byte_size: expectedBytes.byteLength },
    params: { sessionId: SESSION_ID, fileId: FILE_ID },
    context, idempotencyKey: IDEMPOTENCY_KEY, repository,
    now: () => new Date("2026-08-20T11:55:00Z")
  });
  assert.equal(result.session_public_id, SESSION_ID);
  assert.equal(accepted, true);
});

test("M4 expire forwards the exact expected revision to the adapter", async () => {
  const calls = [];
  const repository = {
    async expireSession(params) {
      calls.push(["expire", params]);
      return sessionRow({ state: "expired", revision: 8 });
    },
    async listReceipts(params) {
      calls.push(["receipts", params]);
      return sessionRow({ state: "expired", revision: 8 });
    }
  };
  const result = await executeImportOperation({
    operation: "expire",
    body: { expected_revision: 7 },
    params: { sessionId: SESSION_ID }, context, idempotencyKey: IDEMPOTENCY_KEY, repository
  });
  assert.equal(calls[0][1].p_expected_session_revision, 7);
  assert.equal(result.state, "expired");
  assert.equal(result.revision, 8);
});

test("M4 resume and receipts reject a stale expected revision", async () => {
  const repository = {
    async listReceipts() {
      return sessionRow({ revision: 3, receipts: [] });
    }
  };
  for (const operation of ["resume", "receipts"]) {
    await assert.rejects(
      executeImportOperation({
        operation,
        body: { expected_revision: 2 },
        params: { sessionId: SESSION_ID },
        context,
        idempotencyKey: IDEMPOTENCY_KEY,
        repository
      }),
      (error) => error?.code === "session_conflict"
    );
  }
});

test("M4 receipts return the authoritative session revision", async () => {
  const result = await executeImportOperation({
    operation: "receipts",
    body: { expected_revision: 3 },
    params: { sessionId: SESSION_ID },
    context,
    idempotencyKey: IDEMPOTENCY_KEY,
    repository: {
      async listReceipts() {
        return sessionRow({ revision: 3, receipts: [] });
      }
    }
  });
  assert.equal(result.revision, 3);
});

test("M4 finalize uses one RPC and returns the stored cutover binding", async () => {
  const calls = [];
  const repository = {
    async finalizeSession(params) {
      calls.push(["finalize", params]);
      return {
        session_id: SESSION_ID,
        state: "verified",
        revision: 3,
        verification_digest: DIGEST,
        version_public_id: VERSION_ID,
        owner_consent_id: `icn_${"7".repeat(32)}`,
        consent_digest: `sha256:${"8".repeat(64)}`,
        explicit_consent_at: "2026-08-20T12:00:00.123456+00:00",
        consent_expires_at: "2026-08-20T12:05:00+00:00"
      };
    }
  };
  const result = await executeImportOperation({
    operation: "finalize",
    body: { expected_revision: 2, idempotency_key: IDEMPOTENCY_KEY },
    params: { sessionId: SESSION_ID }, context, idempotencyKey: IDEMPOTENCY_KEY, repository
  });
  assert.deepEqual(calls.map(([name]) => name), ["finalize"]);
  assert.equal(calls[0][1].p_expected_session_revision, 2);
  assert.equal(result.version_public_id, VERSION_ID);
  assert.equal(result.finalized_revision, 3);
  assert.equal(result.owner_consent_id, `icn_${"7".repeat(32)}`);
  assert.equal(result.consent_digest, `sha256:${"8".repeat(64)}`);
  assert.equal(result.explicit_consent_at, "2026-08-20T12:00:00.123456Z");
  assert.equal(result.consent_expires_at, "2026-08-20T12:05:00Z");
  assert.match(result.cutover_authority_id, /^cut_[0-9a-f]{32}$/);
});

test("M4 missing cutover consent maps to the exact owner-consent-required response", async () => {
  const repository = new SupabaseImportRepository(() => ({
    rpc() {
      return {
        async single() {
          return { data: null, error: { message: "import cutover consent required" } };
        }
      };
    },
    storage: {
      from() {
        return { async createSignedUploadUrl() { throw new Error("not used"); } };
      }
    }
  }));
  await assert.rejects(
    repository.finalizeSession({}),
    (error) => error?.code === "owner_consent_required" && error?.status === 409
  );
});

let keyPairPromise;
function keyPair() {
  keyPairPromise ??= crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return keyPairPromise;
}

async function authenticatedRequest(scopes = ["device.import"]) {
  const { publicKey, privateKey } = await keyPair();
  const publicKeyValue = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("base64url");
  const thumbprint = computeKeyThumbprint(publicKeyValue);
  const deviceId = "D".repeat(22);
  const token = "T".repeat(43);
  const nonce = "N".repeat(22);
  const issuedAt = "1787227200";
  const path = "/api/import/v1/sessions";
  const bodyBytes = new TextEncoder().encode("{}");
  const bodySha256 = sha256Digest(bodyBytes);
  const preimage = buildLifecycleProofPreimage({
    method: "POST", origin: "https://skillmap.example.test", path, purpose: "protected.import",
    deviceId, thumbprint, bodySha256, idempotencyKey: IDEMPOTENCY_KEY, nonce, issuedAt,
    accessTokenSha256: sha256Digest(token)
  });
  const signature = Buffer.from(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(preimage)
  )).toString("base64url");
  const request = new Request(`https://skillmap.example.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-skillmap-device-id": deviceId,
      "x-skillmap-device-proof-suite": "skillmap.ecdsa-p256-sha256.v2",
      "x-skillmap-device-audience": "skillmap.connector.v1",
      "x-skillmap-device-purpose": "protected.import",
      "x-skillmap-device-nonce": nonce,
      "x-skillmap-device-issued-at": issuedAt,
      "x-skillmap-device-body-sha256": bodySha256,
      "x-skillmap-device-proof": signature
    },
    body: bodyBytes
  });
  const calls = [];
  const repository = {
    async getActiveProofKey() {
      return { publicKey: publicKeyValue, keyThumbprint: thumbprint, proofSuite: "skillmap.ecdsa-p256-sha256.v2" };
    },
    async authenticateImport(input) {
      calls.push(input);
      return {
        active: true, device_public_id: DEVICE_PUBLIC_ID, account_public_id: ACCOUNT_ID,
        scopes, audience: "skillmap.connector.v1", expires_at: 1787227800
      };
    }
  };
  return { request, bodyBytes, repository, calls };
}

test("M4 import auth verifies the signed protected.import request and requires device.import", async () => {
  const valid = await authenticatedRequest();
  const result = await authenticateImportRequest({
    request: valid.request,
    rawBody: valid.bodyBytes,
    configuredOrigin: "https://skillmap.example.test",
    repository: valid.repository,
    lookupKeys: [{ version: 1, key: new Uint8Array(32).fill(7) }],
    now: () => 1787227200
  });
  assert.deepEqual(result, { accountPublicId: ACCOUNT_ID, devicePublicId: DEVICE_PUBLIC_ID, scopes: ["device.import"] });
  assert.equal(valid.calls[0].p_proof_purpose, "protected.import");
  assert.match(valid.calls[0].p_request_digest, /^sha256:[0-9a-f]{64}$/);

  const denied = await authenticatedRequest(["device.status"]);
  await assert.rejects(
    authenticateImportRequest({
      request: denied.request,
      rawBody: denied.bodyBytes,
      configuredOrigin: "https://skillmap.example.test",
      repository: denied.repository,
      lookupKeys: [{ version: 1, key: new Uint8Array(32).fill(7) }],
      now: () => 1787227200
    }),
    (error) => error instanceof DeviceAuthError && error.code === "insufficient_scope"
  );
});
