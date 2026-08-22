import { createHash, timingSafeEqual } from 'node:crypto';
import {
  isValidManagedManifestPath,
  MANIFEST_INVALID_PATH,
  MANIFEST_PATH_COLLISION,
  ManagedManifestError
} from './managed-manifest.js';
import {
  DEFAULT_SKILL_FILESYSTEM_LIMITS,
  SkillFilesystemLimitError
} from './skill-tree-limits.js';

export const INVALID_DIGEST = 'INVALID_DIGEST';
export const DIGEST_MISMATCH = 'DIGEST_MISMATCH';
export const SIZE_MISMATCH = 'SIZE_MISMATCH';

export interface ContentDigestFile {
  path: string;
  bytes: Buffer;
  size?: number;
  digest?: string;
}

export interface ContentDigestResult {
  manifestDigest: string;
  contentDigest: string;
  envelope: Buffer;
  fileDigests: string[];
}

export class ImmutableContentDigestError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'ImmutableContentDigestError';
    this.code = code;
    this.field = field;
  }
}

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const SKILL_VERSION_TAG = Buffer.from('skillmap.skill-version\0v1\0', 'utf8');
const MANIFEST_DIGEST_TAG = Buffer.from('manifest-digest\0v1\0', 'utf8');
const FILE_ENTRY_TAG = Buffer.from('file-entry\0v1\0', 'utf8');
const FILE_DIGEST_TAG = Buffer.from('file-digest\0v1\0', 'utf8');

interface InternalEntry {
  path: string;
  pathBytes: Buffer;
  bytes: Buffer;
  size: number;
  claimedDigestBytes?: Buffer;
  digestField?: string;
}

function decodeSha256(digest: string, field?: string): Buffer {
  if (!SHA256_DIGEST_PATTERN.test(digest)) {
    throw new ImmutableContentDigestError(
      INVALID_DIGEST,
      'Digest must be sha256: followed by exactly 64 lowercase hexadecimal characters',
      field
    );
  }
  return Buffer.from(digest.slice(7), 'hex');
}

function assertEqualDigest(computed: Buffer, claimed: Buffer, field: string): void {
  if (computed.length !== claimed.length) {
    throw new ImmutableContentDigestError(DIGEST_MISMATCH, 'Digest length mismatch', field);
  }
  if (!timingSafeEqual(computed, claimed)) {
    throw new ImmutableContentDigestError(DIGEST_MISMATCH, 'Digest does not match the provided content', field);
  }
}

function writeU32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function writeU64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value), 0);
  return buffer;
}

export function encodeContentDigest(
  canonicalManifestBytes: Buffer,
  manifestDigest: string,
  files: ContentDigestFile[]
): ContentDigestResult {
  if (!Buffer.isBuffer(canonicalManifestBytes)) {
    throw new TypeError('canonicalManifestBytes must be a Buffer');
  }

  const manifestDigestBytes = decodeSha256(manifestDigest, 'manifestDigest');
  const recomputedManifest = createHash('sha256').update(canonicalManifestBytes).digest();
  assertEqualDigest(recomputedManifest, manifestDigestBytes, 'manifestDigest');

  if (!Array.isArray(files)) {
    throw new TypeError('files must be an array');
  }
  if (files.length > DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeFiles) {
    throw new SkillFilesystemLimitError('maxTreeFiles');
  }

  const caseFoldKeys = new Set<string>();
  const entries: InternalEntry[] = [];
  let totalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new TypeError(`files[${i}] must be an object`);
    }
    if (!Buffer.isBuffer(file.bytes)) {
      throw new TypeError(`files[${i}].bytes must be a Buffer`);
    }

    const pathField = `files[${i}].path`;
    const pathResult = isValidManagedManifestPath(file.path, caseFoldKeys);
    if (!pathResult.ok) {
      const code = pathResult.code === MANIFEST_PATH_COLLISION ? MANIFEST_PATH_COLLISION : MANIFEST_INVALID_PATH;
      throw new ManagedManifestError(code, `Invalid file path at ${pathField}`, pathField);
    }

    const pathBytes = Buffer.from(file.path, 'utf8');
    const actualSize = file.bytes.length;
    let effectiveSize: number;

    if (file.size !== undefined) {
      const sizeField = `files[${i}].size`;
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ImmutableContentDigestError(SIZE_MISMATCH, 'Size must be a non-negative safe integer', sizeField);
      }
      if (file.size !== actualSize) {
        throw new ImmutableContentDigestError(SIZE_MISMATCH, 'Claimed size does not match the provided bytes', sizeField);
      }
      effectiveSize = file.size;
    } else {
      effectiveSize = actualSize;
    }

    if (effectiveSize > DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes) {
      throw new SkillFilesystemLimitError('maxFileBytes');
    }

    const entry: InternalEntry = { path: file.path, pathBytes, bytes: file.bytes, size: effectiveSize };
    if (file.digest !== undefined) {
      entry.digestField = `files[${i}].digest`;
      entry.claimedDigestBytes = decodeSha256(file.digest, entry.digestField);
    }

    totalBytes += effectiveSize;
    if (totalBytes > DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeBytes) {
      throw new SkillFilesystemLimitError('maxTreeBytes');
    }

    entries.push(entry);
  }

  entries.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].path === entries[i - 1].path) {
      throw new ManagedManifestError(
        MANIFEST_PATH_COLLISION,
        `Duplicate file path in canonical inventory`,
        `files[${i}].path`
      );
    }
  }

  const fileDigests: string[] = [];
  for (const entry of entries) {
    const computedFileDigest = createHash('sha256').update(entry.bytes).digest();
    if (entry.claimedDigestBytes !== undefined) {
      assertEqualDigest(computedFileDigest, entry.claimedDigestBytes, entry.digestField ?? 'files.digest');
    }
    fileDigests.push('sha256:' + computedFileDigest.toString('hex'));
  }

  const parts: Buffer[] = [
    SKILL_VERSION_TAG,
    MANIFEST_DIGEST_TAG,
    manifestDigestBytes,
    writeU32(entries.length)
  ];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    parts.push(FILE_ENTRY_TAG);
    parts.push(writeU32(entry.pathBytes.length));
    parts.push(entry.pathBytes);
    parts.push(writeU64(entry.size));
    parts.push(FILE_DIGEST_TAG);
    parts.push(Buffer.from(fileDigests[i].slice(7), 'hex'));
  }

  const envelope = Buffer.concat(parts);
  const contentDigest = 'sha256:' + createHash('sha256').update(envelope).digest('hex');

  return { manifestDigest, contentDigest, envelope, fileDigests };
}
