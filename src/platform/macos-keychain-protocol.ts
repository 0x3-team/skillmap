import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** The body of a helper frame is deliberately small and bounded. */
export const MACOS_HELPER_MAX_FRAME_BYTES = 8 * 1024;
export const MACOS_CREDENTIAL_RECORD_MAX_BYTES = 4 * 1024;
export const MACOS_HELPER_MAGIC = 'SKMP';
export const MACOS_CREDENTIAL_MAGIC = 'SKCR';
export const MACOS_PENDING_MAGIC = 'SKPN';
export const MACOS_HELPER_PROTOCOL_VERSION = 1;
export const MACOS_HELPER_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export type MacOSHelperOperation =
  | 'create_key' | 'public_key' | 'sign' | 'exists_key' | 'delete_key'
  | 'credential_load' | 'credential_commit_exchange' | 'credential_mark_refresh_pending'
  | 'credential_commit_refresh' | 'credential_delete'
  | 'metadata_load' | 'metadata_save' | 'metadata_delete';

/** Registry is closed; credential operations are the five operations below. */
export const MACOS_HELPER_OPERATIONS: readonly MacOSHelperOperation[] = [
  'create_key', 'public_key', 'sign', 'exists_key', 'delete_key',
  'credential_load', 'credential_commit_exchange', 'credential_mark_refresh_pending',
  'credential_commit_refresh', 'credential_delete',
  'metadata_load', 'metadata_save', 'metadata_delete'
];
export const MACOS_KEY_OPERATIONS: readonly MacOSHelperOperation[] = ['create_key', 'public_key', 'sign', 'exists_key', 'delete_key'];
export const MACOS_CREDENTIAL_OPERATIONS: readonly MacOSHelperOperation[] = [
  'credential_load', 'credential_commit_exchange', 'credential_mark_refresh_pending',
  'credential_commit_refresh', 'credential_delete'
];

const OPERATION_CODE: Record<MacOSHelperOperation, number> = {
  create_key: 1, public_key: 2, sign: 3, exists_key: 4, delete_key: 5,
  credential_load: 16, credential_commit_exchange: 17, credential_mark_refresh_pending: 18,
  credential_commit_refresh: 19, credential_delete: 20,
  metadata_load: 32, metadata_save: 33, metadata_delete: 34
};
const CODE_OPERATION = new Map(Object.entries(OPERATION_CODE).map(([name, code]) => [code, name as MacOSHelperOperation]));
const DOMAIN_KEY = 1;
const DOMAIN_CREDENTIAL = 2;
const DOMAIN_METADATA = 3;
const DOMAIN_BY_OPERATION = new Map<MacOSHelperOperation, number>([
  ...MACOS_KEY_OPERATIONS.map((op) => [op, DOMAIN_KEY] as const),
  ...MACOS_CREDENTIAL_OPERATIONS.map((op) => [op, DOMAIN_CREDENTIAL] as const),
  ['metadata_load', DOMAIN_METADATA], ['metadata_save', DOMAIN_METADATA], ['metadata_delete', DOMAIN_METADATA]
]);

export interface MacOSHelperRequest {
  version: 1;
  namespace: string;
  operation: MacOSHelperOperation;
  payload?: Record<string, unknown>;
}

export interface MacOSHelperResponse {
  version: 1;
  ok: boolean;
  /** Present on the wire; optional keeps the fake transport source compatible. */
  operation?: MacOSHelperOperation;
  /** Local transport context; not serialized in the native frame. */
  namespace?: string;
  result?: Record<string, unknown>;
  error?: { code: string };
}

