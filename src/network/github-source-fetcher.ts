import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { TextDecoder } from 'node:util';

export type GithubSourceFetchErrorCode =
  | 'INVALID_REPOSITORY'
  | 'INVALID_REF'
  | 'INVALID_SUBTREE'
  | 'INVALID_SOURCE_PATH'
  | 'INVALID_TOKEN'
  | 'INVALID_OPTIONS'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'SOURCE_TREE_TOO_LARGE'
  | 'SOURCE_ENTRY_LIMIT'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'CACHE_MISS'
  | 'SUBTREE_NOT_FOUND'
  | 'UNSUPPORTED_ENTRY'
  | 'SOURCE_CHANGED';

export class GithubSourceFetchError extends Error {
  readonly code: GithubSourceFetchErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    code: GithubSourceFetchErrorCode,
    message: string,
    options: { retryable?: boolean; statusCode?: number } = {}
  ) {
    super(message);
    this.name = 'GithubSourceFetchError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

export interface GithubHttpRequest {
  method: 'GET';
  url: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface GithubHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}

export type GithubHttpTransport = (request: GithubHttpRequest) => Promise<GithubHttpResponse>;

export interface GithubSourceFetcherOptions {
  transport?: GithubHttpTransport;
  /** Optional private-source token. It is sent only in an Authorization header. */
  token?: string;
  cacheDir?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
  concurrency?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryAfterMs?: number;
  userAgent?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  signal?: AbortSignal;
}

export interface GithubSourceManifestEntry {
  path: string;
  type: 'file' | 'directory';
  mode: '100644' | '100755' | '040000';
  size: number;
  blobDigest?: string;
  treeDigest?: string;
  contentDigest?: string;
}

export interface GithubSourceFile {
  path: string;
  mode: '100644' | '100755';
  size: number;
  blobDigest: string;
  contentDigest: string;
  bytes: Uint8Array;
}

export interface GithubExactSourceFile extends GithubSourceFile {
  repository: string;
  resolvedCommit: string;
}

export interface GithubSourceSnapshot {
  version: 1;
  provider: 'github';
  repository: string;
  requestedRef: string;
  resolvedCommit: string;
  subtree: string;
  rootTreeDigest: string;
  manifestDigest: string;
  totalBytes: number;
  entries: GithubSourceManifestEntry[];
  files: GithubSourceFile[];
}

interface FetchContext {
  transport: GithubHttpTransport;
  token?: string;
  cacheDir?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
  concurrency: number;
  maxRetries: number;
  retryBaseMs: number;
  maxRetryAfterMs: number;
  userAgent: string;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  random: () => number;
  signal?: AbortSignal;
}

interface CachedResponse {
  etag: string;
  body: Buffer;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

interface ParsedTree {
  entries: GithubSourceManifestEntry[];
  files: Array<{
    path: string;
    mode: '100644' | '100755';
    size: number;
    sha: string;
  }>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_USER_AGENT = 'skillmap-source-fetcher/1';
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Fetches one immutable GitHub skill-tree snapshot. A mutable branch or tag is
 * resolved exactly once; every tree and raw-file request that follows is bound
 * to the returned commit identifier.
 */
export async function fetchGithubSkillTree(
  repository: string,
  ref: string,
  subtree: string,
  options: GithubSourceFetcherOptions = {}
): Promise<GithubSourceSnapshot> {
  const normalizedRepository = validateGithubRepository(repository);
  const normalizedRef = validateGithubRef(ref);
  const normalizedSubtree = validateGithubSubtree(subtree);
  const context = buildContext(options);
  const { owner, name } = splitRepository(normalizedRepository);
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const commitResponse = await getJson(
    `${apiBase}/commits/${encodeURIComponent(normalizedRef)}`,
    context
  );
  const resolvedCommit = requiredDigest(commitResponse.sha, 'commit identifier');
  const commitObject = requiredRecord(commitResponse.commit, 'commit');
  const commitTree = requiredRecord(commitObject.tree, 'commit tree');
  const rootTreeSha = requiredDigest(commitTree.sha, 'root tree identifier');

  const subtreeTreeSha = await resolveSubtreeTreeSha(
    apiBase,
    rootTreeSha,
    normalizedSubtree,
    context
  );
  const recursiveTree = await getJson(
    `${apiBase}/git/trees/${encodeURIComponent(subtreeTreeSha)}?recursive=1`,
    context
  );
  const parsed = parseRecursiveTree(recursiveTree, context.maxEntries);
  const declaredTotalBytes = parsed.files.reduce((total, file) => total + file.size, 0);
  if (declaredTotalBytes > context.maxTotalBytes) {
    throw new GithubSourceFetchError(
      'SOURCE_TREE_TOO_LARGE',
      `GitHub skill tree exceeds the configured ${context.maxTotalBytes}-byte total limit.`
    );
  }
  for (const file of parsed.files) {
    if (file.size > context.maxResponseBytes) {
      throw new GithubSourceFetchError(
        'RESPONSE_TOO_LARGE',
        `A GitHub skill-tree file exceeds the configured ${context.maxResponseBytes}-byte response limit.`
      );
    }
  }

  let downloadedBytes = 0;
  const downloaded = await mapWithConcurrency(parsed.files, context.concurrency, async (file) => {
    const remotePath = joinRemotePath(normalizedSubtree, file.path);
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${resolvedCommit}/${encodeRemotePath(remotePath)}`;
    const response = await getResponse(rawUrl, context, 'application/octet-stream');
    assertSuccessfulResponse(response);
    const bytes = Buffer.from(response.body);
    if (bytes.length !== file.size) {
      throw new GithubSourceFetchError(
        'SOURCE_CHANGED',
        'GitHub raw content size does not match the immutable tree manifest.'
      );
    }
    const providerDigest = gitBlobDigest(bytes, file.sha.length);
    if (providerDigest !== file.sha) {
      throw new GithubSourceFetchError(
        'SOURCE_CHANGED',
        'GitHub raw content does not match the immutable tree blob digest.'
      );
    }
    downloadedBytes += bytes.length;
    if (downloadedBytes > context.maxTotalBytes) {
      throw new GithubSourceFetchError(
        'SOURCE_TREE_TOO_LARGE',
        `GitHub skill tree exceeds the configured ${context.maxTotalBytes}-byte total limit.`
      );
    }
    const contentDigest = sha256Digest(bytes);
    return {
      path: file.path,
      mode: file.mode,
      size: bytes.length,
      blobDigest: `git:${file.sha}`,
      contentDigest,
      bytes: new Uint8Array(bytes)
    } satisfies GithubSourceFile;
  });

  downloaded.sort((left, right) => comparePaths(left.path, right.path));
  const contentDigests = new Map(downloaded.map((file) => [file.path, file.contentDigest]));
  const entries = parsed.entries.map((entry) => entry.type === 'file'
    ? { ...entry, contentDigest: contentDigests.get(entry.path) }
    : entry);
  entries.sort((left, right) => comparePaths(left.path, right.path));

  const canonicalSubtree = normalizedSubtree || '.';
  const snapshot = {
    version: 1,
    provider: 'github',
    repository: normalizedRepository,
    requestedRef: normalizedRef,
    resolvedCommit,
    subtree: canonicalSubtree,
    rootTreeDigest: `git:${subtreeTreeSha}`,
    manifestDigest: '',
    totalBytes: downloaded.reduce((total, file) => total + file.size, 0),
    entries,
    files: downloaded
  } satisfies GithubSourceSnapshot;
  snapshot.manifestDigest = computeGithubSnapshotManifestDigest(snapshot);
  return snapshot;
}

/**
 * Fetch one explicitly named regular file from an immutable GitHub commit.
 * The commit and path are resolved through Git tree objects before the raw
 * bytes are accepted, so callers never need to fetch an enclosing repository
 * tree merely to bind root or ancestor license evidence.
 */
export async function fetchGithubExactSourceFile(
  repository: string,
  commit: string,
  sourcePath: string,
  options: GithubSourceFetcherOptions = {}
): Promise<GithubExactSourceFile> {
  const normalizedRepository = validateGithubRepository(repository);
  const normalizedCommit = validateGithubImmutableCommit(commit);
  const normalizedPath = validateGithubSourceFilePath(sourcePath);
  const baseContext = buildContext(options);
  const context: FetchContext = {
    ...baseContext,
    maxResponseBytes: Math.min(baseContext.maxResponseBytes, 1024 * 1024),
    maxTotalBytes: Math.min(baseContext.maxTotalBytes, 1024 * 1024),
    maxEntries: 1
  };
  const { owner, name } = splitRepository(normalizedRepository);
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const commitResponse = await getJson(
    `${apiBase}/commits/${encodeURIComponent(normalizedCommit)}`,
    context
  );
  const resolvedCommit = requiredDigest(commitResponse.sha, 'commit identifier');
  if (resolvedCommit !== normalizedCommit) {
    throw new GithubSourceFetchError(
      'SOURCE_CHANGED',
      'GitHub did not resolve the requested immutable commit exactly.'
    );
  }
  const commitObject = requiredRecord(commitResponse.commit, 'commit');
  const commitTree = requiredRecord(commitObject.tree, 'commit tree');
  const rootTreeSha = requiredDigest(commitTree.sha, 'root tree identifier');
  const directory = path.posix.dirname(normalizedPath);
  const directoryTreeSha = await resolveSubtreeTreeSha(
    apiBase,
    rootTreeSha,
    directory === '.' ? '' : directory,
    context
  );
  const directoryTree = await getJson(
    `${apiBase}/git/trees/${encodeURIComponent(directoryTreeSha)}`,
    context
  );
  if (directoryTree.truncated === true) {
    throw new GithubSourceFetchError(
      'INVALID_RESPONSE',
      'GitHub returned a truncated tree while resolving the exact source file.'
    );
  }
  const basename = path.posix.basename(normalizedPath);
  const matches = requiredArray(directoryTree.tree, 'tree entries')
    .map((entry) => requiredRecord(entry, 'tree entry'))
    .filter((entry) => entry.path === basename);
  if (matches.length !== 1) {
    throw new GithubSourceFetchError(
      'SUBTREE_NOT_FOUND',
      'GitHub exact source file was not found at the requested immutable commit.'
    );
  }
  const match = matches[0];
  const mode = requiredString(match.mode, 'tree entry mode');
  const type = requiredString(match.type, 'tree entry type');
  if (type === 'commit' || mode === '160000' || mode === '120000') {
    throw new GithubSourceFetchError(
      'UNSUPPORTED_ENTRY',
      'GitHub exact source file resolves through an unsupported link or submodule boundary.'
    );
  }
  if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
    throw new GithubSourceFetchError(
      'UNSUPPORTED_ENTRY',
      'GitHub exact source file must resolve to a regular file.'
    );
  }
  const sha = requiredDigest(match.sha, 'tree entry identifier');
  if (!Number.isSafeInteger(match.size) || Number(match.size) < 0) {
    throw new GithubSourceFetchError(
      'INVALID_RESPONSE',
      'GitHub exact source file is missing a valid byte size.'
    );
  }
  const size = Number(match.size);
  if (size > context.maxResponseBytes || size > context.maxTotalBytes) {
    throw new GithubSourceFetchError(
      'RESPONSE_TOO_LARGE',
      'GitHub exact source file exceeds the configured bounded evidence-file limit.'
    );
  }
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${resolvedCommit}/${encodeRemotePath(normalizedPath)}`;
  const response = await getResponse(rawUrl, context, 'application/octet-stream');
  assertSuccessfulResponse(response);
  const bytes = Buffer.from(response.body);
  if (bytes.length !== size || gitBlobDigest(bytes, sha.length) !== sha) {
    throw new GithubSourceFetchError(
      'SOURCE_CHANGED',
      'GitHub raw content does not match the exact immutable tree entry.'
    );
  }
  return {
    repository: normalizedRepository,
    resolvedCommit,
    path: normalizedPath,
    mode,
    size,
    blobDigest: `git:${sha}`,
    contentDigest: sha256Digest(bytes),
    bytes: new Uint8Array(bytes)
  };
}

/** Recompute the immutable GitHub manifest projection from snapshot fields. */
export function computeGithubSnapshotManifestDigest(
  snapshot: Pick<GithubSourceSnapshot, 'version' | 'provider' | 'repository' | 'resolvedCommit' | 'subtree' | 'rootTreeDigest' | 'entries'>
): string {
  const manifestPayload = {
    version: snapshot.version,
    provider: snapshot.provider,
    repository: snapshot.repository,
    resolvedCommit: snapshot.resolvedCommit,
    subtree: snapshot.subtree,
    rootTreeDigest: snapshot.rootTreeDigest,
    entries: [...snapshot.entries]
      .sort((left, right) => comparePaths(left.path, right.path))
      .map((entry) => ({
        path: entry.path,
        type: entry.type,
        mode: entry.mode,
        size: entry.size,
        ...(entry.blobDigest ? { blobDigest: entry.blobDigest } : {}),
        ...(entry.treeDigest ? { treeDigest: entry.treeDigest } : {}),
        ...(entry.contentDigest ? { contentDigest: entry.contentDigest } : {})
      }))
  };
  return sha256Digest(Buffer.from(JSON.stringify(manifestPayload)));
}

/** Compute the same complete-tree semantic digest used by local skill identity. */
export function computeSnapshotContentRevision(snapshot: Pick<GithubSourceSnapshot, 'files'>): string {
  const revision = createHash('sha256');
  revision.update('skillmap-content-revision\0v1\0');
  const files = [...snapshot.files].sort((left, right) => comparePaths(left.path, right.path));
  for (const file of files) {
    updateLengthPrefixed(revision, Buffer.from(file.path));
    updateLengthPrefixed(revision, Buffer.from(file.mode === '100755' ? '755' : '644'));
    updateLengthPrefixed(revision, Buffer.from(file.bytes));
  }
  return `sha256:${revision.digest('hex')}`;
}

export function validateGithubRepository(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 140 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GithubSourceFetchError('INVALID_REPOSITORY', 'GitHub repository must be a canonical OWNER/REPO value.');
  }
  const parts = value.split('/');
  if (parts.length !== 2) {
    throw new GithubSourceFetchError('INVALID_REPOSITORY', 'GitHub repository must be a canonical OWNER/REPO value.');
  }
  const [owner, repository] = parts;
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)
    && !owner.includes('--');
  const validRepository = /^[A-Za-z0-9._-]{1,100}$/.test(repository)
    && repository !== '.'
    && repository !== '..';
  if (!validOwner || !validRepository) {
    throw new GithubSourceFetchError('INVALID_REPOSITORY', 'GitHub repository must be a canonical OWNER/REPO value.');
  }
  return `${owner}/${repository}`;
}

export function validateGithubRef(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0 || value.length > 240) {
    throw new GithubSourceFetchError('INVALID_REF', 'GitHub ref is invalid.');
  }
  if (value !== value.normalize('NFC')
    || /[\u0000-\u0020\u007f~^:?*#%]/.test(value)
    || value.includes('\\')
    || value.includes('[')
    || value.includes(']')
    || value === '@'
    || value.startsWith('-')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.endsWith('.')
    || value.includes('..')
    || value.includes('//')
    || value.includes('@{')) {
    throw new GithubSourceFetchError('INVALID_REF', 'GitHub ref is invalid.');
  }
  const components = value.split('/');
  if (components.some((component) => component.length === 0
    || component === '.'
    || component === '..'
    || component.startsWith('.')
    || component.endsWith('.lock'))) {
    throw new GithubSourceFetchError('INVALID_REF', 'GitHub ref is invalid.');
  }
  return value;
}

export function validateGithubImmutableCommit(value: string): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new GithubSourceFetchError(
      'INVALID_REF',
      'GitHub exact source evidence requires an immutable lowercase 40- or 64-hex commit.'
    );
  }
  return value;
}

export function validateGithubSourceFilePath(value: string): string {
  if (typeof value !== 'string' || value.length > 500) {
    throw new GithubSourceFetchError(
      'INVALID_SOURCE_PATH',
      'GitHub exact source file path must be a bounded normalized relative path.'
    );
  }
  try {
    return validateRemoteRelativePath(value, 'INVALID_SOURCE_PATH');
  } catch (error) {
    if (error instanceof GithubSourceFetchError && error.code === 'INVALID_SOURCE_PATH') {
      throw new GithubSourceFetchError(
        'INVALID_SOURCE_PATH',
        'GitHub exact source file path must be a bounded normalized relative path.'
      );
    }
    throw error;
  }
}

export function validateGithubSubtree(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0 || value.length > 1_024) {
    throw new GithubSourceFetchError('INVALID_SUBTREE', 'GitHub subtree must be a normalized relative path.');
  }
  if (value === '.') return '';
  return validateRemoteRelativePath(value, 'INVALID_SUBTREE');
}

