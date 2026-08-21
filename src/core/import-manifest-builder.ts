import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ApprovedRootRecord } from '../schemas/types.js';
import { isSafeDisplayName, safeFallbackDisplayName } from './display-name.js';
import { buildQualifiedSkillIdentity, type QualifiedSkillIdentity, type SkillTreeEntry } from './identity.js';
import {
  canonicalizeManagedManifest,
  type ManagedSkillFile,
  type ManagedSkillManifest,
  type ManagedSkillProvenance,
  type ManagedSkillSource,
  MANIFEST_FILE_DIGEST_MISMATCH,
  MANIFEST_INVALID_UTF8,
  MANIFEST_LIMIT_EXCEEDED,
  ManagedManifestError
} from './managed-manifest.js';
import { parseFrontmatter } from './frontmatter.js';
import { resolveSkillFilesystemLimits, SkillFilesystemLimitError, type SkillFilesystemLimits } from './skill-tree-limits.js';
import { inspectImportFileForSecrets, isForbiddenCredentialPath } from './import-secret-blocker.js';

export const IMPORT_REJECTED = 'IMPORT_REJECTED';
export const IMPORT_BLOCKED_FOR_REVIEW = 'IMPORT_BLOCKED_FOR_REVIEW';
export const IMPORT_FILE_TYPE_DENIED = 'IMPORT_FILE_TYPE_DENIED';
export const IMPORT_SCRIPT_DENIED = 'IMPORT_SCRIPT_DENIED';
export const IMPORT_ACTIVE_CONTENT_DENIED = 'IMPORT_ACTIVE_CONTENT_DENIED';
export const IMPORT_ARCHIVE_DENIED = 'IMPORT_ARCHIVE_DENIED';
export const IMPORT_SECRET_BLOCKED = 'IMPORT_SECRET_BLOCKED';
export const IMPORT_HIDDEN_PATH = 'IMPORT_HIDDEN_PATH';
export const IMPORT_GENERATED_PATH = 'IMPORT_GENERATED_PATH';
export const IMPORT_UNSAFE_ENTRY = 'IMPORT_UNSAFE_ENTRY';
export const IMPORT_PARTIAL_RETRYABLE = 'IMPORT_PARTIAL_RETRYABLE';
export const IMPORT_NESTED_ROOT_DENIED = 'IMPORT_NESTED_ROOT_DENIED';
export const FRONTMATTER_INVALID = 'FRONTMATTER_INVALID';

export interface ImportFileEntry {
  path: string;
  utf8_bytes: number;
  digest: string;
  media_type: string;
  executable: boolean;
}

export interface NonImportableEntry {
  path?: string;
  reason: string;
  detail: string;
  retryable: boolean;
}

export interface ImportSourceReceipt {
  rootId: string;
  skillDir: string;
  relativePath: string;
  source: ManagedSkillSource;
  provenance: ManagedSkillProvenance;
  generatedAt: string;
}

export interface ImportManifestResult {
  importable: boolean;
  manifest?: ManagedSkillManifest;
  manifestDigest?: string;
  canonicalBytes?: Buffer;
  files: ImportFileEntry[];
  nonImportable: NonImportableEntry[];
  warnings: string[];
  sourceReceipt: ImportSourceReceipt;
}

export interface BuildImportManifestOptions {
  rootRecord?: ApprovedRootRecord;
  publicId: string;
  logicalId?: string;
  source?: Partial<ManagedSkillSource>;
  provenance?: Partial<ManagedSkillProvenance>;
  limits?: Partial<SkillFilesystemLimits>;
}

const TEXT_MEDIA_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.toml': 'application/toml; charset=utf-8'
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.cjs', '.ps1', '.psm1', '.rb', '.pl', '.bat', '.cmd', '.php', '.lua']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.iso', '.pkg', '.deb', '.rpm', '.jar', '.war']);
const ACTIVE_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.njk', '.hbs', '.handlebars', '.ejs', '.pug', '.jinja', '.jinja2', '.ipynb', '.vue', '.svelte', '.jsx', '.tsx']);

const GENERATED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.output',
  'out',
  'target',
  'bin',
  'obj',
  'tmp',
  'temp'
]);

const GENERATED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  '.ds_store',
  'thumbs.db'
]);

