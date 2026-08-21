import { createHash } from 'node:crypto';

export const MANIFEST_SCHEMA_VERSION = '1.0';
export const MANIFEST_MAJOR = 1;

export const MANIFEST_INVALID_JSON = 'MANIFEST_INVALID_JSON';
export const MANIFEST_UNKNOWN_FIELD = 'MANIFEST_UNKNOWN_FIELD';
export const MANIFEST_REQUIRED_FIELD = 'MANIFEST_REQUIRED_FIELD';
export const MANIFEST_TYPE_MISMATCH = 'MANIFEST_TYPE_MISMATCH';
export const MANIFEST_UNSUPPORTED_VERSION = 'MANIFEST_UNSUPPORTED_VERSION';
export const MANIFEST_LIMIT_EXCEEDED = 'MANIFEST_LIMIT_EXCEEDED';
export const MANIFEST_INVALID_PATH = 'MANIFEST_INVALID_PATH';
export const MANIFEST_PATH_COLLISION = 'MANIFEST_PATH_COLLISION';
export const MANIFEST_INVALID_UTF8 = 'MANIFEST_INVALID_UTF8';
export const MANIFEST_SIZE_MISMATCH = 'MANIFEST_SIZE_MISMATCH';
export const MANIFEST_FILE_DIGEST_MISMATCH = 'MANIFEST_FILE_DIGEST_MISMATCH';
export const MANIFEST_DIGEST_MISMATCH = 'MANIFEST_DIGEST_MISMATCH';
export const MANIFEST_IDENTITY_CONFLICT = 'MANIFEST_IDENTITY_CONFLICT';
export const MANIFEST_AUTHORITY_DENIED = 'MANIFEST_AUTHORITY_DENIED';
export const MANIFEST_SOURCE_UNAVAILABLE = 'MANIFEST_SOURCE_UNAVAILABLE';
export const MANIFEST_IO_TRANSIENT = 'MANIFEST_IO_TRANSIENT';

export interface ManagedManifestErrorDetail {
  code: string;
  retryable: boolean;
  field?: string;
  detail?: string;
}

export class ManagedManifestError extends Error implements ManagedManifestErrorDetail {
  readonly code: string;
  readonly retryable: boolean;
  readonly field?: string;

  constructor(code: string, message: string, field?: string, retryable = false) {
    super(message);
    this.name = 'ManagedManifestError';
    this.code = code;
    this.field = field;
    this.retryable = retryable;
  }
}

export interface ManagedSkillFile {
  path: string;
  media_type: string;
  utf8_bytes: number;
  digest: string;
  executable: boolean;
}

export interface ManagedSkillIdentity {
  logical_id: string;
  public_id: string;
}

export interface ManagedSkillDisplay {
  name: string;
  description: string;
}

export interface ManagedSkillSource {
  authority: string;
  kind: string;
  namespace: string;
  source_id: string;
  revision: string;
}

export interface ManagedSkillProvenance {
  publisher_id: string;
  ingest_id: string;
  created_at: string;
}

export interface ManagedSkillCompatibility {
  manifest_major: number;
  minimum_consumer_major: number;
}

export interface ManagedSkillManifest {
  schema_version: string;
  identity: ManagedSkillIdentity;
  display: ManagedSkillDisplay;
  source: ManagedSkillSource;
  files: ManagedSkillFile[];
  provenance: ManagedSkillProvenance;
  compatibility: ManagedSkillCompatibility;
  manifest_digest?: string;
}

export interface CanonicalizedManagedManifest {
  manifest: ManagedSkillManifest;
  canonicalBytes: Buffer;
  manifestDigest: string;
}

const BOUNDS = {
  maxManifestBytes: 262_144,
  maxFiles: 2_048,
  maxFileBytes: 16_777_216,
  maxTreeBytes: 67_108_864,
  maxSkillMarkdownBytes: 1_048_576,
  maxTreeDepth: 32,
  maxTreeEntries: 4_096,
  maxObjectDepth: 8,
  maxObjectMembers: 32,
  maxPathBytes: 512,
  maxPathSegments: 32,
  maxLogicalIdBytes: 128,
  maxPublicIdBytes: 128,
  maxDisplayNameChars: 200,
  maxDescriptionBytes: 2_048,
  maxSourceComponentBytes: 512,
  maxProvenanceStringBytes: 512
} as const;

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const DISPLAY_NAME_RE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,200}$/;