export const nodeHttpsGithubTransport: GithubHttpTransport = async (request) => {
  const target = new URL(request.url);
  if (target.protocol !== 'https:') {
    throw new GithubSourceFetchError('NETWORK_ERROR', 'GitHub transport requires HTTPS.');
  }
  return new Promise<GithubHttpResponse>((resolve, reject) => {
    let settled = false;
    const finishResolve = (response: GithubHttpResponse): void => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const outgoing = httpsRequest(target, {
      method: request.method,
      headers: request.headers,
      signal: request.signal
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let length = 0;
      incoming.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > request.maxResponseBytes) {
          incoming.destroy();
          finishReject(new GithubSourceFetchError(
            'RESPONSE_TOO_LARGE',
            `GitHub response exceeds the configured ${request.maxResponseBytes}-byte limit.`
          ));
          return;
        }
        chunks.push(bytes);
      });
      incoming.on('end', () => {
        const headers: Record<string, string | undefined> = {};
        for (const [key, headerValue] of Object.entries(incoming.headers)) {
          headers[key.toLowerCase()] = Array.isArray(headerValue) ? headerValue.join(', ') : headerValue;
        }
        finishResolve({
          status: incoming.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks, length)
        });
      });
      incoming.on('error', finishReject);
    });
    outgoing.on('error', finishReject);
    outgoing.end();
  });
};

