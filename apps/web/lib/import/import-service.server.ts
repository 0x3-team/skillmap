import "server-only";

import { createHash } from "node:crypto";
import { ImportRouteError } from "./import-errors.server.ts";
import type { ImportAuthContext } from "./import-auth.server.ts";
import { SupabaseImportRepository } from "./import-repository.server.ts";

export type ImportOperation =
  | "prepare-target"
  | "begin"
  | "resume"
  | "prepare-upload"
  | "accept"
  | "receipts"
  | "expire"
  | "finalize";

export interface ImportRouteParams {
  sessionId?: string;
  fileId?: string;
}

const SESSION_ID = /^imp_[0-9a-f]{32}$/;
const FILE_ID = /^msf_[0-9a-f]{32}$/;
const SKILL_ID = /^msk_[0-9a-f]{32}$/;
const VERSION_ID = /^msv_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{22}$/;
const SAFE_PATH = /^[^/\\\x00-\x1f\x7f]+(?:\/[^/\\\x00-\x1f\x7f]+)*$/;
const MAX_IMPORT_FILE_BYTES = 16 * 1024 * 1024;
const SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60_000;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!object(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) throw new ImportRouteError("invalid_request");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ImportRouteError("invalid_request");
  }
  return value;
}

function isoDate(value: unknown): string {
  const input = text(value);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|\+00:00)$/.exec(input);
  if (!match || Number.isNaN(Date.parse(input))) throw new ImportRouteError("invalid_request");
  return `${match[1]}Z`;
}

function optionalDigest(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : text(value, DIGEST);
}

export function importIdempotencyUuid(operation: ImportOperation, key: string): string {
  if (!IDEMPOTENCY.test(key)) throw new ImportRouteError("invalid_request");
  const bytes = createHash("sha256")
    .update(`SKILLMAP-IMPORT-IDEMPOTENCY-V1\n${operation}\n${key}\n`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sessionParams(context: ImportAuthContext, sessionId: string): Record<string, unknown> {
  if (!SESSION_ID.test(sessionId)) throw new ImportRouteError("invalid_request");
  return {
    p_account_public_id: context.accountPublicId,
    p_device_public_id: context.devicePublicId,
    p_session_public_id: sessionId
  };
}

function mapSession(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    session_public_id: text(row.session_id, SESSION_ID),
    state: text(row.state),
    expected_file_count: integer(row.expected_file_count),
    expected_byte_total: integer(row.expected_byte_total),
    accepted_file_count: integer(row.accepted_file_count),
    accepted_byte_total: integer(row.accepted_byte_total),
    revision: integer(row.revision, 1),
    expires_at: isoDate(row.expiry_at)
  };
  const manifestDigest = optionalDigest(row.manifest_digest);
  const contentDigest = optionalDigest(row.content_digest);
  const verificationDigest = optionalDigest(row.verification_digest);
  const finalizationExpectedRevision = row.finalization_expected_revision === undefined
    || row.finalization_expected_revision === null
    ? undefined
    : integer(row.finalization_expected_revision, 1);
  if (manifestDigest) result.manifest_digest = manifestDigest;
  if (contentDigest) result.content_digest = contentDigest;
  if (verificationDigest) result.verification_digest = verificationDigest;
  if (finalizationExpectedRevision !== undefined) {
    result.finalization_expected_revision = finalizationExpectedRevision;
  }
  return result;
}

function parseTargetProjection(value: unknown): {
  displayName: string;
  description: string;
  schemaVersion: string;
  projection: string;
  manifestDigest: string;
  contentDigest: string;
  canonicalMetadata: Record<string, unknown>;
  source: Record<string, unknown>;
  provenanceState: string;
  files: unknown[];
  idempotencyKey: string;
} {
  const keys = [
    "display_name", "description", "manifest_schema_version", "manifest_projection_base64",
    "manifest_digest", "content_digest", "canonical_metadata", "source", "provenance_state", "files",
    "idempotency_key"
  ] as const;
  if (!exact(value, keys)) throw new ImportRouteError("invalid_request");
  const displayName = text(value.display_name);
  const description = text(value.description);
  const schemaVersion = text(value.manifest_schema_version, /^\d+\.\d+$/);
  const encoded = text(value.manifest_projection_base64);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new ImportRouteError("invalid_request");
  }
  const projection = Buffer.from(encoded, "base64");
  if (projection.length < 1 || projection.length > 262_144 || projection.toString("base64") !== encoded) {
    throw new ImportRouteError("invalid_request");
  }
  if (!object(value.canonical_metadata) || !object(value.source) || !Array.isArray(value.files)) {
    throw new ImportRouteError("invalid_request");
  }
  return {
    displayName,
    description,
    schemaVersion,
    projection: `\\x${projection.toString("hex")}`,
    manifestDigest: text(value.manifest_digest, DIGEST),
    contentDigest: text(value.content_digest, DIGEST),
    canonicalMetadata: value.canonical_metadata,
    source: value.source,
    provenanceState: text(value.provenance_state, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    files: value.files,
    idempotencyKey: text(value.idempotency_key, IDEMPOTENCY)
  };
}

function mapPreparedTarget(row: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(row.files)) throw new ImportRouteError("temporarily_unavailable");
  return {
    skill_public_id: text(row.skill_public_id, SKILL_ID),
    version_public_id: text(row.version_public_id, VERSION_ID),
    release_public_id: text(row.release_public_id, /^msr_[0-9a-f]{32}$/),
    manifest_digest: text(row.manifest_digest, DIGEST),
    content_digest: text(row.content_digest, DIGEST),
    file_count: integer(row.file_count, 1),
    byte_total: integer(row.byte_total),
    reused: row.reused === true,
    files: row.files.map((item) => {
      if (!object(item)) throw new ImportRouteError("temporarily_unavailable");
      return {
        file_public_id: text(item.file_public_id, FILE_ID),
        relative_path: text(item.relative_path, SAFE_PATH),
        media_type: text(item.media_type),
        byte_size: integer(item.byte_size),
        file_digest: text(item.file_digest, DIGEST),
        storage_key: text(item.storage_key, /^v1\/msv_[0-9a-f]{32}\/msf_[0-9a-f]{32}$/),
        executable: item.executable === true,
        ordinal: integer(item.ordinal)
      };
    })
  };
}