const DIGEST_FIELD = 'manifest_digest';

function nfc(value: string): string {
  return value.normalize('NFC');
}

function isNfc(value: string): boolean {
  return value === nfc(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER.test(value);
}

function utf8Buffer(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function caseFoldKey(value: string): string {
  // ECMAScript's locale-insensitive full uppercase expansion followed by
  // lowercase covers the Unicode default-fold aliases that differ from plain
  // lowercase (for example ss/eszett, sigma, long-s, and micro-sign aliases).
  return nfc(value).toUpperCase().toLowerCase();
}

function requireObject(value: unknown, field: string, depth = 1): Record<string, unknown> {
  if (depth > BOUNDS.maxObjectDepth) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `Object nesting depth exceeds ${BOUNDS.maxObjectDepth}`, field);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be an object`, field);
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length > BOUNDS.maxObjectMembers) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `${field} has more than ${BOUNDS.maxObjectMembers} members`, field);
  }
  return object;
}

function requireString(value: unknown, field: string, maxBytes?: number, asciiOnly = false, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be a string`, field);
  }
  if (value === '' && !allowEmpty) {
    throw new ManagedManifestError(MANIFEST_REQUIRED_FIELD, `${field} must be a non-empty string`, field);
  }
  if (hasControlCharacter(value)) {
    throw new ManagedManifestError(MANIFEST_INVALID_UTF8, `${field} contains control characters`, field);
  }
  let text = value;
  const normalized = nfc(value);
  if (normalized !== value) {
    // Allowed strings are normalized to NFC; paths must already be NFC and are checked separately.
    text = normalized;
  }
  if (asciiOnly && byteLength(text) !== text.length) {
    throw new ManagedManifestError(MANIFEST_INVALID_UTF8, `${field} must be ASCII`, field);
  }
  if (maxBytes !== undefined && byteLength(text) > maxBytes) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `${field} exceeds ${maxBytes} bytes`, field);
  }
  return text;
}

function requireSafeInteger(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be a safe integer between ${min} and ${max}`, field);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be a boolean`, field);
  }
  return value;
}

function requireSha256Digest(value: unknown, field: string): string {
  const digest = requireString(value, field, 71, true);
  if (!SHA256_DIGEST_PATTERN.test(digest)) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be sha256: followed by 64 lowercase hex characters`, field);
  }
  return digest;
}

function requireDateTime(value: unknown, field: string): string {
  const text = requireString(value, field, 32, true);
  if (!DATE_TIME_PATTERN.test(text)) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be an ISO 8601 UTC date-time`, field);
  }
  const [datePart, timePart] = text.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, secondsPart] = timePart.slice(0, -1).split(':');
  const second = Number(secondsPart.split('.')[0]);
  const parsed = new Date(Date.UTC(year, month - 1, day, Number(hour), Number(minute), second));
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== second) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, `${field} must be a real ISO 8601 UTC date-time`, field);
  }
  return text;
}

export type PathValidationResult =
  | { ok: true; path: string }
  | { ok: false; code: typeof MANIFEST_INVALID_PATH | typeof MANIFEST_PATH_COLLISION };

export function isValidManagedManifestPath(value: string, existingCaseFoldKeys?: Set<string>): PathValidationResult {
  if (typeof value !== 'string' || value === '') {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (value.includes('\0')) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (hasControlCharacter(value)) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (value.includes('\\')) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (/%(?:2e|2f|5c)/iu.test(value)) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (value.endsWith('/')) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (value === DIGEST_FIELD) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  if (byteLength(value) > BOUNDS.maxPathBytes) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }

  if (!isNfc(value)) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }

  const segments = value.split('/');
  if (segments.length > BOUNDS.maxPathSegments) {
    return { ok: false, code: MANIFEST_INVALID_PATH };
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { ok: false, code: MANIFEST_INVALID_PATH };
    }
    if (segment.startsWith('.')) {
      return { ok: false, code: MANIFEST_INVALID_PATH };
    }
  }

  const fold = caseFoldKey(value);
  if (existingCaseFoldKeys !== undefined) {
    if (existingCaseFoldKeys.has(fold)) {
      return { ok: false, code: MANIFEST_PATH_COLLISION };
    }
    existingCaseFoldKeys.add(fold);
  }

  return { ok: true, path: value };
}