async function resolveSubtreeTreeSha(
  apiBase: string,
  rootTreeSha: string,
  subtree: string,
  context: FetchContext
): Promise<string> {
  let currentTreeSha = rootTreeSha;
  if (!subtree) return currentTreeSha;
  for (const component of subtree.split('/')) {
    const tree = await getJson(
      `${apiBase}/git/trees/${encodeURIComponent(currentTreeSha)}`,
      context
    );
    const entries = requiredArray(tree.tree, 'tree entries');
    if (tree.truncated === true) {
      throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub returned a truncated tree while resolving the source subtree.');
    }
    const match = entries
      .map((entry) => requiredRecord(entry, 'tree entry'))
      .find((entry) => entry.path === component);
    if (!match) {
      throw new GithubSourceFetchError('SUBTREE_NOT_FOUND', 'GitHub source subtree was not found at the resolved commit.');
    }
    if (match.type === 'commit' || match.mode === '160000') {
      throw new GithubSourceFetchError('UNSUPPORTED_ENTRY', 'GitHub source subtree contains a submodule boundary.');
    }
    if (match.type !== 'tree' || match.mode !== '040000') {
      throw new GithubSourceFetchError('INVALID_SUBTREE', 'GitHub source subtree does not resolve to a regular directory.');
    }
    currentTreeSha = requiredDigest(match.sha, 'subtree tree identifier');
  }
  return currentTreeSha;
}

