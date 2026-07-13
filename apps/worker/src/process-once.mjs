#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  auditHostedSkillSnapshot,
  createHostedDeclaredCompatibilityReceiptDigest,
  gradeHostedSkill
} from '../../../dist/hosted/audit-grade.js';
import { fetchGithubSkillTree } from '../../../dist/network/github-source-fetcher.js';
import { buildOperatorReceiptPayloads, canonicalDigest } from './operator-receipts.mjs';
import { renewClaimLease } from './claim-lease.mjs';
import { assertPublicGithubRepository } from './public-github-repository.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const WORKER_VERSION = 'skillmap-worker/0.1.0';

let claimed = null;
let rpc = null;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing database mutation without the explicit --execute flag.');
  assertNodeVersion();
  rpc = createSupabaseRpcClientFromEnvironment();
  const claims = await rpc.call('claim_skill_submission', {
    p_worker_version: WORKER_VERSION,
    p_submission_id: options.submissionId ?? null,
    p_lease_seconds: 300
  });
  if (!Array.isArray(claims) || claims.length > 1) throw new Error('Claim RPC returned an invalid bounded result.');
  if (claims.length === 0) {
    process.stdout.write(`${JSON.stringify({ result: 'idle', mutation: false })}\n`);
    process.exit(0);
  }
  claimed = validateClaim(claims[0]);

  const repository = repositoryFromUrl(claimed.repository_url);
  await assertPublicGithubRepository(repository);
  await renewClaimLease(rpc, claimed, { workerVersion: WORKER_VERSION, leaseSeconds: 300 });
  const sourceDirectory = path.posix.dirname(claimed.source_path);
  const sourcePhaseSignal = AbortSignal.timeout(210_000);
  const snapshot = await fetchGithubSkillTree(
    repository,
    claimed.source_commit,
    sourceDirectory === '.' ? '.' : sourceDirectory,
    {
      timeoutMs: 10_000,
      maxResponseBytes: 1024 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
      maxEntries: 500,
      concurrency: 4,
      maxRetries: 2,
      userAgent: 'skillmap-hosted-audit-worker/1',
      signal: sourcePhaseSignal
    }
  );
  if (snapshot.resolvedCommit !== claimed.source_commit) throw new Error('GitHub did not resolve the claimed immutable commit exactly.');
  await renewClaimLease(rpc, claimed, { workerVersion: WORKER_VERSION, leaseSeconds: 300 });

  const auditReceipt = auditHostedSkillSnapshot(snapshot, {
    sourcePath: claimed.source_path,
    license: {
      state: options.licenseState,
      ...(options.spdx ? { spdxExpression: options.spdx } : {})
    }
  });
  const hostProfileVersion = 'codex-host/v1';
  const compatibilityReceiptDigest = auditReceipt.compatibility.state === 'declared'
    ? createHostedDeclaredCompatibilityReceiptDigest(auditReceipt, hostProfileVersion)
    : null;
  const gradeEvaluation = gradeHostedSkill({
    normalizedPackageDigest: auditReceipt.subject.normalizedEvaluationDigest,
    auditReceipt,
    ...(compatibilityReceiptDigest ? { compatibilityReceiptDigest } : {}),
    hostProfileVersion
  });
  const receipts = buildOperatorReceiptPayloads({
    auditReceipt,
    gradeEvaluation,
    compatibilityReceiptDigest,
    workerVersion: WORKER_VERSION
  });
  const eligible = auditReceipt.state !== 'blocked' && gradeEvaluation.state === 'provisional';
  const disposition = resolveDisposition(options.disposition, eligible);
  const reviewReasonCodes = disposition === 'accepted'
    ? []
    : [...new Set([...receipts.audit.reasonCodes, ...receipts.grade.reasonCodes, 'review-required'])].sort().slice(0, 20);
  const publicMessage = disposition === 'accepted'
    ? null
    : options.publicMessage ?? 'The submission needs remediation before it can be published.';
  const inputDigest = canonicalDigest({
    kind: 'skillmap.hosted-worker-input', schemaVersion: 1,
    submissionId: claimed.submission_id, repository: claimed.repository_url,
    commit: claimed.source_commit, path: claimed.source_path,
    version: claimed.version_label, attempt: claimed.attempt_number
  });
  const resultDigest = canonicalDigest({
    kind: 'skillmap.hosted-worker-result', schemaVersion: 1,
    auditReceiptDigest: auditReceipt.receiptDigest,
    gradeReceiptDigest: gradeEvaluation.receiptDigest,
    disposition
  });
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-worker-completion', schemaVersion: 1,
    submissionId: claimed.submission_id, claimId: claimed.claim_id,
    workerVersion: WORKER_VERSION, inputDigest, resultDigest, disposition
  });
  const completed = await rpc.call('complete_skill_submission', {
    p_submission_id: claimed.submission_id,
    p_claim_id: claimed.claim_id,
    p_worker_version: WORKER_VERSION,
    p_disposition: disposition,
    p_input_digest: inputDigest,
    p_result_digest: resultDigest,
    p_audit_receipt: receipts.audit,
    p_grade_receipt: receipts.grade,
    p_reason_codes: reviewReasonCodes,
    p_public_message: publicMessage,
    p_idempotency_digest: idempotencyDigest
  });
  process.stdout.write(`${JSON.stringify({
    result: 'completed', mutation: true, submissionId: claimed.submission_id,
    requestedDisposition: options.disposition, disposition,
    auditState: auditReceipt.state, gradeState: gradeEvaluation.state,
    gradeScore: gradeEvaluation.score, completion: completed
  })}\n`);
} catch (error) {
  const message = safeError(error);
  if (claimed && rpc) {
    try {
      const inputDigest = canonicalDigest({ kind: 'skillmap.hosted-worker-input', schemaVersion: 1, submissionId: claimed.submission_id, claimId: claimed.claim_id });
      const resultDigest = canonicalDigest({ kind: 'skillmap.hosted-worker-failure', schemaVersion: 1, code: 'WORKER_FAILED' });
      await rpc.call('complete_skill_submission', {
        p_submission_id: claimed.submission_id,
        p_claim_id: claimed.claim_id,
        p_worker_version: WORKER_VERSION,
        p_disposition: 'failed',
        p_input_digest: inputDigest,
        p_result_digest: resultDigest,
        p_audit_receipt: null,
        p_grade_receipt: null,
        p_reason_codes: ['worker-failed'],
        p_public_message: 'The bounded audit worker failed. An operator can review and requeue it.',
        p_idempotency_digest: canonicalDigest({ kind: 'skillmap.hosted-worker-failure-completion', schemaVersion: 1, submissionId: claimed.submission_id, claimId: claimed.claim_id, resultDigest })
      });
    } catch {
      // Keep the original bounded error. The lease remains recoverable after expiry.
    }
  }
  process.stderr.write(`SkillMap hosted queue worker failed: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const values = Object.create(null);
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (!['--submission-id', '--license-state', '--spdx', '--disposition', '--public-message'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  const licenseState = values['--license-state'] ?? 'noassertion';
  if (!['confirmed', 'noassertion', 'restricted'].includes(licenseState)) throw new Error('--license-state is invalid.');
  if (licenseState === 'confirmed' && !values['--spdx']) throw new Error('--spdx is required when confirming a license.');
  if (licenseState !== 'confirmed' && values['--spdx']) throw new Error('--spdx is accepted only with a confirmed license.');
  const disposition = values['--disposition'] ?? 'auto';
  if (!['auto', 'accepted', 'changes-requested', 'rejected'].includes(disposition)) throw new Error('--disposition is invalid.');
  const submissionId = values['--submission-id'];
  if (submissionId && !/^sub_[0-9a-f]{32}$/.test(submissionId)) throw new Error('--submission-id is invalid.');
  const publicMessage = values['--public-message'];
  if (publicMessage && (publicMessage.length > 500 || /[\u0000-\u001f\u007f]/.test(publicMessage))) throw new Error('--public-message is invalid.');
  return { help: false, execute, submissionId, licenseState, spdx: values['--spdx'], disposition, publicMessage };
}

function validateClaim(value) {
  const sourcePath = typeof value?.source_path === 'string' ? value.source_path : '';
  const components = sourcePath.split('/');
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !/^sub_[0-9a-f]{32}$/.test(value.submission_id)
    || !/^[0-9a-f-]{36}$/.test(value.claim_id)
    || !isCanonicalRepositoryUrl(value.repository_url)
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.source_commit)
    || sourcePath !== sourcePath.trim() || sourcePath.length < 8 || sourcePath.length > 500
    || sourcePath !== sourcePath.normalize('NFC') || sourcePath.startsWith('/') || sourcePath.endsWith('/')
    || sourcePath.includes('\\') || /[\u0000-\u001f\u007f]/.test(sourcePath)
    || components.some(component => !component || component === '.' || component === '..')
    || !/(?:^|\/)SKILL\.md$/.test(sourcePath) || typeof value.version_label !== 'string'
    || !Number.isInteger(value.attempt_number)) throw new Error('Claim RPC returned invalid source coordinates.');
  return value;
}

function isCanonicalRepositoryUrl(value) {
  if (typeof value !== 'string'
    || !/^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9][a-z0-9_.-]{0,99}$/.test(value)
    || value.endsWith('.git')) return false;
  const owner = value.split('/')[3] ?? '';
  return !owner.includes('--');
}

function repositoryFromUrl(value) {
  return new URL(value).pathname.slice(1);
}

function resolveDisposition(requested, eligible) {
  if (requested === 'rejected') return 'rejected';
  if (requested === 'changes-requested') return 'changes-requested';
  return eligible ? 'accepted' : 'changes-requested';
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(major) || major < 22) throw new Error('The hosted queue worker requires Node 22 or newer.');
}

function safeError(error) {
  if (!(error instanceof Error)) return 'The worker failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted queue worker\n\n` +
    `Claim and process one exact public GitHub submission through service-role-only RPCs.\n\n` +
    `Required environment: SKILLMAP_SUPABASE_URL and SKILLMAP_SUPABASE_SERVICE_ROLE_KEY\n` +
    `Mutation requires: --execute\n\n` +
    `Usage:\n` +
    `  node apps/worker/src/process-once.mjs --execute [--submission-id sub_...] [--license-state noassertion|restricted]\n` +
    `  node apps/worker/src/process-once.mjs --execute --license-state confirmed --spdx MIT [--disposition auto|accepted|changes-requested|rejected]\n` +
    `Static evidence may produce a provisional numeric score but never a current letter grade.\n`;
}