function validateManagedManifestPath(value: unknown, index: number, exactPaths: Set<string>, caseFoldKeys: Set<string>): string {
  const field = `files[${index}].path`;
  if (typeof value !== 'string' || value === '') {
    throw new ManagedManifestError(MANIFEST_INVALID_PATH, 'File path must be a non-empty string', field);
  }
  const result = isValidManagedManifestPath(value, caseFoldKeys);
  if (!result.ok) {
    throw new ManagedManifestError(result.code, result.code === MANIFEST_PATH_COLLISION ? 'File path collides with another path' : 'File path is not a canonical relative path', field);
  }
  if (exactPaths.has(result.path)) {
    throw new ManagedManifestError(MANIFEST_PATH_COLLISION, 'File path is duplicated', field);
  }
  exactPaths.add(result.path);
  return result.path;
}

function parseIdentity(input: Record<string, unknown>, depth: number): ManagedSkillIdentity {
  const object = requireObject(input, 'identity', depth);
  const logicalId = requireString(object.logical_id, 'identity.logical_id', BOUNDS.maxLogicalIdBytes);
  const publicId = requireString(object.public_id, 'identity.public_id', BOUNDS.maxPublicIdBytes, true);
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, 'identity.public_id has invalid characters', 'identity.public_id');
  }
  if (Object.keys(object).length !== 2) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, 'identity contains an unknown field', 'identity');
  }
  return { logical_id: logicalId, public_id: publicId };
}

function parseDisplay(input: Record<string, unknown>, depth: number): ManagedSkillDisplay {
  const object = requireObject(input, 'display', depth);
  const name = requireString(object.name, 'display.name', BOUNDS.maxDisplayNameChars * 4);
  if (!DISPLAY_NAME_RE.test(name)) {
    throw new ManagedManifestError(MANIFEST_INVALID_UTF8, 'display.name contains unsafe characters or is empty', 'display.name');
  }
  const description = requireString(object.description, 'display.description', BOUNDS.maxDescriptionBytes, false, true);
  if (Object.keys(object).length !== 2) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, 'display contains an unknown field', 'display');
  }
  return { name, description };
}

function parseSource(input: Record<string, unknown>, depth: number): ManagedSkillSource {
  const object = requireObject(input, 'source', depth);
  const authority = requireString(object.authority, 'source.authority', BOUNDS.maxSourceComponentBytes);
  const kind = requireString(object.kind, 'source.kind', BOUNDS.maxSourceComponentBytes);
  const namespace = requireString(object.namespace, 'source.namespace', BOUNDS.maxSourceComponentBytes);
  const sourceId = requireString(object.source_id, 'source.source_id', BOUNDS.maxSourceComponentBytes);
  const revision = requireString(object.revision, 'source.revision', BOUNDS.maxSourceComponentBytes);
  if (Object.keys(object).length !== 5) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, 'source contains an unknown field', 'source');
  }
  return { authority, kind, namespace, source_id: sourceId, revision };
}

function parseProvenance(input: Record<string, unknown>, depth: number): ManagedSkillProvenance {
  const object = requireObject(input, 'provenance', depth);
  const publisherId = requireString(object.publisher_id, 'provenance.publisher_id', BOUNDS.maxProvenanceStringBytes);
  const ingestId = requireString(object.ingest_id, 'provenance.ingest_id', BOUNDS.maxProvenanceStringBytes);
  const createdAt = requireDateTime(object.created_at, 'provenance.created_at');
  if (Object.keys(object).length !== 3) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, 'provenance contains an unknown field', 'provenance');
  }
  return { publisher_id: publisherId, ingest_id: ingestId, created_at: createdAt };
}