function parseRecursiveTree(value: Record<string, unknown>, maxEntries: number): ParsedTree {
  if (value.truncated === true) {
    throw new GithubSourceFetchError('SOURCE_ENTRY_LIMIT', 'GitHub returned a truncated recursive source tree.');
  }
  const rawEntries = requiredArray(value.tree, 'recursive tree entries');
  if (rawEntries.length > maxEntries) {
    throw new GithubSourceFetchError(
      'SOURCE_ENTRY_LIMIT',
      `GitHub skill tree exceeds the configured ${maxEntries}-entry limit.`
    );
  }
  const entries: GithubSourceManifestEntry[] = [];
  const files: ParsedTree['files'] = [];
  const seen = new Set<string>();

  for (const rawEntry of rawEntries) {
    const entry = requiredRecord(rawEntry, 'recursive tree entry') as unknown as GitTreeEntry;
    const entryPath = validateRemoteRelativePath(requiredString(entry.path, 'tree entry path'), 'INVALID_RESPONSE');
    if (seen.has(entryPath)) {
      throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub recursive tree contains duplicate normalized paths.');
    }
    seen.add(entryPath);
    const sha = requiredDigest(entry.sha, 'tree entry identifier');
    const mode = requiredString(entry.mode, 'tree entry mode');
    const type = requiredString(entry.type, 'tree entry type');

    if (type === 'commit' || mode === '160000') {
      throw new GithubSourceFetchError('UNSUPPORTED_ENTRY', 'GitHub skill tree contains a submodule.');
    }
    if (mode === '120000') {
      throw new GithubSourceFetchError('UNSUPPORTED_ENTRY', 'GitHub skill tree contains a symbolic link.');
    }
    if (type === 'tree') {
      if (mode !== '040000') {
        throw new GithubSourceFetchError('UNSUPPORTED_ENTRY', 'GitHub skill tree contains an unsupported directory mode.');
      }
      entries.push({ path: entryPath, type: 'directory', mode, size: 0, treeDigest: `git:${sha}` });
      continue;
    }
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new GithubSourceFetchError('UNSUPPORTED_ENTRY', 'GitHub skill tree contains an unsupported entry type or mode.');
    }
    if (!Number.isSafeInteger(entry.size) || Number(entry.size) < 0) {
      throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub tree blob is missing a valid byte size.');
    }
    const size = Number(entry.size);
    entries.push({ path: entryPath, type: 'file', mode, size, blobDigest: `git:${sha}` });
    files.push({ path: entryPath, mode, size, sha });
  }

  entries.sort((left, right) => comparePaths(left.path, right.path));
  files.sort((left, right) => comparePaths(left.path, right.path));
  const filePaths = new Set(files.map((file) => file.path));
  if (!filePaths.has('SKILL.md')) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub skill tree is missing a regular SKILL.md file.');
  }
  for (const file of files) {
    const components = file.path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      if (filePaths.has(components.slice(0, index).join('/'))) {
        throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub skill tree contains a file/directory path conflict.');
      }
    }
  }
  return { entries, files };
}

