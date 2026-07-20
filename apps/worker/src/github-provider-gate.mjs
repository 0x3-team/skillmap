import { TextDecoder } from 'node:util';
import {
  GithubSourceFetchError,
  githubRateLimitRetryAfterMs,
  isGithubRateLimitResponse,
  nodeHttpsGithubTransport
} from '../../../dist/network/github-source-fetcher.js';
import { canonicalDigest } from './operator-receipts.mjs';

const RATE_LIMIT_URL = 'https://api.github.com/rate_limit';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MIN_DEFER_SECONDS = 60;
const MAX_DEFER_SECONDS = 2 * 60 * 60;
const CORE_REQUEST_RESERVE = 2;
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Estimate the normal GitHub core-API calls before an exact candidate is
 * claimed. Raw immutable file downloads do not consume the REST core bucket.
 */
export function estimateGithubCoreRequestBudget(sourcePath, licenseEvidencePaths = []) {
  const source = validateRelativePath(sourcePath, /(?:^|\/)SKILL\.md$/, 'safe relative SKILL.md path');
  if (!Array.isArray(licenseEvidencePaths) || licenseEvidencePaths.length > 20) {
    throw new Error('license evidence paths must be a bounded array.');
  }
  const sourceDirectoryDepth = source.split('/').length - 1;
  const sourceDirectoryComponents = source.split('/').slice(0, -1);
  let budget = 1 + 2 + sourceDirectoryDepth; // public preflight + commit + recursive tree
  for (const value of licenseEvidencePaths) {
    const evidence = validateRelativePath(
      value,
      /(?:^|\/)(?:licen[cs]e|copying)(?:\.[a-z0-9_-]+)?$/i,
      'safe relative license evidence path'
    );
    const evidenceDirectoryComponents = evidence.split('/').slice(0, -1);
    if (evidenceDirectoryComponents.length > 0
      && evidenceDirectoryComponents.some((component, index) => sourceDirectoryComponents[index] !== component)) {
      throw new Error('License evidence must be at the repository root or enclose the submitted SKILL.md.');
    }
    budget += 2 + evidenceDirectoryComponents.length; // commit + enclosing tree walk/final tree
  }
  return budget;
}

/** Read the unauthenticated primary core budget without consuming core quota. */
export async function inspectGithubCoreRateLimit(options = {}) {
  const timeoutMs = boundedInteger('timeoutMs', options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 120_000);
  const transport = options.transport ?? nodeHttpsGithubTransport;
  const now = options.now ?? Date.now;
  if (typeof transport !== 'function') throw new Error('GitHub rate-limit transport must be a function.');
  if (typeof now !== 'function') throw new Error('GitHub rate-limit clock must be a function.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await transport({
      method: 'GET',
      url: RATE_LIMIT_URL,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillmap-hosted-audit-worker/1',
        'x-github-api-version': '2022-11-28'
      },
      signal: controller.signal,
      maxResponseBytes: MAX_RESPONSE_BYTES
    });
  } catch (error) {
    if (error instanceof GithubSourceFetchError) throw error;
    if (controller.signal.aborted) throw new Error('GitHub rate-limit inspection timed out.');
    throw new Error('GitHub rate-limit inspection failed.');
  } finally {
    clearTimeout(timer);
  }

  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('GitHub rate-limit inspection returned an invalid status.');
  }
  if (isGithubRateLimitResponse(status, response.headers ?? {}, response.body)) {
    throw new GithubSourceFetchError('RATE_LIMITED', 'GitHub rate-limit inspection was throttled.', {
      retryable: true,
      statusCode: status,
      retryAfterMs: githubRateLimitRetryAfterMs(response.headers ?? {}, now())
    });
  }
  if (status !== 200) throw new Error(`GitHub rate-limit inspection requires a 200 response; received ${status}.`);
  if (!(response.body instanceof Uint8Array) || response.body.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('GitHub rate-limit inspection returned an invalid or oversized response.');
  }

  let payload;
  try {
    payload = JSON.parse(JSON_DECODER.decode(response.body));
  } catch {
    throw new Error('GitHub rate-limit inspection returned invalid JSON.');
  }
  const core = payload?.resources?.core;
  if (!core || typeof core !== 'object' || Array.isArray(core)
    || !Number.isSafeInteger(core.limit) || core.limit < 1
    || !Number.isSafeInteger(core.remaining) || core.remaining < 0 || core.remaining > core.limit
    || !Number.isSafeInteger(core.used) || core.used < 0 || core.used > core.limit
    || !Number.isSafeInteger(core.reset) || core.reset < 0) {
    throw new Error('GitHub rate-limit inspection returned invalid core authority.');
  }
  const resetMs = core.reset * 1_000;
  if (!Number.isSafeInteger(resetMs)) throw new Error('GitHub rate-limit reset is out of range.');
  return Object.freeze({
    limit: core.limit,
    remaining: core.remaining,
    used: core.used,
    resetAt: new Date(resetMs).toISOString(),
    retryAfterMs: Math.min(MAX_DEFER_SECONDS * 1_000, Math.max(0, resetMs - now()))
  });
}