const SAFE_ERROR_CODES = new Set([
  'helper_error', 'unsupported_platform', 'helper_unavailable', 'helper_timeout', 'helper_output_too_large',
  'helper_spawn_failed', 'helper_failed', 'helper_malformed_reply', 'request_shape', 'request_header',
  'request_operation', 'request_payload', 'response_shape', 'response_header', 'response_error',
  'protocol_error', 'frame_truncated', 'frame_length', 'frame_size_mismatch', 'frame_magic', 'frame_version',
  'frame_domain', 'frame_operation', 'frame_kind', 'frame_fields', 'field_truncated', 'field_order_or_length',
  'field_unknown', 'field_utf8', 'record_invalid', 'record_corrupt', 'record_too_large', 'pending_invalid',
  'pending_corrupt', 'credential_corrupt', 'credential_query_failed', 'credential_write_failed',
  'credential_lock_timeout', 'credential_delete_failed', 'credential_generation_conflict',
  'credential_pending_conflict', 'credential_commit_conflict', 'credential_family_expiry_conflict',
  'key_query_failed', 'key_public_failed', 'key_create_failed', 'key_delete_failed', 'sign_failed',
  'not_found', 'malformed_public_key', 'malformed_key_state', 'metadata_shape', 'metadata_corrupt',
  'metadata_query_failed', 'metadata_write_failed', 'metadata_delete_failed', 'interaction_not_allowed', 'secure_storage_unavailable'
]);

function fixedError(code: string): string { return SAFE_ERROR_CODES.has(code) ? code : 'protocol_error'; }
function utf8(value: string, label = 'field_utf8'): Buffer {
  if (typeof value !== 'string') throw new Error(label);
  const bytes = Buffer.from(value, 'utf8');
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (decoded !== value) throw new Error(label);
  return bytes;
}
function text(bytes: Uint8Array): string {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!Buffer.from(value, 'utf8').equals(Buffer.from(bytes))) throw new Error('field_utf8');
    return value;
  } catch { throw new Error('field_utf8'); }
}
function u64(value: unknown, label = 'record_invalid'): Buffer {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(label);
  const out = Buffer.alloc(8); out.writeBigUInt64BE(BigInt(value)); return out;
}
function readU64(bytes: Uint8Array, label = 'record_corrupt'): number {
  if (bytes.length !== 8) throw new Error(label);
  const value = Buffer.from(bytes).readBigUInt64BE();
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(label);
  return Number(value);
}
function sha256(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest(); }
function bytes32(value: unknown, fallback: Buffer): Buffer {
  if (value === undefined) return fallback;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const b = Buffer.from(value); if (b.length !== 32) throw new Error('record_invalid'); return b;
  }
  if (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) return Buffer.from(value, 'hex');
  throw new Error('record_invalid');
}
function ascii(value: unknown, pattern: RegExp, length: number, label = 'record_invalid'): Buffer {
  if (typeof value !== 'string' || !pattern.test(value) || Buffer.byteLength(value, 'ascii') !== length) throw new Error(label);
  return Buffer.from(value, 'ascii');
}