async function getJson(url: string, context: FetchContext): Promise<Record<string, unknown>> {
  const response = await getResponse(url, context, 'application/vnd.github+json');
  assertSuccessfulResponse(response);
  const contentType = responseHeader(response.headers, 'content-type');
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub API returned an unexpected content type.');
  }
  try {
    return requiredRecord(JSON.parse(JSON_DECODER.decode(response.body)), 'GitHub JSON response');
  } catch (error) {
    if (error instanceof GithubSourceFetchError) throw error;
    throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub API returned invalid UTF-8 JSON.');
  }
}

async function getResponse(url: string, context: FetchContext, accept: string): Promise<GithubHttpResponse> {
  const cached = context.cacheDir
    ? await readCachedResponse(context.cacheDir, url, context.maxResponseBytes)
    : undefined;
  const headers: Record<string, string> = {
    accept,
    'user-agent': context.userAgent,
    'x-github-api-version': '2022-11-28'
  };
  if (context.token) headers.authorization = `Bearer ${context.token}`;
  if (cached) headers['if-none-match'] = cached.etag;

  const response = await requestWithRetries(url, headers, context);
  if (response.status === 304) {
    if (!cached) {
      throw new GithubSourceFetchError('CACHE_MISS', 'GitHub returned not-modified without a verified local cache entry.');
    }
    return { status: 200, headers: response.headers, body: cached.body };
  }
  if (response.status === 200 && context.cacheDir) {
    const etag = responseHeader(response.headers, 'etag');
    if (isSafeEtag(etag)) await writeCachedResponse(context.cacheDir, url, etag, response.body);
  }
  return response;
}