/** Peek, budget, and then bind the mutation to the exact peeked candidate. */
export async function prepareGithubBudgetedClaim(options, dependencies = {}) {
  const rpc = options?.rpc;
  if (!rpc || typeof rpc.call !== 'function') throw new Error('A Supabase RPC client is required.');
  const workerVersion = validateWorkerVersion(options.workerVersion);
  const submissionId = options.submissionId ?? null;
  if (submissionId !== null && !/^sub_[0-9a-f]{32}$/.test(submissionId)) {
    throw new Error('Submission id is invalid.');
  }
  const candidates = await rpc.call('peek_skill_submission_candidate', {
    p_submission_id: submissionId
  });
  if (!Array.isArray(candidates) || candidates.length > 1) {
    throw new Error('Candidate peek RPC returned an invalid bounded result.');
  }
  if (candidates.length === 0) return Object.freeze({ result: 'idle', mutation: false });
  const candidate = validateCandidate(candidates[0]);
  const estimatedCoreRequests = estimateGithubCoreRequestBudget(
    candidate.source_path,
    options.licenseEvidencePaths ?? []
  );
  const requiredCoreRequests = estimatedCoreRequests + CORE_REQUEST_RESERVE;
  const inspectRateLimit = dependencies.inspectRateLimit ?? inspectGithubCoreRateLimit;
  if (typeof inspectRateLimit !== 'function') throw new Error('GitHub rate-limit inspection dependency must be a function.');
  let status;
  try {
    status = await inspectRateLimit();
  } catch (error) {
    if (!isGithubProviderRateLimitError(error)) throw error;
    const now = dependencies.now ?? Date.now;
    if (typeof now !== 'function') throw new Error('GitHub provider gate clock must be a function.');
    return Object.freeze({
      result: 'provider-deferred',
      mutation: false,
      reason: 'github-rate-inspection',
      submissionId: candidate.submission_id,
      estimatedCoreRequests,
      reserveCoreRequests: CORE_REQUEST_RESERVE,
      requiredCoreRequests,
      retryAt: boundedProviderRetryAt(error.retryAfterMs, now)
    });
  }
  validateRateLimitStatus(status);
  if (requiredCoreRequests > status.limit) {
    throw new Error(
      `GitHub core request requirement ${requiredCoreRequests} exceeds the provider limit ${status.limit}; reduce evidence paths or change provider configuration.`
    );
  }
  if (status.remaining < requiredCoreRequests) {
    const now = dependencies.now ?? Date.now;
    if (typeof now !== 'function') throw new Error('GitHub provider gate clock must be a function.');
    return Object.freeze({
      result: 'provider-deferred',
      mutation: false,
      reason: 'github-core-budget',
      submissionId: candidate.submission_id,
      estimatedCoreRequests,
      reserveCoreRequests: CORE_REQUEST_RESERVE,
      requiredCoreRequests,
      remainingCoreRequests: status.remaining,
      retryAt: boundedProviderRetryAt(status.retryAfterMs, now)
    });
  }

  const claims = await rpc.call('claim_skill_submission', {
    p_worker_version: workerVersion,
    p_submission_id: candidate.submission_id,
    p_lease_seconds: 300
  });
  if (!Array.isArray(claims) || claims.length > 1) {
    throw new Error('Claim RPC returned an invalid bounded result.');
  }
  if (claims.length === 0) {
    return Object.freeze({ result: 'idle', mutation: false, reason: 'candidate-raced' });
  }
  const claim = validateCandidate(claims[0], true);
  for (const key of ['submission_id', 'repository_url', 'source_commit', 'source_path', 'version_label', 'license_claim', 'attempt_number']) {
    if (claim[key] !== candidate[key]) throw new Error('Claim RPC did not bind the exact peeked candidate.');
  }
  return Object.freeze({ result: 'claimed', mutation: true, claim });
}