function isHiddenPath(filePath: string): boolean {
  return filePath.split('/').some((segment) => segment.startsWith('.'));
}

function isGeneratedPath(filePath: string): boolean {
  const segments = filePath.split('/');
  for (const segment of segments) {
    if (GENERATED_DIRS.has(segment.toLowerCase())) return true;
  }
  const fileName = segments[segments.length - 1].toLowerCase();
  return GENERATED_FILES.has(fileName) || fileName.endsWith('.lock') || fileName.endsWith('.log');
}

function fileExtension(filePath: string): string {
  const base = path.posix.basename(filePath);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function isImageMagic(bytes: Buffer, ext: string): boolean {
  if (bytes.length < 8) return false;
  if (ext === '.png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === '.webp') {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (ext === '.gif') {
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  }
  return false;
}

function imageMediaTypeFromMagic(bytes: Buffer): string | undefined {
  if (bytes.length < 8) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x57 && bytes[11] === 0x50) return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return undefined;
}

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

function hasShebang(text: string): boolean {
  return text.startsWith('#!');
}

function sameImportFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function readVerifiedFileBytes(absolutePath: string, entry: SkillTreeEntry): Promise<Buffer> {
  const before = await lstat(absolutePath);
  if (!before.isFile()) {
    throw new Error('entry is not a regular file');
  }
  if (before.nlink !== 1) {
    throw new Error('entry is a hard-link alias');
  }

  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!sameImportFileSnapshot(opened, before)) {
      throw new Error('entry changed while opening');
    }

    const bytes = Buffer.alloc(entry.bytes);
    let offset = 0;
    while (offset < entry.bytes) {
      const length = Math.min(64 * 1024, entry.bytes - offset);
      const result = await handle.read(bytes, offset, length, offset);
      if (result.bytesRead <= 0) {
        throw new Error('short read while importing');
      }
      offset += result.bytesRead;
    }

    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, entry.bytes)).bytesRead !== 0) {
      throw new Error('entry grew during read');
    }

    const afterHandle = await handle.stat();
    const afterPath = await lstat(absolutePath);
    if (!sameImportFileSnapshot(afterHandle, before) || !sameImportFileSnapshot(afterPath, before)) {
      throw new Error('entry changed after read');
    }

    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== entry.digest) {
      throw new Error('entry digest does not match verified bytes');
    }

    return bytes;
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Buffer, filePath: string): string {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(bytes);
  } catch {
    throw new ManagedManifestError(MANIFEST_INVALID_UTF8, 'File is not valid UTF-8', filePath);
  }
}

export function classifyPathForPreflight(filePath: string): NonImportableEntry | undefined {
  if (isForbiddenCredentialPath(filePath)) {
    return { path: filePath, reason: IMPORT_SECRET_BLOCKED, detail: 'forbidden credential filename', retryable: false };
  }
  if (isHiddenPath(filePath)) {
    return { path: filePath, reason: IMPORT_HIDDEN_PATH, detail: 'dot-prefixed or hidden segment', retryable: false };
  }
  if (isGeneratedPath(filePath)) {
    return { path: filePath, reason: IMPORT_GENERATED_PATH, detail: 'generated or cache location', retryable: false };
  }
  return undefined;
}