async function requestWithRetries(
  url: string,
  headers: Readonly<Record<string, string>>,
  context: FetchContext
): Promise<GithubHttpResponse> {
  for (let attempt = 0; ; attempt += 1) {
    assertNotAborted(context);
    const response = await requestOnce(url, headers, context);
    const retryableStatus = response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599);
    if (!retryableStatus || attempt >= context.maxRetries) return response;
    const retryAfter = retryDelay(response.headers, attempt, context);
    await sleepWithAbort(retryAfter, context);
  }
}

async function requestOnce(
  url: string,
  headers: Readonly<Record<string, string>>,
  context: FetchContext
): Promise<GithubHttpResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((error: GithubSourceFetchError) => void) | undefined;
  const abort = () => {
    controller.abort();
    rejectAbort?.(new GithubSourceFetchError('REQUEST_ABORTED', 'GitHub source request was cancelled.', { retryable: true }));
  };
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new GithubSourceFetchError('REQUEST_TIMEOUT', 'GitHub request timed out.'));
      controller.abort();
    }, context.timeoutMs);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  context.signal?.addEventListener('abort', abort, { once: true });
  if (context.signal?.aborted) abort();
  try {
    const response = await Promise.race([
      context.transport({
        method: 'GET',
        url,
        headers,
        signal: controller.signal,
        maxResponseBytes: context.maxResponseBytes
      }),
      timeoutPromise,
      abortPromise
    ]);
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || !(response.body instanceof Uint8Array)) {
      throw new GithubSourceFetchError('INVALID_RESPONSE', 'GitHub transport returned an invalid response envelope.');
    }
    if (response.body.byteLength > context.maxResponseBytes) {
      throw new GithubSourceFetchError(
        'RESPONSE_TOO_LARGE',
        `GitHub response exceeds the configured ${context.maxResponseBytes}-byte limit.`
      );
    }
    return { status: response.status, headers: normalizeHeaders(response.headers), body: Buffer.from(response.body) };
  } catch (error) {
    if (error instanceof GithubSourceFetchError) {
      if (context.token && error.message.includes(context.token)) {
        throw new GithubSourceFetchError(error.code, 'GitHub request failed safely.', {
          retryable: error.retryable,
          statusCode: error.statusCode
        });
      }
      throw error;
    }
    throw new GithubSourceFetchError('NETWORK_ERROR', 'GitHub request failed.', { retryable: false });
  } finally {
    if (timeout) clearTimeout(timeout);
    context.signal?.removeEventListener('abort', abort);
  }
}