interface TLV { id: number; bytes: Buffer }
function tlv(fields: TLV[], max: number): Buffer {
  let previous = 0;
  const chunks: Buffer[] = [];
  for (const field of fields) {
    if (!Number.isInteger(field.id) || field.id <= previous || field.id > 255) throw new Error('field_order_or_length');
    if (field.bytes.length > 0xffff) throw new Error('field_length');
    const header = Buffer.alloc(3); header[0] = field.id; header.writeUInt16BE(field.bytes.length, 1);
    chunks.push(header, field.bytes); previous = field.id;
  }
  const body = Buffer.concat(chunks);
  if (body.length > max) throw new Error(max === MACOS_CREDENTIAL_RECORD_MAX_BYTES ? 'record_too_large' : 'frame_too_large');
  return body;
}
function parseTLV(body: Uint8Array, max: number): TLV[] {
  const bytes = Buffer.from(body); if (bytes.length > max) throw new Error(max === MACOS_CREDENTIAL_RECORD_MAX_BYTES ? 'record_too_large' : 'frame_length');
  const fields: TLV[] = []; let offset = 0; let previous = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 3) throw new Error('field_truncated');
    const id = bytes[offset++]; const length = bytes.readUInt16BE(offset); offset += 2;
    if (id <= previous) throw new Error('field_order_or_length');
    if (bytes.length - offset < length) throw new Error('field_truncated');
    fields.push({ id, bytes: Buffer.from(bytes.subarray(offset, offset + length)) }); previous = id; offset += length;
  }
  return fields;
}
function fieldMap(fields: TLV[], allowed: Set<number>): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  for (const field of fields) { if (!allowed.has(field.id)) throw new Error('field_unknown'); if (out.has(field.id)) throw new Error('field_order_or_length'); out.set(field.id, field.bytes); }
  return out;
}
function expectedRequestFields(operation: MacOSHelperOperation): Set<number> {
  if (operation === 'sign' || operation === 'credential_commit_exchange' || operation === 'credential_mark_refresh_pending' || operation === 'metadata_save') return new Set([1, 2]);
  if (operation === 'credential_commit_refresh') return new Set([1, 2, 3]);
  return new Set([1]);
}
function expectedResponseFields(operation: MacOSHelperOperation, ok: boolean): Set<number> {
  if (!ok) return new Set([250]);
  if (operation === 'exists_key' || operation === 'create_key' || operation === 'public_key' || operation === 'sign' || operation === 'credential_mark_refresh_pending' || operation === 'metadata_load') return new Set([1]);
  return new Set([1, 2]);
}
function framed(body: Buffer, label = 'frame'): Buffer {
  if (body.length === 0 || body.length > MACOS_HELPER_MAX_FRAME_BYTES - 4) throw new Error(label === 'record' ? 'record_too_large' : 'frame_too_large');
  const frame = Buffer.alloc(4 + body.length); frame.writeUInt32BE(body.length, 0); body.copy(frame, 4); return frame;
}

export interface BinaryCredentialRecord extends Record<string, unknown> {
  originSha256?: Uint8Array | string;
  proofSuite?: string;
  applicationTagSha256?: Uint8Array | string;
}

const RECORD_REQUIRED = new Set([1, 2, 3, 4, 7, 8, 9, 10, 12, 13]);
const RECORD_ALLOWED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const PENDING_ALLOWED = new Set([1, 2, 3, 4, 5, 6]);

export function encodePendingCredential(pending: Record<string, unknown>): Buffer {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) throw new Error('pending_invalid');
  if (Object.keys(pending).some((key) => !['idempotencyKey', 'requestDigest', 'wireVersion', 'responseVersion', 'expectedGeneration', 'requestStartedAt'].includes(key))) throw new Error('pending_invalid');
  const fields = tlv([
    { id: 1, bytes: ascii(pending.idempotencyKey, /^[A-Za-z0-9_-]{22}$/u, 22, 'pending_invalid') },
    { id: 2, bytes: ascii(pending.requestDigest, /^sha256:[0-9a-f]{64}$/u, 71, 'pending_invalid') },
    { id: 3, bytes: ascii(pending.wireVersion, /^v1$/u, 2, 'pending_invalid') },
    { id: 4, bytes: ascii(pending.responseVersion, /^v1$/u, 2, 'pending_invalid') },
    { id: 5, bytes: u64(pending.expectedGeneration, 'pending_invalid') },
    { id: 6, bytes: u64(pending.requestStartedAt, 'pending_invalid') }
  ], MACOS_CREDENTIAL_RECORD_MAX_BYTES - 7);
  const head = Buffer.alloc(8); Buffer.from(MACOS_PENDING_MAGIC).copy(head); head[4] = 1; head[5] = 6; head.writeUInt16BE(8 + fields.length, 6);
  return Buffer.concat([head, fields]);
}
export function decodePendingCredential(data: Uint8Array): Record<string, unknown> {
  const bytes = Buffer.from(data); if (bytes.length < 8 || bytes.length > MACOS_CREDENTIAL_RECORD_MAX_BYTES) throw new Error('pending_corrupt');
  if (bytes.subarray(0, 4).toString('ascii') !== MACOS_PENDING_MAGIC || bytes[4] !== 1 || bytes[5] !== 6 || bytes.readUInt16BE(6) !== bytes.length) throw new Error('pending_corrupt');
  const fields = fieldMap(parseTLV(bytes.subarray(8), MACOS_CREDENTIAL_RECORD_MAX_BYTES - 8), PENDING_ALLOWED);
  if (fields.size !== 6) throw new Error('pending_corrupt');
  const result = { idempotencyKey: text(fields.get(1)!), requestDigest: text(fields.get(2)!), wireVersion: text(fields.get(3)!), responseVersion: text(fields.get(4)!), expectedGeneration: readU64(fields.get(5)!), requestStartedAt: readU64(fields.get(6)!) };
  if (!/^[A-Za-z0-9_-]{22}$/u.test(result.idempotencyKey) || !/^sha256:[0-9a-f]{64}$/u.test(result.requestDigest) || result.wireVersion !== 'v1' || result.responseVersion !== 'v1') throw new Error('pending_corrupt');
  return result;
}

