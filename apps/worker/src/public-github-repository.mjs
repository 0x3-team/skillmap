import { TextDecoder } from 'node:util';
import {
  nodeHttpsGithubTransport,
  validateGithubRepository
} from '../../../dist/network/github-source-fetcher.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_USER_AGENT = 'skillmap-hosted-audit-worker/1';
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Proves that GitHub exposes the submitted repository as public without using
 * credentials. Redirects are deliberately rejected so renamed or transferred
 * repositories cannot silently change the source identity being audited.
 */
export async function assertPublicGithubRepository(repository, options = {}) {
  const normalizedRepository = validateGithubRepository(repository);
  const [owner, name] = normalizedRepository.split('/');
  const timeoutMs = boundedInteger('timeoutMs', options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000);
  const maxResponseBytes = boundedInteger(
    'maxResponseBytes',
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    1024 * 1024
  );
  const transport = options.transport ?? nodeHttpsGithubTransport;
  if (typeof transport !== 'function') throw new Error('GitHub visibility transport must be a function.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  let response;
  try {
    response = await transport({
      method: 'GET',
      url,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': DEFAULT_USER_AGENT,
        'x-github-api-version': '2022-11-28'
      },
      signal: controller.signal,
      maxResponseBytes
    });
  } catch {
    if (controller.signal.aborted) throw new Error('GitHub repository visibility preflight timed out.');
    throw new Error('GitHub repository visibility preflight failed.');
  } finally {
    clearTimeout(timer);
  }

  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('GitHub repository visibility preflight returned an invalid status.');
  }
  if (status >= 300 && status < 400) {
    throw new Error('GitHub repository visibility preflight rejected a redirect. Submit the canonical public OWNER/REPO.');
  }
  if (status !== 200) {
    throw new Error(`GitHub repository visibility preflight requires an unauthenticated 200 response; received ${status}.`);
  }

  const body = response?.body;
  if (!(body instanceof Uint8Array) || body.byteLength > maxResponseBytes) {
    throw new Error('GitHub repository visibility preflight returned an invalid or oversized response.');
  }
  let metadata;
  try {
    metadata = JSON.parse(JSON_DECODER.decode(body));
  } catch {
    throw new Error('GitHub repository visibility preflight returned invalid JSON.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('GitHub repository visibility preflight returned invalid repository metadata.');
  }
  if (metadata.private !== false || metadata.visibility !== 'public') {
    throw new Error('GitHub repository visibility preflight accepts public repositories only.');
  }
  if (typeof metadata.full_name !== 'string'
    || metadata.full_name.toLowerCase() !== normalizedRepository.toLowerCase()) {
    throw new Error('GitHub repository visibility preflight returned a different repository identity.');
  }

  return normalizedRepository;
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}
