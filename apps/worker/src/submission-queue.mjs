#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const STATES = new Set([
  'queued', 'processing', 'changes-requested', 'rejected',
  'failed', 'accepted', 'published', 'withdrawn'
]);
const MAX_QUEUE_ROWS = 32;
const SUMMARY_KEYS = [
  'accepted_count', 'changes_requested_count', 'dead_letter_ready_count',
  'expired_processing_count', 'failed_count', 'observed_at', 'oldest_accepted_at',
  'oldest_processing_claim_expires_at', 'oldest_queued_at', 'oldest_remediation_at',
  'processing_count', 'queued_count', 'retryable_count'
];
const QUEUE_KEYS = [
  'attempt_count', 'audit_state', 'claim_expired', 'claim_expires_at', 'claimed_at',
  'completed_at', 'created_at', 'current_worker_version', 'dead_letter_ready',
  'grade_state', 'observed_at', 'publication_review_ready', 'public_status_message',
  'remediation_code', 'repository_url', 'result_skill_id', 'result_version_id',
  'retry_eligible', 'review_state', 'source_commit', 'source_path', 'submission_id',
  'submission_state', 'submitter_license_claim', 'updated_at', 'version_label'
];

export function parseSubmissionQueueArguments(args) {
  const options = {
    help: false,
    execute: false,
    state: null,
    limit: 20,
    afterUpdatedAt: null,
    afterSubmissionId: null
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (argument === '--execute') {
      if (options.execute) throw new Error('--execute may be supplied only once.');
      options.execute = true;
      continue;
    }
    if (!['--state', '--limit', '--after-updated-at', '--after-submission-id'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    seen.add(argument);
    index += 1;
    if (argument === '--state') options.state = value;
    if (argument === '--limit') options.limit = Number(value);
    if (argument === '--after-updated-at') options.afterUpdatedAt = value;
    if (argument === '--after-submission-id') options.afterSubmissionId = value;
  }
  if (options.state !== null && !STATES.has(options.state)) {
    throw new Error('--state must be an exact supported submission state.');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_QUEUE_ROWS) {
    throw new Error(`--limit must be an integer from 1 through ${MAX_QUEUE_ROWS}.`);
  }
  if ((options.afterUpdatedAt === null) !== (options.afterSubmissionId === null)) {
    throw new Error('Both cursor options must be supplied together.');
  }
  if (options.afterUpdatedAt !== null && !isTimestamp(options.afterUpdatedAt)) {
    throw new Error('--after-updated-at must be an ISO timestamp.');
  }
  if (options.afterSubmissionId !== null && !isPublicId(options.afterSubmissionId, 'sub')) {
    throw new Error('--after-submission-id must be a valid submission ID.');
  }
  return options;
}

export function validateSubmissionQueueSummary(value) {
  if (!isRecord(value) || !hasExactKeys(value, SUMMARY_KEYS) || !isTimestamp(value.observed_at)) {
    throw new Error('Submission queue summary returned an invalid projection.');
  }
  for (const key of SUMMARY_KEYS.filter(key => key.endsWith('_count'))) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new Error('Submission queue summary returned an invalid projection.');
    }
  }
  for (const key of SUMMARY_KEYS.filter(key => key.startsWith('oldest_'))) {
    if (value[key] !== null && !isTimestamp(value[key])) {
      throw new Error('Submission queue summary returned an invalid projection.');
    }
  }
  return value;
}