export async function buildImportManifest(
  skillDir: string,
  options: BuildImportManifestOptions
): Promise<ImportManifestResult> {
  const limits = resolveSkillFilesystemLimits(options.limits);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let identity: QualifiedSkillIdentity | undefined;
  try {
    if (options.rootRecord) {
      const resolvedRoot = await realpath(options.rootRecord.realPath);
      identity = await buildQualifiedSkillIdentity({ ...options.rootRecord, realPath: resolvedRoot }, skillDir, { limits });
    } else {
      const resolved = path.resolve(skillDir);
      const resolvedRoot = await realpath(path.dirname(resolved));
      const rootRecord: ApprovedRootRecord = {
        rootId: '00000000-0000-4000-8000-000000000000',
        configuredPath: resolvedRoot,
        realPath: resolvedRoot,
        approvedAt: generatedAt
      };
      identity = await buildQualifiedSkillIdentity(rootRecord, skillDir, { limits });
    }
  } catch (error) {
    const source: ManagedSkillSource = {
      authority: options.source?.authority ?? 'managed',
      kind: options.source?.kind ?? 'local',
      namespace: options.source?.namespace ?? 'owner',
      source_id: options.source?.source_id ?? (options.logicalId ?? path.basename(skillDir)),
      revision: options.source?.revision ?? 'rev-1'
    };
    return {
      importable: false,
      files: [],
      nonImportable: [{
        reason: error instanceof SkillFilesystemLimitError ? MANIFEST_LIMIT_EXCEEDED : IMPORT_UNSAFE_ENTRY,
        detail: 'skill tree cannot be verified',
        retryable: false
      }],
      warnings: [],
      sourceReceipt: buildSourceReceipt(skillDir, identity, limits, options, generatedAt, source)
    };
  }

  const logicalId = options.logicalId ?? path.basename(identity.realPath);
  const publicId = options.publicId;
  const source: ManagedSkillSource = {
    authority: options.source?.authority ?? 'managed',
    kind: options.source?.kind ?? 'local',
    namespace: options.source?.namespace ?? 'owner',
    source_id: options.source?.source_id ?? logicalId,
    revision: options.source?.revision ?? 'rev-1'
  };

  const provenance: ManagedSkillProvenance = {
    publisher_id: options.provenance?.publisher_id ?? 'local-owner',
    ingest_id: options.provenance?.ingest_id ?? 'ingest-1',
    created_at: options.provenance?.created_at ?? generatedAt
  };

  const result = await classifyAndBuildManifest(identity, publicId, source, provenance, limits);
  result.sourceReceipt = buildSourceReceipt(skillDir, identity, limits, options, generatedAt, source);
  return result;
}

function buildSourceReceipt(
  skillDir: string,
  identity: QualifiedSkillIdentity | undefined,
  limits: SkillFilesystemLimits,
  options: BuildImportManifestOptions,
  generatedAt: string,
  source: ManagedSkillSource
): ImportSourceReceipt {
  const logicalId = options.logicalId ?? (identity ? path.basename(identity.realPath) : path.basename(skillDir));
  return {
    rootId: identity?.rootId ?? '00000000-0000-4000-8000-000000000000',
    skillDir,
    relativePath: identity?.relativePath ?? logicalId,
    source,
    provenance: {
      publisher_id: options.provenance?.publisher_id ?? 'local-owner',
      ingest_id: options.provenance?.ingest_id ?? 'ingest-1',
      created_at: options.provenance?.created_at ?? generatedAt
    },
    generatedAt
  };
}