export function encodeCredentialRecord(record: BinaryCredentialRecord, namespace = 'skillmap.device-auth.v1'): Buffer {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('record_invalid');
  const allowedRecordKeys = new Set(['deviceId', 'tokenFamilyId', 'refreshToken', 'scopes', 'devicePublicId', 'accountPublicId', 'updatedAt', 'generation', 'familyAbsoluteExpiresAt', 'originSha256', 'proofSuite', 'applicationTagSha256', 'pending']);
  if (Object.keys(record).some((key) => !allowedRecordKeys.has(key))) throw new Error('record_invalid');
  const deviceId = ascii(record.deviceId, /^[A-Za-z0-9_-]{22}$/u, 22);
  const family = ascii(record.tokenFamilyId, /^fam_[0-9a-f]{32}$/u, 36);
  const refresh = ascii(record.refreshToken, /^[A-Za-z0-9_-]{43}$/u, 43);
  const fields: TLV[] = [
    { id: 1, bytes: bytes32(record.originSha256, sha256(`origin:${namespace}`)) },
    { id: 2, bytes: ascii(record.proofSuite ?? 'p256-sha256', /^p256-sha256$/u, 11) },
    { id: 3, bytes: bytes32(record.applicationTagSha256, sha256(`com.skillmap.device-auth.${namespace}`)) },
    { id: 4, bytes: deviceId }
  ];
  if (record.devicePublicId !== undefined) fields.push({ id: 5, bytes: ascii(record.devicePublicId, /^dev_[0-9a-f]{32}$/u, 36) });
  if (record.accountPublicId !== undefined) fields.push({ id: 6, bytes: ascii(record.accountPublicId, /^acct_[0-9a-f]{32}$/u, 37) });
  fields.push({ id: 7, bytes: family }, { id: 8, bytes: u64(record.generation) }, { id: 9, bytes: u64(record.familyAbsoluteExpiresAt) }, { id: 10, bytes: refresh });
  const scopes = record.scopes;
  if (!Array.isArray(scopes) || scopes.length > 255 || !scopes.every((scope) => typeof scope === 'string' && Buffer.byteLength(scope, 'utf8') <= 255)) throw new Error('record_invalid');
  const scopeChunks: Buffer[] = [Buffer.from([scopes.length])]; for (const scope of scopes) { const b = utf8(scope); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); scopeChunks.push(h, b); }
  fields.push({ id: 12, bytes: Buffer.concat(scopeChunks) });
  if (record.pending !== undefined && record.pending !== null) fields.push({ id: 11, bytes: encodePendingCredential(record.pending as Record<string, unknown>) });
  fields.push({ id: 13, bytes: u64(record.updatedAt) });
  const payload = tlv(fields.sort((a, b) => a.id - b.id), MACOS_CREDENTIAL_RECORD_MAX_BYTES - 8);
  const head = Buffer.alloc(8); Buffer.from(MACOS_CREDENTIAL_MAGIC).copy(head); head[4] = 1; head[5] = fields.length; head.writeUInt16BE(8 + payload.length, 6);
  const recordBytes = Buffer.concat([head, payload]);
  if (recordBytes.length > MACOS_CREDENTIAL_RECORD_MAX_BYTES) throw new Error('record_too_large');
  return recordBytes;
}
export function decodeCredentialRecord(data: Uint8Array, _namespace = 'skillmap.device-auth.v1'): BinaryCredentialRecord {
  const bytes = Buffer.from(data); if (bytes.length < 8 || bytes.length > MACOS_CREDENTIAL_RECORD_MAX_BYTES) throw new Error('record_corrupt');
  if (bytes.subarray(0, 4).toString('ascii') !== MACOS_CREDENTIAL_MAGIC || bytes[4] !== 1 || bytes.readUInt16BE(6) !== bytes.length) throw new Error('record_corrupt');
  const fields = fieldMap(parseTLV(bytes.subarray(8), MACOS_CREDENTIAL_RECORD_MAX_BYTES - 8), RECORD_ALLOWED);
  for (const id of RECORD_REQUIRED) if (!fields.has(id)) throw new Error('record_corrupt');
  if (fields.get(1)!.length !== 32 || fields.get(3)!.length !== 32 || fields.get(2)!.toString('ascii') !== 'p256-sha256'
      || fields.get(4)!.length !== 22 || !/^[A-Za-z0-9_-]{22}$/u.test(text(fields.get(4)!))
      || fields.get(5)?.length !== undefined && fields.get(5)!.length !== 36
      || fields.get(6)?.length !== undefined && fields.get(6)!.length !== 37
      || fields.get(7)!.length !== 36 || !/^fam_[0-9a-f]{32}$/u.test(text(fields.get(7)!))
      || fields.get(10)!.length !== 43 || !/^[A-Za-z0-9_-]{43}$/u.test(text(fields.get(10)!))) throw new Error('record_corrupt');
  const scopesBytes = fields.get(12)!; if (!scopesBytes.length) throw new Error('record_corrupt');
  const scopes: string[] = []; let p = 1; const count = scopesBytes[0]; for (let i = 0; i < count; i++) { if (p + 2 > scopesBytes.length) throw new Error('record_corrupt'); const n = scopesBytes.readUInt16BE(p); p += 2; if (p + n > scopesBytes.length) throw new Error('record_corrupt'); scopes.push(text(scopesBytes.subarray(p, p + n))); p += n; } if (p !== scopesBytes.length) throw new Error('record_corrupt');
  const out: BinaryCredentialRecord = { deviceId: text(fields.get(4)!), tokenFamilyId: text(fields.get(7)!), refreshToken: text(fields.get(10)!), scopes, updatedAt: readU64(fields.get(13)!), generation: readU64(fields.get(8)!), familyAbsoluteExpiresAt: readU64(fields.get(9)!), originSha256: Buffer.from(fields.get(1)!), proofSuite: text(fields.get(2)!), applicationTagSha256: Buffer.from(fields.get(3)!) };
  if (!Buffer.from(out.originSha256 as Uint8Array).equals(sha256(`origin:${_namespace}`)) || !Buffer.from(out.applicationTagSha256 as Uint8Array).equals(sha256(`com.skillmap.device-auth.${_namespace}`))) throw new Error('record_corrupt');
  if (fields.has(5)) out.devicePublicId = text(fields.get(5)!); if (fields.has(6)) out.accountPublicId = text(fields.get(6)!); if (fields.has(11)) out.pending = decodePendingCredential(fields.get(11)!);
  return out;
}
function apiCredentialRecord(data: Uint8Array, namespace: string): Record<string, unknown> {
  const decoded = decodeCredentialRecord(data, namespace);
  const { originSha256: _origin, proofSuite: _suite, applicationTagSha256: _tag, pending: _pending, ...record } = decoded;
  return record;
}

