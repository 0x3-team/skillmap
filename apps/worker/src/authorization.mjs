#!/usr/bin/env node

import process from 'node:process';
import { canonicalDigest } from './operator-receipts.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const DECISIONS = new Set(['authorized', 'revoked']);
const BASES = new Set(['publisher-consent', 'publisher-owner-approval', 'authorized-delegate-approval']);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing publisher authorization mutation without the explicit --execute flag.');
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-publisher-authorization-request',
    schemaVersion: 1,
    submissionId: options.submissionId,
    publisherHandle: options.publisherHandle,
    decision: options.decision,
    basis: options.basis,
    evidenceReference: options.evidenceReference,
    evidenceDigest: options.evidenceDigest,
    expiresAt: options.expiresAt,
    operationId: options.operationId
  });
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('record_skill_submission_publisher_authorization', {
    p_submission_id: options.submissionId,
    p_publisher_handle: options.publisherHandle,
    p_decision: options.decision,
    p_authorization_basis: options.basis,
    p_evidence_reference: options.evidenceReference,
    p_evidence_digest: options.evidenceDigest,
    p_expires_at: options.expiresAt,
    p_idempotency_digest: idempotencyDigest
  });
  process.stdout.write(`${JSON.stringify({
    result: 'publisher-authorization-recorded', mutation: true, idempotencyDigest, authorization: result
  })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap publisher authorization failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

export function parseArguments(args) {
  let execute = false;
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (!['--submission-id', '--publisher-handle', '--decision', '--basis',
      '--evidence-reference', '--evidence-digest', '--expires-at', '--operation-id'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values['--publisher-handle'] ?? '')
    || values['--publisher-handle'].length < 2 || values['--publisher-handle'].length > 40) {
    throw new Error('--publisher-handle is required and invalid.');
  }
  const decision = values['--decision'];
  if (!DECISIONS.has(decision)) throw new Error('--decision is invalid.');
  const basis = values['--basis'] ?? null;
  const expiresAt = values['--expires-at'] ?? null;
  if (decision === 'authorized') {
    if (!BASES.has(basis)) throw new Error('--basis is required and invalid for authorization.');
    const expires = Date.parse(expiresAt ?? '');
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('--expires-at must be a future ISO timestamp.');
    if (expires > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new Error('--expires-at cannot exceed 366 days.');
  } else if (basis || expiresAt) {
    throw new Error('Revocation does not accept --basis or --expires-at.');
  }
  if (!/^authref_[0-9a-f]{32}$/.test(values['--evidence-reference'] ?? '')) {
    throw new Error('--evidence-reference is required and must be an opaque authorization reference.');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(values['--evidence-digest'] ?? '')) {
    throw new Error('--evidence-digest is required and invalid.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--operation-id'] ?? '')) {
    throw new Error('--operation-id is required and must be one canonical UUID.');
  }
  return {
    help: false,
    execute,
    submissionId: values['--submission-id'],
    publisherHandle: values['--publisher-handle'],
    decision,
    basis,
    evidenceReference: values['--evidence-reference'],
    evidenceDigest: values['--evidence-digest'],
    expiresAt,
    operationId: values['--operation-id']
  };
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Publisher authorization failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap publisher authorization\n\n` +
    `Append a redacted, evidence-digest-bound publisher authorization or revocation receipt.\n` +
    `An authorized decision also renews an expired or expiring exact published source version; ` +
    `a blocked, quarantined, or revoked version cannot be renewed. Revocation is terminal for ` +
    `the exact repository, commit, and path across accounts and publisher handles.\n` +
    `Mutation requires --execute. Evidence references are opaque and must contain no personal data.\n\n` +
    `Usage: node apps/worker/src/authorization.mjs --execute --submission-id sub_... ` +
    `--publisher-handle HANDLE --decision authorized --basis publisher-consent ` +
    `--evidence-reference authref_... --evidence-digest sha256:... --expires-at ISO_TIMESTAMP --operation-id UUID\n`;
}