async function classifyAndBuildManifest(
  identity: QualifiedSkillIdentity,
  publicId: string,
  source: ManagedSkillSource,
  provenance: ManagedSkillProvenance,
  limits: SkillFilesystemLimits
): Promise<ImportManifestResult> {
  const nonImportable: NonImportableEntry[] = [];
  const acceptedFiles: ImportFileEntry[] = [];
  const warnings: string[] = [];

  const exactPaths = new Set<string>();
  const hasSkillMdInPrefix = new Set<string>();
  for (const entry of identity.treeEntries) {
    const segments = entry.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const prefix = segments.slice(0, i).join('/');
      if (prefix) hasSkillMdInPrefix.add(prefix);
    }
  }
  const nestedRoots = new Set<string>();
  for (const prefix of hasSkillMdInPrefix) {
    if (identity.treeEntries.some((entry) => entry.path === `${prefix}/SKILL.md`)) {
      nestedRoots.add(prefix);
    }
  }

  let skillMarkdownContent: string | undefined;
  let skillMarkdownValid = false;

  for (const entry of identity.treeEntries) {
    if (exactPaths.has(entry.path)) {
      nonImportable.push({ path: entry.path, reason: IMPORT_UNSAFE_ENTRY, detail: 'duplicate path in tree', retryable: false });
      continue;
    }
    exactPaths.add(entry.path);

    const absolutePath = path.join(identity.realPath, entry.path);

    let snapshot: Stats;
    try {
      snapshot = await lstat(absolutePath);
    } catch {
      nonImportable.push({ path: entry.path, reason: IMPORT_UNSAFE_ENTRY, detail: 'lstat failed or entry disappeared', retryable: false });
      continue;
    }

    if (!snapshot.isFile()) {
      nonImportable.push({ path: entry.path, reason: IMPORT_UNSAFE_ENTRY, detail: 'entry is not a regular file', retryable: false });
      continue;
    }

    if (snapshot.nlink !== 1) {
      nonImportable.push({ path: entry.path, reason: IMPORT_UNSAFE_ENTRY, detail: `hard-link alias (nlink=${snapshot.nlink})`, retryable: false });
      continue;
    }

    if (snapshot.size !== entry.bytes || (snapshot.mode & 0o777) !== entry.mode) {
      nonImportable.push({ path: entry.path, reason: MANIFEST_FILE_DIGEST_MISMATCH, detail: 'entry stat changed after tree verification', retryable: false });
      continue;
    }

    const preflight = classifyPathForPreflight(entry.path);
    if (preflight) {
      nonImportable.push({ ...preflight, path: entry.path });
      continue;
    }

    const parentPrefix = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const nested = parentPrefix && Array.from(nestedRoots).some((root) => parentPrefix === root || parentPrefix.startsWith(`${root}/`));
    if (nested) {
      nonImportable.push({ path: entry.path, reason: IMPORT_NESTED_ROOT_DENIED, detail: 'nested skill root', retryable: false });
      continue;
    }

    if (entry.bytes > limits.maxFileBytes) {
      nonImportable.push({ path: entry.path, reason: MANIFEST_LIMIT_EXCEEDED, detail: `per-file byte limit (${limits.maxFileBytes})`, retryable: false });
      continue;
    }

    const ext = fileExtension(entry.path);

    if (isExecutableMode(snapshot.mode)) {
      nonImportable.push({ path: entry.path, reason: IMPORT_SCRIPT_DENIED, detail: 'executable mode', retryable: false });
      continue;
    }

    if (SCRIPT_EXTENSIONS.has(ext)) {
      nonImportable.push({ path: entry.path, reason: IMPORT_SCRIPT_DENIED, detail: `script-like extension: ${ext}`, retryable: false });
      continue;
    }

    if (ARCHIVE_EXTENSIONS.has(ext)) {
      nonImportable.push({ path: entry.path, reason: IMPORT_ARCHIVE_DENIED, detail: `archive extension: ${ext}`, retryable: false });
      continue;
    }

    if (ACTIVE_EXTENSIONS.has(ext)) {
      nonImportable.push({ path: entry.path, reason: IMPORT_ACTIVE_CONTENT_DENIED, detail: `active markup extension: ${ext}`, retryable: false });
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await readVerifiedFileBytes(absolutePath, entry);
    } catch (readError) {
      nonImportable.push({
        path: entry.path,
        reason: MANIFEST_FILE_DIGEST_MISMATCH,
        detail: readError instanceof Error ? readError.message : String(readError),
        retryable: false
      });
      continue;
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      if (!isImageMagic(bytes, ext)) {
        nonImportable.push({ path: entry.path, reason: IMPORT_FILE_TYPE_DENIED, detail: `image extension ${ext} does not match magic`, retryable: false });
        continue;
      }
      const mediaType = imageMediaTypeFromMagic(bytes) ?? `image/${ext.slice(1)}`;
      const inspection = inspectImportFileForSecrets({ relativePath: entry.path, content: bytes, mediaType });
      if (inspection.decision === 'blocked') {
        nonImportable.push({ path: entry.path, reason: inspection.code, detail: inspection.reason, retryable: false });
        continue;
      }
      acceptedFiles.push({ path: entry.path, utf8_bytes: entry.bytes, digest: entry.digest, media_type: mediaType, executable: false });
      continue;
    }

    if (ext in TEXT_MEDIA_TYPES || entry.path === 'SKILL.md') {
      const mediaType = TEXT_MEDIA_TYPES[ext] ?? 'text/markdown; charset=utf-8';
      try {
        const text = decodeUtf8(bytes, entry.path);
        const inspection = inspectImportFileForSecrets({ relativePath: entry.path, content: bytes, mediaType });
        if (inspection.decision === 'blocked') {
          nonImportable.push({ path: entry.path, reason: inspection.code, detail: inspection.reason, retryable: false });
          continue;
        }
        if (hasShebang(text)) {
          nonImportable.push({ path: entry.path, reason: IMPORT_SCRIPT_DENIED, detail: 'shebang', retryable: false });
          continue;
        }

        if (entry.path === 'SKILL.md') {
          const parsed = parseFrontmatter(text);
          if (!parsed.valid || parsed.errors.some((e) => !e.startsWith('YAML parse warning recovered by fallback'))) {
            nonImportable.push({ path: entry.path, reason: FRONTMATTER_INVALID, detail: `invalid or missing frontmatter: ${parsed.errors.join('; ')}`, retryable: false });
            continue;
          }
          skillMarkdownContent = text;
          skillMarkdownValid = true;
        }

        acceptedFiles.push({ path: entry.path, utf8_bytes: entry.bytes, digest: entry.digest, media_type: mediaType, executable: false });
        continue;
      } catch (utf8Error) {
        nonImportable.push({ path: entry.path, reason: MANIFEST_INVALID_UTF8, detail: utf8Error instanceof Error ? utf8Error.message : String(utf8Error), retryable: false });
        continue;
      }
    }

    const imageByMagic = imageMediaTypeFromMagic(bytes);
    if (imageByMagic) {
      const inspection = inspectImportFileForSecrets({ relativePath: entry.path, content: bytes, mediaType: imageByMagic });
      if (inspection.decision === 'blocked') {
        nonImportable.push({ path: entry.path, reason: inspection.code, detail: inspection.reason, retryable: false });
        continue;
      }
      acceptedFiles.push({ path: entry.path, utf8_bytes: entry.bytes, digest: entry.digest, media_type: imageByMagic, executable: false });
      continue;
    }

    nonImportable.push({ path: entry.path, reason: IMPORT_FILE_TYPE_DENIED, detail: `unrecognized file kind: ${ext || '(none)'}`, retryable: false });
  }

  if (!skillMarkdownValid) {
    nonImportable.push({ path: 'SKILL.md', reason: FRONTMATTER_INVALID, detail: 'missing or invalid SKILL.md frontmatter', retryable: false });
  }

  if (nonImportable.length > 0) {
    return {
      importable: false,
      files: acceptedFiles,
      nonImportable,
      warnings,
      sourceReceipt: { rootId: '', skillDir: '', relativePath: '', source, provenance, generatedAt: provenance.created_at }
    };
  }

  const displayName = extractDisplayName(skillMarkdownContent ?? '', identity.relativePath);
  const description = extractDescription(skillMarkdownContent ?? '');

  const input: Record<string, unknown> = {
    schema_version: '1.0',
    identity: { logical_id: source.source_id, public_id: publicId },
    display: { name: displayName, description },
    source,
    files: acceptedFiles,
    provenance,
    compatibility: { manifest_major: 1, minimum_consumer_major: 1 }
  };

  try {
    const canonical = canonicalizeManagedManifest(input);
    return {
      importable: true,
      manifest: canonical.manifest,
      manifestDigest: canonical.manifestDigest,
      canonicalBytes: canonical.canonicalBytes,
      files: acceptedFiles,
      nonImportable,
      warnings,
      sourceReceipt: { rootId: '', skillDir: '', relativePath: '', source, provenance, generatedAt: provenance.created_at }
    };
  } catch (canonicalError) {
    nonImportable.push({
      reason: canonicalError instanceof ManagedManifestError ? canonicalError.code : MANIFEST_LIMIT_EXCEEDED,
      detail: canonicalError instanceof Error ? canonicalError.message : String(canonicalError),
      retryable: false
    });
    return {
      importable: false,
      files: acceptedFiles,
      nonImportable,
      warnings,
      sourceReceipt: { rootId: '', skillDir: '', relativePath: '', source, provenance, generatedAt: provenance.created_at }
    };
  }
}

function extractDisplayName(skillMarkdown: string, fallback: string): string {
  const parsed = parseFrontmatter(skillMarkdown);
  const requestedName = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : '';
  if (requestedName && isSafeDisplayName(requestedName)) return requestedName;
  return safeFallbackDisplayName(fallback);
}

function extractDescription(skillMarkdown: string): string {
  const parsed = parseFrontmatter(skillMarkdown);
  return typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
}
