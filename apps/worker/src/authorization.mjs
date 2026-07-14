#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalDigest } from './operator-receipts.mjs';
import {
  acceptOperatorMode,
  finalizeOperatorMode,
  runDualControlledOperatorAction
} from './operator-dual-control.mjs';

const DECISIONS = new Set(['authorized', 'revoked']);
const BASES = new Set(['publisher-consent', 'publisher-owner-approval', 'authorized-delegate-approval']);
const AUTHORIZATION_RECEIPT_ID = /^aut_[0-9a-f]{32}$/;

export function buildPublisherAuthorizationAction(options) {
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
  return Object.freeze({
    mode: options.mode,
    approvalId: options.approvalId,
    actionKind: 'submission.publisher-authorization',
    subjectType: 'submission',
    subjectId: options.submissionId,
    actionPayload: Object.freeze({
      schemaVersion: 1,
      submissionId: options.submissionId,
      publisherHandle: options.publisherHandle,
      decision: options.decision,
      authorizationBasis: options.basis,
      evidenceReference: options.evidenceReference,
      evidenceDigest: options.evidenceDigest,
      expiresAt: options.expiresAt
    }),
    actionDigest: idempotencyDigest,
    operationId: options.operationId,
    businessRpc: 'record_skill_submission_publisher_authorization',
    businessParameters: Object.freeze({
      p_submission_id: options.submissionId,
      p_publisher_handle: options.publisherHandle,
      p_decision: options.decision,
      p_authorization_basis: options.basis,
      p_evidence_reference: options.evidenceReference,
      p_evidence_digest: options.evidenceDigest,
      p_expires_at: options.expiresAt,
      p_idempotency_digest: idempotencyDigest
    })
  });
}

export async function runPublisherAuthorization(options, dependencies = {}) {
  const action = buildPublisherAuthorizationAction(options);
  const outcome = await runDualControlledOperatorAction(action, dependencies);
  if (outcome.mode === 'approve') {
    return {
      result: 'operator-action-approved', mutation: true,
      actionKind: action.actionKind, actionDigest: action.actionDigest,
      approval: outcome.approval
    };
  }
  const authorization = validatePublisherAuthorizationResult(outcome.result, options);
  return {
    result: 'publisher-authorization-recorded', mutation: true,
    idempotencyDigest: action.actionDigest, authorization
  };
}

export function validatePublisherAuthorizationResult(result, options) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Publisher authorization RPC returned an invalid authorization projection.');
  }
  const row = result[0];
  const expectedDecision = options?.decision;
  const expectedExpiresAt = options?.expiresAt;
  const authorizedExpiryMatches = expectedDecision === 'authorized'
    && typeof expectedExpiresAt === 'string' && Number.isFinite(Date.parse(expectedExpiresAt))
    && typeof row?.authorization_expires_at === 'string'
    && Number.isFinite(Date.parse(row.authorization_expires_at))
    && Date.parse(row.authorization_expires_at) === Date.parse(expectedExpiresAt);
  const revokedExpiryMatches = expectedDecision === 'revoked'
    && expectedExpiresAt === null && row?.authorization_expires_at === null;
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'authorization_decision,authorization_expires_at,authorization_receipt_id'
    || !AUTHORIZATION_RECEIPT_ID.test(row.authorization_receipt_id ?? '')
    || !DECISIONS.has(expectedDecision) || row.authorization_decision !== expectedDecision
    || (!authorizedExpiryMatches && !revokedExpiryMatches)) {
    throw new Error('Publisher authorization RPC returned an invalid authorization projection.');
  }
  return result;
}

export function parseArguments(args) {
  let mode = null;
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const nextMode = acceptOperatorMode(argument, mode);
    if (nextMode !== null) {
      mode = nextMode;
      continue;
    }
    if (!['--submission-id', '--publisher-handle', '--decision', '--basis',
      '--evidence-reference', '--evidence-digest', '--expires-at', '--operation-id', '--approval-id'].includes(argument)) {
      throw new Error('Unknown option.');
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  const operator = finalizeOperatorMode(mode, values['--approval-id']);
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values['--publisher-handle'] ?? '')
    || values['--publisher-handle'].length < 2 || values['--publisher-handle'].length > 40) {
    throw new Error('--publisher-handle is required and invalid.');
  }
  const decision = values['--decision'];
  if (!DECISIONS.has(decision)) throw new Error('--decision is invalid.');
  const basis = values['--basis'] ?? null;
  let expiresAt = values['--expires-at'] ?? null;
  if (decision === 'authorized') {
    if (!BASES.has(basis)) throw new Error('--basis is required and invalid for authorization.');
    const expires = Date.parse(expiresAt ?? '');
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('--expires-at must be a future ISO timestamp.');
    if (expires > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new Error('--expires-at cannot exceed 366 days.');
    expiresAt = new Date(expires).toISOString();
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
    ...operator,
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
    `Approval and execution require distinct operator credentials from SKILLMAP_OPERATOR_CREDENTIAL. ` +
    `Use exactly one mode; --approve only records the exact envelope, while --execute requires its --approval-id. ` +
    `Evidence references are opaque and must contain no personal data.\n\n` +
    `Approve: node apps/worker/src/authorization.mjs --approve --submission-id sub_... ` +
    `--publisher-handle HANDLE --decision authorized --basis publisher-consent ` +
    `--evidence-reference authref_... --evidence-digest sha256:... --expires-at ISO_TIMESTAMP --operation-id UUID\n` +
    `Execute: repeat the exact action with --execute --approval-id opa_...\n`;
}

async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runPublisherAuthorization(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap publisher authorization failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