export function encodeMetadataRecord(value: Record<string, unknown>): Buffer {
  const map: Array<[string, number]> = [['deviceId', 1], ['verificationUri', 2], ['displayName', 3], ['platform', 4], ['connectorVersion', 5]];
  const fields: TLV[] = []; for (const [name, id] of map) if (value[name] !== undefined) fields.push({ id, bytes: utf8(String(value[name])) });
  return tlv(fields, MACOS_HELPER_MAX_FRAME_BYTES);
}
export function decodeMetadataRecord(bytes: Uint8Array): Record<string, unknown> { const names = ['deviceId', 'verificationUri', 'displayName', 'platform', 'connectorVersion']; const fields = fieldMap(parseTLV(bytes, MACOS_HELPER_MAX_FRAME_BYTES), new Set([1, 2, 3, 4, 5])); const out: Record<string, unknown> = {}; for (const [id, name] of names.entries()) if (fields.has(id + 1)) out[name] = text(fields.get(id + 1)!); return out; }

function requestFields(request: MacOSHelperRequest): TLV[] {
  const fields: TLV[] = [{ id: 1, bytes: utf8(request.namespace) }]; const payload = request.payload ?? {};
  const keys = Object.keys(payload);
  switch (request.operation) {
    case 'sign': if (keys.length !== 1 || typeof payload.preimage_base64url !== 'string') throw new Error('request_payload'); fields.push({ id: 2, bytes: Buffer.from(payload.preimage_base64url, 'base64url') }); break;
    case 'credential_commit_exchange': if (keys.length !== 1) throw new Error('request_payload'); fields.push({ id: 2, bytes: encodeCredentialRecord(payload.record as BinaryCredentialRecord, request.namespace) }); break;
    case 'credential_mark_refresh_pending': if (keys.length !== 1) throw new Error('request_payload'); fields.push({ id: 2, bytes: encodePendingCredential(payload.pending as Record<string, unknown>) }); break;
    case 'credential_commit_refresh': if (keys.length !== 2 || !('pending' in payload) || !('record' in payload)) throw new Error('request_payload'); fields.push({ id: 2, bytes: encodePendingCredential(payload.pending as Record<string, unknown>) }, { id: 3, bytes: encodeCredentialRecord(payload.record as BinaryCredentialRecord, request.namespace) }); break;
    case 'metadata_save': if (keys.length !== 1) throw new Error('request_payload'); fields.push({ id: 2, bytes: encodeMetadataRecord(payload.metadata as Record<string, unknown>) }); break;
    default: if (keys.length !== 0) throw new Error('request_payload');
  }
  return fields;
}
function responseFields(response: MacOSHelperResponse, operation: MacOSHelperOperation, namespace = 'skillmap.device-auth.v1'): TLV[] {
  if (!response.ok) { const code = fixedError(response.error?.code ?? 'helper_error'); return [{ id: 250, bytes: ascii(code, /^[A-Za-z0-9_.-]{1,64}$/u, Buffer.byteLength(code)) }]; }
  const result = response.result ?? {}; const fields: TLV[] = [];
  const allowed = operation === 'exists_key' ? new Set(['exists'])
    : operation === 'create_key' || operation === 'public_key' ? new Set(['x963_base64url'])
    : operation === 'sign' ? new Set(['signature_der_base64url'])
    : operation === 'credential_load' ? new Set(['record', 'pending'])
    : operation === 'credential_mark_refresh_pending' ? new Set(['pending'])
    : operation === 'metadata_load' ? new Set(['metadata'])
    : new Set(['deleted']);
  if (Object.keys(result).some((key) => !allowed.has(key))) throw new Error('response_shape');
  if (operation === 'exists_key') fields.push({ id: 1, bytes: Buffer.from([result.exists === true ? 1 : 0]) });
  else if (operation === 'create_key' || operation === 'public_key') fields.push({ id: 1, bytes: Buffer.from(String(result.x963_base64url ?? ''), 'base64url') });
  else if (operation === 'sign') fields.push({ id: 1, bytes: Buffer.from(String(result.signature_der_base64url ?? ''), 'base64url') });
  else if (operation === 'credential_load') { if (result.record !== undefined && result.record !== null) fields.push({ id: 1, bytes: encodeCredentialRecord(result.record as BinaryCredentialRecord, namespace) }); if (result.pending !== undefined && result.pending !== null) fields.push({ id: 2, bytes: encodePendingCredential(result.pending as Record<string, unknown>) }); }
  else if (operation === 'credential_mark_refresh_pending') fields.push({ id: 1, bytes: encodePendingCredential(result.pending as Record<string, unknown>) });
  else if (operation === 'metadata_load' && result.metadata) fields.push({ id: 1, bytes: encodeMetadataRecord(result.metadata as Record<string, unknown>) });
  else if (result.deleted === true) fields.push({ id: 1, bytes: Buffer.from([1]) });
  return fields;
}

