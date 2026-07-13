#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  auditHostedSkillSnapshot,
  createHostedDeclaredCompatibilityReceiptDigest,
  gradeHostedSkill
} from '../dist/hosted/audit-grade.js';
import {
  fetchGithubSkillTree,
  nodeHttpsGithubTransport
} from '../dist/network/github-source-fetcher.js';
import { assertPublicGithubRepository } from '../apps/worker/src/public-github-repository.mjs';
import { prepareInitialCorpus } from './initial-corpus-prepare.mjs';

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_FAILURE_MESSAGE_BYTES = 500;
const HOST_PROFILE_VERSION = 'codex-host/v1';
const GITHUB_REPOSITORY_PREFIX = 'https://github.com/';

/**
 * Fetches and statically evaluates every prepared corpus coordinate. The
 * injected transport is the only network authority this function receives.
 * It is shared and memoized across entries to avoid repeating immutable GitHub
 * visibility, commit, and tree reads.
 */
export async function auditInitialCorpus(manifest, options = {}) {
  const prepared = prepareInitialCorpus(manifest);
  const baseTransport = options.transport ?? nodeHttpsGithubTransport;
  if (typeof baseTransport !== 'function') throw new Error('GitHub transport must be a function.');
  const transport = createMemoizingGithubTransport(baseTransport);
  const results = [];

  for (const submission of prepared.submissions) {
    const source = {
      repositoryUrl: submission.submissionDraft.repositoryUrl,
      repository: repositoryFromUrl(submission.submissionDraft.repositoryUrl),
      commit: submission.submissionDraft.commit,
      path: submission.submissionDraft.path,
      versionLabel: submission.submissionDraft.versionLabel
    };
    let stage = 'public-repository-preflight';
    try {
      await assertPublicGithubRepository(source.repository, { transport });
      stage = 'exact-source-fetch';
      const sourceDirectory = path.posix.dirname(source.path);
      const snapshot = await fetchGithubSkillTree(
        source.repository,
        source.commit,
        sourceDirectory === '.' ? '.' : sourceDirectory,
        {
          timeoutMs: 10_000,
          maxResponseBytes: 1024 * 1024,
          maxTotalBytes: 8 * 1024 * 1024,
          maxEntries: 500,
          concurrency: 4,
          maxRetries: 2,
          userAgent: 'skillmap-hosted-audit-worker/1',
          transport
        }
      );
      if (snapshot.resolvedCommit !== source.commit) {
        throw new Error('GitHub did not resolve the submitted immutable commit exactly.');
      }

      stage = 'static-audit-and-grade';
      const auditReceipt = auditHostedSkillSnapshot(snapshot, {
        sourcePath: source.path,
        license: {
          state: 'confirmed',
          spdxExpression: submission.licenseEvidence.spdxExpression
        }
      });
      const compatibilityReceiptDigest = auditReceipt.compatibility.state === 'declared'
        ? createHostedDeclaredCompatibilityReceiptDigest(auditReceipt, HOST_PROFILE_VERSION)
        : undefined;
      const gradeEvaluation = gradeHostedSkill({
        normalizedPackageDigest: auditReceipt.subject.normalizedEvaluationDigest,
        auditReceipt,
        ...(compatibilityReceiptDigest ? { compatibilityReceiptDigest } : {}),
        hostProfileVersion: HOST_PROFILE_VERSION
      });

      results.push({
        corpusEntryId: submission.corpusEntryId,
        group: submission.group,
        state: 'audited',
        source: {
          ...source,
          manifestDigest: snapshot.manifestDigest
        },
        authorization: pendingAuthorization(submission),
        auditReceipt,
        gradeEvaluation
      });
    } catch (error) {
      results.push({
        corpusEntryId: submission.corpusEntryId,
        group: submission.group,
        state: 'failed',
        source,
        authorization: pendingAuthorization(submission),
        failure: boundedFailure(error, stage)
      });
    }
  }

  const counts = summarize(results, prepared.counts.groups);
  const core = {
    kind: 'skillmap.initial-corpus-audit-receipt',
    schemaVersion: 1,
    sourceManifestDigest: prepared.sourceManifestDigest,
    hostProfileVersion: HOST_PROFILE_VERSION,
    state: counts.failed === 0 ? 'audited-not-authorized' : 'audit-incomplete',
    counts,
    authorityBoundary: {
      receiptVisibility: 'owner-only-local-file',
      githubAccess: 'unauthenticated-public-read-only',
      sourceFilesExecuted: false,
      productionContacted: false,
      databaseContacted: false,
      databaseMutated: false,
      submissionAuthorityGranted: false,
      publisherConsentClaimed: false,
      publicationClaimed: false
    },
    results,
    limitations: [
      'Public repository visibility does not establish publisher consent or submission authority.',
      'Source files were fetched as inert bytes for bounded static inspection and were never executed.',
      'No database or production service was contacted, no submission was created, and nothing was published.',
      'Static grade evaluations preserve their actual provisional or blocked state and never claim a current letter grade.'
    ]
  };
  return {
    ...core,
    receiptDigest: `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`
  };
}

/**
 * Coalesces concurrent identical requests and reuses successful responses.
 * Non-success responses and failures are evicted so the source fetcher's own
 * bounded retry behavior can make a fresh network attempt.
 */
export function createMemoizingGithubTransport(baseTransport) {
  if (typeof baseTransport !== 'function') throw new Error('GitHub transport must be a function.');
  const cache = new Map();
  return async request => {
    if (request.signal?.aborted) throw new Error('GitHub request was aborted.');
    const key = transportCacheKey(request);
    let pending = cache.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => baseTransport(request))
        .then(response => {
          const cloned = cloneResponse(response);
          if (cloned.status < 200 || cloned.status >= 300) cache.delete(key);
          return cloned;
        })
        .catch(error => {
          cache.delete(key);
          throw error;
        });
      cache.set(key, pending);
    }
    return cloneResponse(await pending);
  };
}