export function validateSubmissionQueueRow(row) {
  const states = ['queued', 'processing', 'changes-requested', 'rejected', 'failed', 'accepted', 'published', 'withdrawn'];
  if (!isRecord(row) || !hasExactKeys(row, QUEUE_KEYS)
    || !isTimestamp(row.observed_at)
    || !isPublicId(row.submission_id, 'sub')
    || !states.includes(row.submission_state)
    || !isRepositoryUrl(row.repository_url)
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.source_commit)
    || !isSourcePath(row.source_path)
    || !isBoundedText(row.version_label, 1, 100)
    || (row.submitter_license_claim !== null && !isBoundedText(row.submitter_license_claim, 2, 200))
    || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 || row.attempt_count > 20
    || (row.current_worker_version !== null && !isBoundedText(row.current_worker_version, 1, 128))
    || !['not-run', 'passed', 'warnings', 'blocked'].includes(row.audit_state)
    || !['ungraded', 'provisional', 'blocked'].includes(row.grade_state)
    || !['not-started', 'approved', 'changes-requested', 'rejected', 'published', 'withdrawn'].includes(row.review_state)
    || (row.remediation_code !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(row.remediation_code))
    || (row.public_status_message !== null && !isBoundedText(row.public_status_message, 1, 500))
    || (row.result_skill_id !== null && !isPublicId(row.result_skill_id, 'skl'))
    || (row.result_version_id !== null && !isPublicId(row.result_version_id, 'skv'))
    || !isTimestamp(row.created_at) || !isTimestamp(row.updated_at)
    || !isNullableTimestamp(row.claimed_at) || !isNullableTimestamp(row.claim_expires_at)
    || !isNullableTimestamp(row.completed_at)
    || !['claim_expired', 'retry_eligible', 'dead_letter_ready', 'publication_review_ready']
      .every(key => typeof row[key] === 'boolean')) {
    throw new Error('Submission queue returned an invalid submission projection.');
  }
  if (row.dead_letter_ready && !row.claim_expired) {
    throw new Error('Submission queue returned an inconsistent dead-letter projection.');
  }
  return row;
}

export async function runSubmissionQueue(options, dependencies = {}) {
  if (!options.execute) {
    throw new Error('Refusing service-role submission queue access without the explicit --execute flag.');
  }
  const rpc = dependencies.rpc ?? createSupabaseRpcClientFromEnvironment();
  const summaryRows = await rpc.call('get_skill_submission_queue_summary', {});
  if (!Array.isArray(summaryRows) || summaryRows.length !== 1) {
    throw new Error('Submission queue summary returned an invalid bounded result.');
  }
  const summary = validateSubmissionQueueSummary(summaryRows[0]);
  const rows = await rpc.call('list_skill_submission_operator_queue', {
    p_state: options.state,
    p_limit: options.limit,
    p_after_updated_at: options.afterUpdatedAt,
    p_after_submission_id: options.afterSubmissionId
  });
  if (!Array.isArray(rows) || rows.length > options.limit) {
    throw new Error('Submission queue returned an invalid bounded result.');
  }
  for (const row of rows) validateSubmissionQueueRow(row);
  const last = rows.at(-1);
  return {
    schemaVersion: 'skillmap-operator-submission-queue/v1',
    result: 'completed',
    mutation: false,
    summary,
    count: rows.length,
    submissions: rows,
    cursorSemantics: 'best-effort-live-by-updated-at-restart-required',
    reconciliationRequired: true,
    nextCursor: last ? { updatedAt: last.updated_at, submissionId: last.submission_id } : null
  };
}

function help() {
  return `SkillMap submission queue operator\n\n` +
    `Read a service-role-only summary and at most 32 redacted submissions without mutation.\n` +
    `Credential use requires: --execute (the command remains read-only).\n\n` +
    `Usage: node apps/worker/src/submission-queue.mjs --execute [options]\n\n` +
    `Options:\n` +
    `  --state STATE                 Filter one exact submission state.\n` +
    `  --limit 20                   Return 1 through 32 rows.\n` +
    `  --after-updated-at ISO       Live cursor timestamp; requires --after-submission-id.\n` +
    `  --after-submission-id sub_…  Cursor public ID; requires --after-updated-at.\n`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isPublicId(value, prefix) {
  return typeof value === 'string' && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value);
}

function isRepositoryUrl(value) {
  return typeof value === 'string'
    && /^https:\/\/github[.]com\/[a-z0-9][a-z0-9.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/.test(value)
    && value.length <= 226;
}

function isSourcePath(value) {
  return isBoundedText(value, 8, 500) && !value.startsWith('/') && !value.includes('\\')
    && !value.includes('//') && !/(^|\/)\.{1,2}(\/|$)/.test(value) && /(^|\/)SKILL[.]md$/.test(value);
}

function isBoundedText(value, minimum, maximum) {
  return typeof value === 'string'
    && Array.from(value).length >= minimum && Array.from(value).length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

async function main(args) {
  try {
    const options = parseSubmissionQueueArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runSubmissionQueue(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap submission queue command failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