/** Encode one canonical binary frame. JSON is intentionally not a wire format. */
export function encodeHelperFrame(value: unknown): Buffer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('frame_shape');
  const object = value as Record<string, unknown>;
  if (object.version === 1 && object.ok === undefined && typeof object.namespace === 'string' && typeof object.operation === 'string') {
    const request = object as unknown as MacOSHelperRequest; assertHelperRequest(request);
    const op = request.operation; const bodyFields = tlv(requestFields(request), MACOS_HELPER_MAX_FRAME_BYTES - 8);
    const head = Buffer.from([1, DOMAIN_BY_OPERATION.get(op)!, OPERATION_CODE[op], 1, requestFields(request).length]);
    return framed(Buffer.concat([Buffer.from(MACOS_HELPER_MAGIC), head, bodyFields]));
  }
  if (object.version === 1 && typeof object.ok === 'boolean') {
    const response = object as unknown as MacOSHelperResponse; assertHelperResponse(response); const op = response.operation;
    if (!op || !OPERATION_CODE[op]) throw new Error('response_operation');
    const responseNamespace = response.namespace ?? 'skillmap.device-auth.v1';
    if (!MACOS_HELPER_NAMESPACE_PATTERN.test(responseNamespace)) throw new Error('response_header');
    const bodyFields = tlv(responseFields(response, op, responseNamespace), MACOS_HELPER_MAX_FRAME_BYTES - 8);
    const head = Buffer.from([1, DOMAIN_BY_OPERATION.get(op)!, OPERATION_CODE[op], 2, responseFields(response, op, responseNamespace).length]);
    return framed(Buffer.concat([Buffer.from(MACOS_HELPER_MAGIC), head, bodyFields]));
  }
  throw new Error('frame_shape');
}