/** Return one exact rate-limited claim to the queue without consuming an audit attempt. */
export async function deferGithubRateLimitedClaim(rpc, claim, error, options = {}) {
  if (!rpc || typeof rpc.call !== 'function') throw new Error('A Supabase RPC client is required.');
  const validatedClaim = validateCandidate(claim, true);
  const workerVersion = validateWorkerVersion(options.workerVersion);
  if (!isGithubProviderRateLimitError(error)) throw new Error('Only a retryable GitHub rate limit can defer a claim.');
  const retryAfterSeconds = Math.min(
    MAX_DEFER_SECONDS,
    Math.max(MIN_DEFER_SECONDS, Math.ceil((error.retryAfterMs ?? (MIN_DEFER_SECONDS * 1_000)) / 1_000))
  );
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.github-provider-deferral',
    schemaVersion: 1,
    submissionId: validatedClaim.submission_id,
    claimId: validatedClaim.claim_id,
    workerVersion,
    retryAfterSeconds
  });
  const result = await rpc.call('defer_skill_submission_provider_limit', {
    p_submission_id: validatedClaim.submission_id,
    p_claim_id: validatedClaim.claim_id,
    p_worker_version: workerVersion,
    p_retry_after_seconds: retryAfterSeconds,
    p_idempotency_digest: idempotencyDigest
  });
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Provider deferral RPC returned an invalid bounded result.');
  }
  const row = result[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || row.submission_id !== validatedClaim.submission_id
    || row.submission_state !== 'queued'
    || row.attempt_count !== validatedClaim.attempt_number - 1
    || !Number.isInteger(row.provider_defer_count) || row.provider_defer_count < 1
    || !validTimestamp(row.provider_retry_after_at)) {
    throw new Error('Provider deferral RPC returned an invalid queue projection.');
  }
  return Object.freeze({
    result: 'provider-deferred',
    mutation: true,
    submissionId: validatedClaim.submission_id,
    retryAfterSeconds,
    idempotencyDigest,
    submission: row
  });
}

export function isGithubProviderRateLimitError(error) {
  return error instanceof GithubSourceFetchError
    && error.code === 'RATE_LIMITED'
    && error.retryable === true;
}

function validateCandidate(value, requireClaim = false) {
  const sourcePath = typeof value?.source_path === 'string' ? value.source_path : '';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !/^sub_[0-9a-f]{32}$/.test(value.submission_id)
    || !/^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9][a-z0-9_.-]{0,99}$/.test(value.repository_url)
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.source_commit)
    || validateRelativePath(sourcePath, /(?:^|\/)SKILL\.md$/, 'safe relative SKILL.md path') !== sourcePath
    || typeof value.version_label !== 'string' || value.version_label.length < 1 || value.version_label.length > 100
    || (value.license_claim !== null && typeof value.license_claim !== 'string')
    || !Number.isInteger(value.attempt_number) || value.attempt_number < 1 || value.attempt_number > 5
    || (requireClaim && (!/^[0-9a-f-]{36}$/.test(value.claim_id) || !validTimestamp(value.claim_expires_at)))) {
    throw new Error(`${requireClaim ? 'Claim' : 'Candidate peek'} RPC returned invalid source coordinates.`);
  }
  return value;
}

function validateRateLimitStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isSafeInteger(value.limit) || value.limit < 1
    || !Number.isSafeInteger(value.remaining) || value.remaining < 0 || value.remaining > value.limit
    || !Number.isSafeInteger(value.used) || value.used < 0 || value.used > value.limit
    || !validTimestamp(value.resetAt)
    || !Number.isFinite(value.retryAfterMs) || value.retryAfterMs < 0 || value.retryAfterMs > MAX_DEFER_SECONDS * 1_000) {
    throw new Error('GitHub rate-limit inspection returned an invalid bounded projection.');
  }
}

function validateRelativePath(value, terminalPattern, label) {
  const components = typeof value === 'string' ? value.split('/') : [];
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 || value.length > 500
    || value !== value.normalize('NFC') || value.startsWith('/') || value.endsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)
    || components.some(component => !component || component === '.' || component === '..')
    || !terminalPattern.test(value)) {
    throw new Error(`Expected a ${label}.`);
  }
  return value;
}

function validateWorkerVersion(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) {
    throw new Error('Worker version is invalid.');
  }
  return value;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedProviderRetryAt(retryAfterMs, now) {
  const currentMs = now();
  if (!Number.isSafeInteger(currentMs) || !Number.isFinite(new Date(currentMs).valueOf())) {
    throw new Error('GitHub provider gate clock returned an invalid timestamp.');
  }
  const boundedDelayMs = Math.min(
    MAX_DEFER_SECONDS * 1_000,
    Math.max(MIN_DEFER_SECONDS * 1_000, retryAfterMs ?? (MIN_DEFER_SECONDS * 1_000))
  );
  return new Date(currentMs + boundedDelayMs).toISOString();
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}