function parseCompatibility(input: Record<string, unknown>, depth: number): ManagedSkillCompatibility {
  const object = requireObject(input, 'compatibility', depth);
  const major = requireSafeInteger(object.manifest_major, 'compatibility.manifest_major', 1);
  const minimum = requireSafeInteger(object.minimum_consumer_major, 'compatibility.minimum_consumer_major', 1);
  if (Object.keys(object).length !== 2) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, 'compatibility contains an unknown field', 'compatibility');
  }
  return { manifest_major: major, minimum_consumer_major: minimum };
}

function parseFile(value: unknown, index: number, exactPaths: Set<string>, caseFoldKeys: Set<string>): ManagedSkillFile {
  const object = requireObject(value, `files[${index}]`, 1);
  const path = validateManagedManifestPath(object.path, index, exactPaths, caseFoldKeys);
  const mediaType = requireString(object.media_type, `files[${index}].media_type`, 128);
  const utf8Bytes = requireSafeInteger(object.utf8_bytes, `files[${index}].utf8_bytes`, 0, BOUNDS.maxFileBytes);
  const digest = requireSha256Digest(object.digest, `files[${index}].digest`);
  const executable = requireBoolean(object.executable, `files[${index}].executable`);
  if (Object.keys(object).length !== 5) {
    throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, `files[${index}] contains an unknown field`, `files[${index}]`);
  }
  return { path, media_type: mediaType, utf8_bytes: utf8Bytes, digest, executable };
}

export function canonicalizeManagedManifest(input: unknown): CanonicalizedManagedManifest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ManagedManifestError(MANIFEST_INVALID_JSON, 'Managed manifest must be a JSON object');
  }
  const object = input as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length > BOUNDS.maxObjectMembers) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `Top-level object has more than ${BOUNDS.maxObjectMembers} members`);
  }

  const knownTopLevel = new Set<string>([
    'schema_version',
    'identity',
    'display',
    'source',
    'files',
    'provenance',
    'compatibility',
    DIGEST_FIELD
  ]);
  for (const key of keys) {
    if (!knownTopLevel.has(key)) {
      throw new ManagedManifestError(MANIFEST_UNKNOWN_FIELD, `Unknown top-level field: ${key}`, key);
    }
  }

  if (typeof object.schema_version !== 'string') {
    throw new ManagedManifestError(MANIFEST_REQUIRED_FIELD, 'schema_version is required', 'schema_version');
  }
  const schemaVersion = object.schema_version;
  const majorMatch = /^([0-9]+)\.[0-9]+$/u.exec(schemaVersion);
  if (!majorMatch) {
    throw new ManagedManifestError(MANIFEST_UNSUPPORTED_VERSION, `schema_version must be a decimal major.minor string, received: ${schemaVersion}`, 'schema_version');
  }
  const major = Number.parseInt(majorMatch[1], 10);
  if (major !== MANIFEST_MAJOR) {
    throw new ManagedManifestError(MANIFEST_UNSUPPORTED_VERSION, `Unsupported manifest major version: ${major}`, 'schema_version');
  }

  const identity = parseIdentity(requireObject(object.identity as Record<string, unknown>, 'identity', 1), 2);
  const display = parseDisplay(requireObject(object.display as Record<string, unknown>, 'display', 1), 2);
  const source = parseSource(requireObject(object.source as Record<string, unknown>, 'source', 1), 2);
  const provenance = parseProvenance(requireObject(object.provenance as Record<string, unknown>, 'provenance', 1), 2);
  const compatibility = parseCompatibility(requireObject(object.compatibility as Record<string, unknown>, 'compatibility', 1), 2);

  if (!Array.isArray(object.files)) {
    throw new ManagedManifestError(MANIFEST_REQUIRED_FIELD, 'files must be a non-empty array', 'files');
  }
  if (object.files.length === 0 || object.files.length > BOUNDS.maxFiles) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `files must contain between 1 and ${BOUNDS.maxFiles} entries`, 'files');
  }

  const exactPaths = new Set<string>();
  const caseFoldKeys = new Set<string>();
  const files: ManagedSkillFile[] = object.files
    .map((file, index) => parseFile(file, index, exactPaths, caseFoldKeys))
    .sort((left, right) => Buffer.compare(utf8Buffer(left.path), utf8Buffer(right.path)));

  const manifest: ManagedSkillManifest = {
    schema_version: schemaVersion,
    identity,
    display,
    source,
    files,
    provenance,
    compatibility
  };

  const canonicalBytes = serializeCanonicalJson(manifest, 1);
  if (canonicalBytes.length > BOUNDS.maxManifestBytes) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, `Canonical manifest exceeds ${BOUNDS.maxManifestBytes} bytes`, 'manifest');
  }

  const manifestDigest = `sha256:${createHash('sha256').update(canonicalBytes).digest('hex')}`;

  if (object.manifest_digest !== undefined) {
    const claimed = requireSha256Digest(object.manifest_digest, 'manifest_digest');
    if (claimed !== manifestDigest) {
      throw new ManagedManifestError(MANIFEST_DIGEST_MISMATCH, 'Claimed manifest_digest does not match canonical projection', 'manifest_digest');
    }
  }

  return {
    manifest: { ...manifest, manifest_digest: manifestDigest },
    canonicalBytes,
    manifestDigest
  };
}

function sortKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).sort((left, right) => Buffer.compare(utf8Buffer(left), utf8Buffer(right)));
}

function serializeCanonicalJson(value: unknown, depth: number, isFileSort = false): Buffer {
  if (depth > BOUNDS.maxObjectDepth + 2) {
    throw new ManagedManifestError(MANIFEST_LIMIT_EXCEEDED, 'Serialization depth exceeded', 'manifest');
  }

  if (value === null) {
    throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, 'null is not an allowed JSON value', 'manifest');
  }

  if (typeof value === 'boolean') {
    return Buffer.from(value ? 'true' : 'false', 'utf8');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, 'Only non-negative safe integers are allowed', 'manifest');
    }
    return Buffer.from(String(value), 'utf8');
  }

  if (typeof value === 'string') {
    return serializeString(value);
  }

  if (Array.isArray(value)) {
    const array: unknown[] = isFileSort
      ? [...value].sort((left, right) => {
          const leftPath = (left as ManagedSkillFile).path;
          const rightPath = (right as ManagedSkillFile).path;
          return Buffer.compare(utf8Buffer(leftPath), utf8Buffer(rightPath));
        })
      : value;
    const parts: Buffer[] = [Buffer.from('[', 'utf8')];
    for (let i = 0; i < array.length; i++) {
      if (i > 0) parts.push(Buffer.from(',', 'utf8'));
      parts.push(serializeCanonicalJson(array[i], depth + 1));
    }
    parts.push(Buffer.from(']', 'utf8'));
    return Buffer.concat(parts);
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = sortKeys(object);
    const parts: Buffer[] = [Buffer.from('{', 'utf8')];
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) parts.push(Buffer.from(',', 'utf8'));
      parts.push(serializeString(keys[i]));
      parts.push(Buffer.from(':', 'utf8'));
      const isFiles = keys[i] === 'files';
      parts.push(serializeCanonicalJson(object[keys[i]], depth + 1, isFiles));
    }
    parts.push(Buffer.from('}', 'utf8'));
    return Buffer.concat(parts);
  }

  throw new ManagedManifestError(MANIFEST_TYPE_MISMATCH, 'Unsupported JSON type', 'manifest');
}

const ESCAPES: Record<number, string> = {
  0x22: '\\"',
  0x5c: '\\\\',
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r'
};

function serializeString(value: string): Buffer {
  const chunks: Buffer[] = [Buffer.from('"', 'utf8')];
  for (const codePoint of value) {
    const code = codePoint.codePointAt(0) ?? 0;
    if (code < 0x20) {
      const escape = ESCAPES[code];
      if (escape !== undefined) {
        chunks.push(Buffer.from(escape, 'utf8'));
      } else {
        chunks.push(Buffer.from(`\\u${code.toString(16).padStart(4, '0')}`, 'utf8'));
      }
      continue;
    }
    if (code === 0x22 || code === 0x5c) {
      chunks.push(Buffer.from(ESCAPES[code], 'utf8'));
      continue;
    }
    chunks.push(Buffer.from(codePoint, 'utf8'));
  }
  chunks.push(Buffer.from('"', 'utf8'));
  return Buffer.concat(chunks);
}

export function computeSha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