export function decodeHelperFrame(bytes: Uint8Array, namespace = 'skillmap.device-auth.v1'): unknown {
  const frame = Buffer.from(bytes); if (frame.length < 4) throw new Error('frame_truncated'); const length = frame.readUInt32BE(0);
  if (length === 0 || length > MACOS_HELPER_MAX_FRAME_BYTES - 4) throw new Error('frame_length'); if (frame.length !== length + 4) throw new Error('frame_size_mismatch');
  const body = frame.subarray(4); if (body.length < 9 || body.subarray(0, 4).toString('ascii') !== MACOS_HELPER_MAGIC) throw new Error('frame_magic'); if (body[4] !== 1) throw new Error('frame_version');
  const domain = body[5]; const operation = CODE_OPERATION.get(body[6]); if (!operation || DOMAIN_BY_OPERATION.get(operation) !== domain) throw new Error('frame_domain'); const kind = body[7]; if (kind !== 1 && kind !== 2) throw new Error('frame_kind'); const count = body[8];
  const fields = parseTLV(body.subarray(9), MACOS_HELPER_MAX_FRAME_BYTES - 9); if (fields.length !== count) throw new Error('frame_fields');
  if (kind === 1) { const map = fieldMap(fields, expectedRequestFields(operation)); if (!map.has(1)) throw new Error('request_header'); const namespace = text(map.get(1)!); const result: MacOSHelperRequest = { version: 1, namespace, operation }; const payload: Record<string, unknown> = {};
    if (operation === 'sign' && map.has(2)) payload.preimage_base64url = map.get(2)!.toString('base64url');
    if (operation === 'credential_commit_exchange' && map.has(2)) payload.record = apiCredentialRecord(map.get(2)!, namespace);
    if (operation === 'credential_mark_refresh_pending' && map.has(2)) payload.pending = decodePendingCredential(map.get(2)!);
    if (operation === 'credential_commit_refresh' && map.has(2) && map.has(3)) { payload.pending = decodePendingCredential(map.get(2)!); payload.record = apiCredentialRecord(map.get(3)!, namespace); }
    if (operation === 'metadata_save' && map.has(2)) payload.metadata = decodeMetadataRecord(map.get(2)!);
    if (expectedRequestFields(operation).size !== fields.length) throw new Error('frame_fields');
    if (Object.keys(payload).length) result.payload = payload; assertHelperRequest(result); return result;
  }
  const map = fieldMap(fields, new Set(fields.map((f) => f.id))); const resultResponse: MacOSHelperResponse = { version: 1, ok: !map.has(250), operation };
  if (map.has(250)) resultResponse.error = { code: fixedError(text(map.get(250)!)) };
  else {
    const result: Record<string, unknown> = {};
    if (operation === 'exists_key') { if (!map.has(1) || map.get(1)!.length !== 1 || (map.get(1)![0] !== 0 && map.get(1)![0] !== 1)) throw new Error('response_shape'); result.exists = map.get(1)![0] === 1; }
    else if (operation === 'create_key' || operation === 'public_key') { if (!map.has(1) || map.get(1)!.length === 0) throw new Error('response_shape'); result.x963_base64url = map.get(1)!.toString('base64url'); }
    else if (operation === 'sign') { if (!map.has(1) || map.get(1)!.length === 0) throw new Error('response_shape'); result.signature_der_base64url = map.get(1)!.toString('base64url'); }
    else if (operation === 'credential_load') { if (map.has(1)) result.record = apiCredentialRecord(map.get(1)!, namespace); if (map.has(2)) result.pending = decodePendingCredential(map.get(2)!); }
    else if (operation === 'credential_mark_refresh_pending') { if (!map.has(1)) throw new Error('response_shape'); result.pending = decodePendingCredential(map.get(1)!); }
    else if (operation === 'metadata_load' && map.has(1)) result.metadata = decodeMetadataRecord(map.get(1)!);
    else if (map.get(1)?.[0] === 1) result.deleted = true;
    resultResponse.result = result;
  }
  fieldMap(fields, expectedResponseFields(operation, resultResponse.ok));
  resultResponse.namespace = namespace;
  assertHelperResponse(resultResponse); return resultResponse;
}