export async function writeInitialCorpusAuditReceipt(outputPath, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
    throw new Error(`Audit receipt exceeds its ${MAX_OUTPUT_BYTES}-byte output boundary.`);
  }
  const handle = await open(outputPath, 'wx', 0o600);
  try {
    await handle.writeFile(serialized, { encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}

export async function runInitialCorpusAuditCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const options = parseArguments(argv);
  if (options.help) {
    stdout.write(helpText());
    return 0;
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required.');
  const input = await readFile(options.input);
  if (input.byteLength > MAX_INPUT_BYTES) throw new Error(`Input manifest exceeds ${MAX_INPUT_BYTES} bytes.`);
  let manifest;
  try {
    manifest = JSON.parse(input.toString('utf8'));
  } catch {
    throw new Error('Input manifest is not valid JSON.');
  }
  const receipt = await auditInitialCorpus(manifest, { transport: dependencies.transport });
  await writeInitialCorpusAuditReceipt(options.output, receipt);
  stdout.write(
    `Audited ${receipt.counts.audited}/${receipt.counts.entries} exact corpus entries; ` +
    `${receipt.counts.failed} failed. Receipt: ${options.output}.\n`
  );
  stdout.write('No source content was executed; no database, production, submission, consent, or publication authority was used.\n');
  return receipt.counts.failed === 0 ? 0 : 1;
}

function pendingAuthorization(submission) {
  return {
    publisherGithubHandle: submission.publisherIdentity.githubHandle,
    publisherConsent: submission.authorizationEvidence.publisherConsent.state,
    licenseBasisReviewReference: submission.authorizationEvidence.licenseBasis.reviewReference,
    submissionAuthorityGranted: false,
    publicationClaimed: false
  };
}

function summarize(results, groups) {
  const auditStates = { passed: 0, warnings: 0, blocked: 0 };
  const gradeStates = { provisional: 0, current: 0, blocked: 0 };
  let audited = 0;
  let failed = 0;
  for (const result of results) {
    if (result.state === 'failed') {
      failed += 1;
      continue;
    }
    audited += 1;
    auditStates[result.auditReceipt.state] += 1;
    gradeStates[result.gradeEvaluation.state] += 1;
  }
  return { entries: results.length, groups, audited, failed, auditStates, gradeStates };
}

function boundedFailure(error, stage) {
  const rawCode = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : 'CORPUS_AUDIT_FAILED';
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'CORPUS_AUDIT_FAILED';
  const rawMessage = error instanceof Error ? error.message : 'The corpus audit failed with an unknown error.';
  const redacted = rawMessage
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted-github-token]')
    .replace(/\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replace(/[\r\n\t]+/g, ' ');
  return {
    stage,
    code,
    message: Buffer.from(redacted).subarray(0, MAX_FAILURE_MESSAGE_BYTES).toString('utf8')
  };
}

function repositoryFromUrl(repositoryUrl) {
  if (typeof repositoryUrl !== 'string' || !repositoryUrl.startsWith(GITHUB_REPOSITORY_PREFIX)) {
    throw new Error('Prepared corpus repository URL must be a canonical public GitHub URL.');
  }
  const repository = repositoryUrl.slice(GITHUB_REPOSITORY_PREFIX.length);
  if (repository.includes('/') && repository.split('/').length === 2) return repository;
  throw new Error('Prepared corpus repository URL must identify one OWNER/REPO.');
}

function transportCacheKey(request) {
  const headers = Object.entries(request.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value])
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([request.method, request.url, request.maxResponseBytes, headers]);
}

function cloneResponse(response) {
  if (!response || typeof response !== 'object' || !(response.body instanceof Uint8Array)) {
    throw new Error('GitHub transport returned an invalid response envelope.');
  }
  return {
    status: response.status,
    headers: { ...(response.headers ?? {}) },
    body: new Uint8Array(response.body)
  };
}

function parseArguments(argv) {
  const result = { help: false, input: null, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') {
      if (seen.has('help')) throw new Error('--help may be provided only once.');
      seen.add('help');
      result.help = true;
      continue;
    }
    if (option !== '--input' && option !== '--output') throw new Error(`Unknown option: ${option}`);
    if (seen.has(option)) throw new Error(`${option} may be provided only once.`);
    seen.add(option);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
    if (value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${option} must be a bounded local path.`);
    result[option.slice(2)] = value;
    index += 1;
  }
  return result;
}

function helpText() {
  return `SkillMap initial corpus static auditor

Usage:
  node scripts/initial-corpus-audit.mjs --input MANIFEST.json --output RECEIPT.json

Validates the manifest through prepareInitialCorpus, then fetches every exact
public GitHub skill tree through one memoized, unauthenticated read-only
transport. Source files remain inert bytes and are never executed. The same
bounded static audit and provisional-or-blocked grade path used by the hosted
audit worker is applied to each entry.

The exclusive output is an owner-only (0600) local receipt. Any entry failure
still writes the bounded receipt but exits nonzero. This command never contacts
a database or production service, submits or publishes a skill, or claims
publisher consent. Existing output files are never overwritten.
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runInitialCorpusAuditCli(process.argv.slice(2)).then(exitCode => {
    process.exitCode = exitCode;
  }).catch(error => {
    process.stderr.write(`Initial corpus audit failed: ${boundedFailure(error, 'operator-command').message}\n`);
    process.exitCode = 1;
  });
}