function assertSuccessfulResponse(response: GithubHttpResponse): void {
  if (response.status === 200) return;
  if (response.status === 429) {
    throw new GithubSourceFetchError('RATE_LIMITED', 'GitHub rate limit was not satisfied after bounded retries.', {
      retryable: true,
      statusCode: response.status
    });
  }
  const retryable = response.status === 408 || (response.status >= 500 && response.status <= 599);
  throw new GithubSourceFetchError('HTTP_ERROR', `GitHub request failed with HTTP status ${response.status}.`, {
    retryable,
    statusCode: response.status
  });
}

function retryDelay(
  headers: Readonly<Record<string, string | undefined>>,
  attempt: number,
  context: FetchContext
): number {
  const retryAfter = responseHeader(headers, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(context.maxRetryAfterMs, Math.ceil(seconds * 1_000));
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(context.maxRetryAfterMs, Math.max(0, date - context.now()));
    }
  }
  const exponential = context.retryBaseMs * (2 ** attempt);
  const jittered = exponential * (0.75 + context.random() * 0.5);
  return Math.min(context.maxRetryAfterMs, Math.max(0, Math.round(jittered)));
}

function buildContext(options: GithubSourceFetcherOptions): FetchContext {
  const token = validateToken(options.token);
  return {
    transport: options.transport ?? nodeHttpsGithubTransport,
    token,
    cacheDir: options.cacheDir ? path.resolve(options.cacheDir) : undefined,
    timeoutMs: boundedInteger('timeoutMs', options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000),
    maxResponseBytes: boundedInteger('maxResponseBytes', options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1, 128 * 1024 * 1024),
    maxTotalBytes: boundedInteger('maxTotalBytes', options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 1, 512 * 1024 * 1024),
    maxEntries: boundedInteger('maxEntries', options.maxEntries, DEFAULT_MAX_ENTRIES, 1, 100_000),
    concurrency: boundedInteger('concurrency', options.concurrency, DEFAULT_CONCURRENCY, 1, 16),
    maxRetries: boundedInteger('maxRetries', options.maxRetries, DEFAULT_MAX_RETRIES, 0, 5),
    retryBaseMs: boundedInteger('retryBaseMs', options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 0, 60_000),
    maxRetryAfterMs: boundedInteger('maxRetryAfterMs', options.maxRetryAfterMs, DEFAULT_MAX_RETRY_AFTER_MS, 0, 120_000),
    userAgent: validateUserAgent(options.userAgent ?? DEFAULT_USER_AGENT),
    sleep: options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))),
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
    ...(options.signal ? { signal: options.signal } : {})
  };
}

function assertNotAborted(context: FetchContext): void {
  if (context.signal?.aborted) throw new GithubSourceFetchError('REQUEST_ABORTED', 'GitHub source request was cancelled.', { retryable: true });
}

async function sleepWithAbort(milliseconds: number, context: FetchContext): Promise<void> {
  assertNotAborted(context);
  if (!context.signal) return context.sleep(milliseconds);
  let rejectAbort: ((error: GithubSourceFetchError) => void) | undefined;
  const abort = () => rejectAbort?.(new GithubSourceFetchError('REQUEST_ABORTED', 'GitHub source request was cancelled.', { retryable: true }));
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    if (context.signal.aborted) abort();
    await Promise.race([context.sleep(milliseconds), aborted]);
  } finally {
    context.signal.removeEventListener('abort', abort);
  }
}