export function assertHelperRequest(value: unknown): asserts value is MacOSHelperRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_shape'); const request = value as Record<string, unknown>;
  if (request.version !== 1 || typeof request.namespace !== 'string' || !MACOS_HELPER_NAMESPACE_PATTERN.test(request.namespace)) throw new Error('request_header');
  if (typeof request.operation !== 'string' || !MACOS_HELPER_OPERATIONS.includes(request.operation as MacOSHelperOperation)) throw new Error('request_operation');
  if (request.payload !== undefined && (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload))) throw new Error('request_payload');
}
export function assertHelperResponse(value: unknown): asserts value is MacOSHelperResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('response_shape'); const response = value as Record<string, unknown>;
  if (response.version !== 1 || typeof response.ok !== 'boolean') throw new Error('response_header');
  if (response.operation !== undefined && (typeof response.operation !== 'string' || !MACOS_HELPER_OPERATIONS.includes(response.operation as MacOSHelperOperation))) throw new Error('response_header');
  if (response.namespace !== undefined && (typeof response.namespace !== 'string' || !MACOS_HELPER_NAMESPACE_PATTERN.test(response.namespace))) throw new Error('response_header');
  if (response.ok && response.error !== undefined) throw new Error('response_error');
  if (!response.ok && (!response.error || typeof response.error !== 'object' || typeof (response.error as Record<string, unknown>).code !== 'string')) throw new Error('response_error');
  if (response.result !== undefined && (!response.result || typeof response.result !== 'object' || Array.isArray(response.result))) throw new Error('response_shape');
}
