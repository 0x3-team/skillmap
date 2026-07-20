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

const DISPOSITIONS = new Set(['approved-distinct', 'approved-update', 'blocked-duplicate']);
const COLLISION_REVIEW_ID = /^col_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function buildCollisionReviewAction(options) {
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-collision-review-request',
    schemaVersion: 1,
    submissionId: options.submissionId,
    disposition: options.disposition,
    reasonCode: options.reasonCode,
    targetPublisherId: options.targetPublisherId,
    targetSkillId: options.targetSkillId,
    targetVersionId: options.targetVersionId,
    operationId: options.operationId
  });
  return Object.freeze({
    mode: options.mode,
    approvalId: options.approvalId,
    actionKind: 'submission.collision-review',
    subjectType: 'submission',
    subjectId: options.submissionId,
    actionPayload: Object.freeze({
      schemaVersion: 1,
      submissionId: options.submissionId,
      disposition: options.disposition,
      reasonCode: options.reasonCode,
      targetPublisherId: options.targetPublisherId,
      targetSkillId: options.targetSkillId,
      targetVersionId: options.targetVersionId
    }),
    actionDigest: idempotencyDigest,
    operationId: options.operationId,
    businessRpc: 'review_skill_submission_collisions',
    businessParameters: Object.freeze({
      p_submission_id: options.submissionId,
      p_disposition: options.disposition,
      p_reason_code: options.reasonCode,
      p_target_publisher_id: options.targetPublisherId,
      p_target_skill_id: options.targetSkillId,
      p_target_version_id: options.targetVersionId,
      p_idempotency_digest: idempotencyDigest
    })
  });
}

export async function runCollisionReview(options, dependencies = {}) {
  const action = buildCollisionReviewAction(options);
  const outcome = await runDualControlledOperatorAction(action, dependencies);
  if (outcome.mode === 'approve') {
    return {
      result: 'operator-action-approved', mutation: true,
      actionKind: action.actionKind, actionDigest: action.actionDigest,
      approval: outcome.approval
    };
  }
  const review = validateCollisionReviewResult(outcome.result, options);
  return {
    result: 'collision-reviewed', mutation: true,
    idempotencyDigest: action.actionDigest, review
  };
}

export function validateCollisionReviewResult(result, options) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Collision review RPC returned an invalid collision projection.');
  }
  const row = result[0];
  const expectedDisposition = options?.disposition;
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'collision_review_id,disposition,review_subject_digest'
    || !COLLISION_REVIEW_ID.test(row.collision_review_id ?? '')
    || !DIGEST.test(row.review_subject_digest ?? '')
    || !DISPOSITIONS.has(expectedDisposition) || row.disposition !== expectedDisposition) {
    throw new Error('Collision review RPC returned an invalid collision projection.');
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
    if (!['--submission-id', '--disposition', '--reason-code', '--target-publisher-id',
      '--target-skill-id', '--target-version-id', '--operation-id', '--approval-id'].includes(argument)) {
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
  if (!DISPOSITIONS.has(values['--disposition'])) throw new Error('--disposition is invalid.');
  const targetPublisherId = values['--target-publisher-id'] ?? null;
  const targetSkillId = values['--target-skill-id'] ?? null;
  const targetVersionId = values['--target-version-id'] ?? null;
  if (values['--disposition'] === 'approved-update') {
    if (!/^pub_[0-9a-f]{32}$/.test(targetPublisherId ?? '')
      || !/^skl_[0-9a-f]{32}$/.test(targetSkillId ?? '')
      || !/^skv_[0-9a-f]{32}$/.test(targetVersionId ?? '')) {
      throw new Error('approved-update requires exact target publisher, skill, and version IDs.');
    }
  } else if (targetPublisherId || targetSkillId || targetVersionId) {
    throw new Error('Only approved-update accepts a target identity.');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values['--reason-code'] ?? '') || values['--reason-code'].length > 64) {
    throw new Error('--reason-code is required and invalid.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--operation-id'] ?? '')) {
    throw new Error('--operation-id is required and must be one canonical UUID.');
  }
  return {
    help: false,
    ...operator,
    submissionId: values['--submission-id'],
    disposition: values['--disposition'],
    reasonCode: values['--reason-code'],
    targetPublisherId,
    targetSkillId,
    targetVersionId,
    operationId: values['--operation-id']
  };
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Collision review failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted collision review\n\n` +
    `Record an immutable disposition over the current bounded collision evidence.\n` +
    `Approval and execution require distinct SKILLMAP_OPERATOR_CREDENTIAL values. ` +
    `Use exactly one mode; --approve records only the envelope, and --execute requires --approval-id. ` +
    `Reuse an operation UUID only for an exact retry.\n\n` +
    `Approve: node apps/worker/src/collision-review.mjs --approve --submission-id sub_... ` +
    `--disposition approved-distinct|approved-update|blocked-duplicate --reason-code CODE ` +
    `[--target-publisher-id pub_... --target-skill-id skl_... --target-version-id skv_...] ` +
    `--operation-id UUID\n` +
    `Execute: repeat the exact action with --execute --approval-id opa_...\n`;
}

async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runCollisionReview(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap hosted collision review failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