export async function executeImportOperation(input: {
  operation: ImportOperation;
  body: unknown;
  params: ImportRouteParams;
  context: ImportAuthContext;
  idempotencyKey: string;
  repository: SupabaseImportRepository;
  now?: () => Date;
}): Promise<Record<string, unknown>> {
  const { operation, body, params, context, repository } = input;
  const sessionId = params.sessionId ?? "";
  const base = sessionId ? sessionParams(context, sessionId) : {
    p_account_public_id: context.accountPublicId,
    p_device_public_id: context.devicePublicId
  };

  if (operation === "prepare-target") {
    const parsed = parseTargetProjection(body);
    if (parsed.idempotencyKey !== input.idempotencyKey) throw new ImportRouteError("invalid_request");
    const row = await repository.prepareTarget({
      ...base,
      p_display_name: parsed.displayName,
      p_description: parsed.description,
      p_manifest_schema_version: parsed.schemaVersion,
      p_manifest_projection: parsed.projection,
      p_manifest_digest: parsed.manifestDigest,
      p_content_digest: parsed.contentDigest,
      p_canonical_metadata: parsed.canonicalMetadata,
      p_source: parsed.source,
      p_provenance_state: parsed.provenanceState,
      p_files: parsed.files,
      p_idempotency_key: importIdempotencyUuid(operation, parsed.idempotencyKey)
    });
    return mapPreparedTarget(row);
  }

  if (operation === "begin") {
    const keys = [
      "skill_public_id", "version_public_id", "manifest_schema_version", "manifest_digest", "content_digest",
      "expected_file_count", "expected_byte_total", "idempotency_key", "expires_at"
    ] as const;
    if (!exact(body, keys) || body.idempotency_key !== input.idempotencyKey) throw new ImportRouteError("invalid_request");
    const row = await repository.beginSession({
      ...base,
      p_skill_public_id: text(body.skill_public_id, SKILL_ID),
      p_version_public_id: text(body.version_public_id, VERSION_ID),
      p_manifest_schema_version: text(body.manifest_schema_version),
      p_manifest_digest: text(body.manifest_digest, DIGEST),
      p_content_digest: text(body.content_digest, DIGEST),
      p_expected_file_count: integer(body.expected_file_count, 1),
      p_expected_byte_total: integer(body.expected_byte_total),
      p_idempotency_key: importIdempotencyUuid(operation, input.idempotencyKey),
      p_expiry_at: isoDate(body.expires_at)
    });
    return mapSession(row);
  }

  if (operation === "resume" || operation === "receipts" || operation === "expire") {
    if (!exact(body, [], ["expected_revision"])) throw new ImportRouteError("invalid_request");
    let expectedRevision = body.expected_revision === undefined ? undefined : integer(body.expected_revision, 1);
    if (operation === "expire") {
      if (expectedRevision === undefined) {
        const current = await repository.listReceipts(base);
        if (current === null) throw new ImportRouteError("session_not_found");
        expectedRevision = integer(current.revision, 1);
      }
      const expired = await repository.expireSession({
        ...base,
        p_expected_session_revision: expectedRevision
      });
      if (expired === null) throw new ImportRouteError("session_not_found");
    }
    const row = await repository.listReceipts(base);
    if (row === null) throw new ImportRouteError("session_not_found");
    const authoritativeRevision = integer(row.revision, 1);
    if ((operation === "resume" || operation === "receipts")
      && expectedRevision !== undefined
      && authoritativeRevision !== expectedRevision) {
      throw new ImportRouteError("session_conflict");
    }
    if (operation === "receipts") {
      if (!Array.isArray(row.receipts)) throw new ImportRouteError("temporarily_unavailable");
      return {
        session_public_id: text(row.session_id, SESSION_ID),
        revision: authoritativeRevision,
        receipts: row.receipts.map((item) => {
          if (!object(item)) throw new ImportRouteError("temporarily_unavailable");
          return {
            file_public_id: text(item.file_public_id, FILE_ID),
            relative_path: text(item.relative_path, SAFE_PATH),
            accepted_byte_size: integer(item.accepted_byte_size),
            file_digest: text(item.file_digest, DIGEST),
            ordinal: integer(item.ordinal)
          };
        })
      };
    }
    return mapSession(row);
  }

  if (operation === "prepare-upload") {
    if (!exact(body, [], ["expected_revision"])) throw new ImportRouteError("invalid_request");
    const fileId = text(params.fileId, FILE_ID);
    let revision = body.expected_revision === undefined ? undefined : integer(body.expected_revision, 1);
    if (revision === undefined) {
      const current = await repository.listReceipts(base);
      if (current === null) throw new ImportRouteError("session_not_found");
      revision = integer(current.revision, 1);
    }
    const expiresAt = new Date((input.now?.() ?? new Date()).getTime() + SIGNED_UPLOAD_TTL_MS).toISOString();
    const row = await repository.prepareUpload({
      ...base,
      p_expected_session_revision: revision,
      p_file_public_id: fileId,
      p_expires_at: expiresAt
    });
    const bucketId = text(row.bucket_id);
    const objectName = text(row.object_name, /^v1\/msv_[0-9a-f]{32}\/msf_[0-9a-f]{32}$/);
    const uploadUrl = await repository.createSignedUploadUrl(bucketId, objectName);
    return {
      session_public_id: text(row.session_id, SESSION_ID),
      file_public_id: text(row.file_public_id, FILE_ID),
      version_public_id: text(row.version_public_id, VERSION_ID),
      bucket_id: bucketId,
      object_name: objectName,
      upload_url: uploadUrl,
      upload_expires_at: isoDate(row.expires_at),
      content_type: text(row.content_type),
      declared_size: integer(row.declared_size)
    };
  }

  if (operation === "accept") {
    if (!exact(body, ["expected_revision", "file_digest", "byte_size"])) throw new ImportRouteError("invalid_request");
    const fileId = text(params.fileId, FILE_ID);
    const revision = integer(body.expected_revision, 1);
    const prepared = await repository.prepareUpload({
      ...base,
      p_expected_session_revision: revision,
      p_file_public_id: fileId,
      p_expires_at: new Date((input.now?.() ?? new Date()).getTime() + SIGNED_UPLOAD_TTL_MS).toISOString()
    });
    if (prepared.file_digest !== text(body.file_digest, DIGEST)
      || prepared.declared_size !== integer(body.byte_size)) {
      throw new ImportRouteError("invalid_request");
    }
    const bucketId = text(prepared.bucket_id);
    const objectName = text(prepared.object_name, /^v1\/msv_[0-9a-f]{32}\/msf_[0-9a-f]{32}$/);
    const storedBytes = await repository.readStoredObject(bucketId, objectName);
    if (storedBytes.byteLength > MAX_IMPORT_FILE_BYTES
      || storedBytes.byteLength !== prepared.declared_size
      || `sha256:${createHash("sha256").update(storedBytes).digest("hex")}` !== prepared.file_digest) {
      await repository.enqueueUploadCleanup({
        ...base,
        p_file_public_id: fileId,
        p_cleanup_reason: "stored_object_digest_conflict"
      });
      throw new ImportRouteError("stored_object_conflict");
    }
    return mapSession(await repository.acceptFile({
      ...base,
      p_expected_session_revision: revision,
      p_file_public_id: fileId,
      p_verified_file_digest: prepared.file_digest,
      p_verified_byte_size: storedBytes.byteLength
    }));
  }

  if (operation === "finalize") {
    if (!exact(body, ["expected_revision", "idempotency_key"]) || body.idempotency_key !== input.idempotencyKey) {
      throw new ImportRouteError("invalid_request");
    }
    const expectedRevision = integer(body.expected_revision, 1);
    const row = await repository.finalizeSession({
      ...base,
      p_expected_session_revision: expectedRevision,
      p_idempotency_key: importIdempotencyUuid(operation, input.idempotencyKey)
    });
    return {
      session_public_id: text(row.session_id, SESSION_ID),
      state: row.state === "verified" ? "verified" : text(undefined),
      verification_digest: text(row.verification_digest, DIGEST),
      version_public_id: text(row.version_public_id, VERSION_ID),
      finalized_revision: integer(row.revision, 1),
      owner_consent_id: text(row.owner_consent_id, /^icn_[0-9a-f]{32}$/),
      consent_digest: text(row.consent_digest, DIGEST),
      explicit_consent_at: isoDate(row.explicit_consent_at),
      consent_expires_at: isoDate(row.consent_expires_at),
      cutover_authority_id: `cut_${importIdempotencyUuid("finalize", input.idempotencyKey).replaceAll("-", "")}`
    };
  }

  throw new ImportRouteError("invalid_request");
}