function boundedInteger(name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new GithubSourceFetchError('INVALID_OPTIONS', `${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function validateToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4_096 || token !== token.trim() || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new GithubSourceFetchError('INVALID_TOKEN', 'GitHub token is invalid.');
  }
  return token;
}

function validateUserAgent(value: string): string {
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GithubSourceFetchError('INVALID_OPTIONS', 'userAgent is invalid.');
  }
  return value;
}

async function readCachedResponse(cacheDir: string, url: string, maxResponseBytes: number): Promise<CachedResponse | undefined> {
  const file = cacheFile(cacheDir, url);
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maxResponseBytes * 2 + 16_384) throw new Error('invalid cache size');
    const raw = await readFile(file, 'utf8');
    const value = requiredRecord(JSON.parse(raw), 'cache entry');
    if (value.version !== 1 || value.url !== url || value.status !== 200
      || typeof value.etag !== 'string' || !isSafeEtag(value.etag)
      || typeof value.bodyBase64 !== 'string' || typeof value.contentDigest !== 'string') {
      throw new Error('invalid cache entry');
    }
    const body = Buffer.from(value.bodyBase64, 'base64');
    if (body.length > maxResponseBytes
      || body.toString('base64') !== value.bodyBase64
      || sha256Digest(body) !== value.contentDigest) {
      throw new Error('invalid cache digest');
    }
    return { etag: value.etag, body };
  } catch {
    await safeUnlink(file);
    return undefined;
  }
}

async function writeCachedResponse(cacheDir: string, url: string, etag: string, bodyValue: Uint8Array): Promise<void> {
  try {
    const body = Buffer.from(bodyValue);
    const file = cacheFile(cacheDir, url);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const value = {
      version: 1,
      url,
      status: 200,
      etag,
      contentDigest: sha256Digest(body),
      bodyBase64: body.toString('base64')
    };
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } catch {
    // Cache availability must not turn an otherwise verified immutable fetch
    // into a source failure. A later request will fetch and verify again.
  }
}

function cacheFile(cacheDir: string, url: string): string {
  const key = createHash('sha256').update(`GET\0${url}`).digest('hex');
  return path.join(cacheDir, key.slice(0, 2), `${key}.json`);
}

async function safeUnlink(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    // Missing or unreadable cache entries are treated as cache misses.
  }
}

function isSafeEtag(value: string | undefined): value is string {
  return Boolean(value && value.length <= 1_024 && !/[\u0000-\u001f\u007f]/.test(value));
}

function normalizeHeaders(headers: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[key.toLowerCase()] = value;
  }
  return result;
}

function responseHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const requested = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === requested && typeof value === 'string') return value;
  }
  return undefined;
}

function validateRemoteRelativePath(
  value: string,
  code: 'INVALID_SUBTREE' | 'INVALID_SOURCE_PATH' | 'INVALID_RESPONSE'
): string {
  if (!value || value.length > 4_096 || value !== value.normalize('NFC')
    || value.startsWith('/') || value.endsWith('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GithubSourceFetchError(code, 'GitHub tree contains an invalid relative path.');
  }
  const components = value.split('/');
  if (components.some(component => !component || component === '.' || component === '..')) {
    throw new GithubSourceFetchError(code, 'GitHub tree contains an invalid relative path.');
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new GithubSourceFetchError(code, 'GitHub tree contains an invalid relative path.');
  }
  return normalized;
}

function joinRemotePath(subtree: string, relativePath: string): string {
  return subtree ? `${subtree}/${relativePath}` : relativePath;
}

function encodeRemotePath(value: string): string {
  return value.split('/').map(component => encodeURIComponent(component)).join('/');
}

function splitRepository(repository: string): { owner: string; name: string } {
  const [owner, name] = repository.split('/');
  return { owner, name };
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', `GitHub ${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', `GitHub ${label} is malformed.`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', `GitHub ${label} is malformed.`);
  }
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const digest = requiredString(value, label).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(digest) && !/^[a-f0-9]{64}$/.test(digest)) {
    throw new GithubSourceFetchError('INVALID_RESPONSE', `GitHub ${label} is malformed.`);
  }
  return digest;
}

function gitBlobDigest(bytes: Uint8Array, digestLength: number): string {
  const algorithm = digestLength === 64 ? 'sha256' : 'sha1';
  const header = Buffer.from(`blob ${bytes.byteLength}\0`);
  return createHash(algorithm).update(header).update(bytes).digest('hex');
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: Buffer): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.length));
  hash.update(length);
  hash.update(value);
}

function sha256Digest(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
