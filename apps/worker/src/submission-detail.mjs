#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const DETAIL_KEYS = [
  'attempt_count', 'audit_receipt', 'audit_state', 'authority_confirmed', 'claim_expired',
  'claim_expires_at', 'claimed_at', 'collision_reviews', 'collision_reviews_truncated',
  'completed_at', 'created_at', 'current_worker_version', 'dead_letter_ready', 'grade_receipt',
  'grade_state', 'last_transition_digest', 'license_evidence_receipt', 'observed_at',
  'publication_digest', 'publication_review_ready', 'public_status_message',
  'publisher_authorizations', 'publisher_authorizations_truncated', 'remediation_code',
  'repository_url', 'result_skill_id', 'result_version_id', 'retry_eligible', 'review_case',
  'review_state', 'source_commit', 'source_path', 'submission_id', 'submission_policy_version',
  'submission_state', 'submitter_license_claim', 'transition_events',
  'transition_events_truncated', 'untrusted_processing_accepted', 'updated_at', 'version_label',
  'worker_runs'
];
const AUDIT_KEYS = [
  'createdAt', 'findingCounts', 'hostProfileVersion', 'licenseState', 'networkIndicators',
  'normalizedContentDigest', 'permissionScripts', 'policyVersion', 'publicChecks', 'reasonCodes',
  'receiptDigest', 'receiptId', 'sourceContentDigest', 'spdxExpression', 'state', 'toolIndicators',
  'workerVersion'
];
const GRADE_KEYS = [
  'auditReceiptDigest', 'band', 'compatibilityEvidenceDigest', 'confidence', 'createdAt',
  'dimensions', 'evaluationSuiteDigest', 'evaluatorVersion', 'hardGates', 'hostProfileVersion',
  'normalizedContentDigest', 'reasonCodes', 'receiptDigest', 'receiptId', 'rubricVersion',
  'state', 'totalScore'
];
const REVIEW_KEYS = [
  'collisionEvidenceDigest', 'createdAt', 'idempotencyDigest', 'publicMessage',
  'reasonCodes', 'reviewId', 'state'
];
const WORKER_KEYS = [
  'attemptNumber', 'completedAt', 'disposition', 'errorCode', 'inputDigest', 'outcome',
  'publicErrorMessage', 'resultDigest', 'runId', 'startedAt', 'workerVersion'
];
const EVENT_KEYS = ['actorType', 'createdAt', 'eventId', 'fromState', 'toState', 'transitionDigest'];
const LICENSE_KEYS = [
  'auditReceiptDigest', 'createdAt', 'evidence', 'receiptId', 'reviewEvidenceDigest',
  'reviewReference', 'spdxExpression', 'workerVersion'
];
const COLLISION_KEYS = [
  'authorityVersion', 'createdAt', 'disposition', 'idempotencyDigest', 'reasonCode',
  'reviewId', 'reviewSubjectDigest', 'targetPublisherId', 'targetSkillId', 'targetVersionId'
];
const AUTHORIZATION_KEYS = [
  'authorizationBasis', 'authorizationId', 'createdAt', 'decision', 'evidenceDigest',
  'evidenceReference', 'expiresAt', 'idempotencyDigest', 'publisherHandle'
];

export function parseSubmissionDetailArguments(args) {
  let execute = false;
  let submissionId = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true, execute, submissionId };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (argument !== '--submission-id') throw new Error(`Unknown option: ${argument}`);
    if (submissionId !== null) throw new Error('--submission-id may be supplied only once.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--submission-id requires a value.');
    submissionId = value;
    index += 1;
  }
  if (!isPublicId(submissionId, 'sub')) throw new Error('--submission-id must be a valid submission ID.');
  return { help: false, execute, submissionId };
}

export function validateSubmissionDetail(row) {
  const states = ['queued', 'processing', 'changes-requested', 'rejected', 'failed', 'accepted', 'published', 'withdrawn'];
  if (!isRecord(row) || !hasExactKeys(row, DETAIL_KEYS)
    || !isTimestamp(row.observed_at) || !isPublicId(row.submission_id, 'sub')
    || !states.includes(row.submission_state) || !isRepositoryUrl(row.repository_url)
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.source_commit)
    || !isSourcePath(row.source_path) || !isText(row.version_label, 1, 100)
    || (row.submitter_license_claim !== null && !isText(row.submitter_license_claim, 2, 200))
    || !isText(row.submission_policy_version, 1, 64)
    || typeof row.authority_confirmed !== 'boolean'
    || typeof row.untrusted_processing_accepted !== 'boolean'
    || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 || row.attempt_count > 20
    || (row.current_worker_version !== null && !isText(row.current_worker_version, 1, 128))
    || !['not-run', 'passed', 'warnings', 'blocked'].includes(row.audit_state)
    || !['ungraded', 'provisional', 'blocked'].includes(row.grade_state)
    || !['not-started', 'approved', 'changes-requested', 'rejected', 'published', 'withdrawn'].includes(row.review_state)
    || (row.remediation_code !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(row.remediation_code))
    || (row.public_status_message !== null && !isText(row.public_status_message, 1, 500))
    || (row.result_skill_id !== null && !isPublicId(row.result_skill_id, 'skl'))
    || (row.result_version_id !== null && !isPublicId(row.result_version_id, 'skv'))
    || !isNullableDigest(row.publication_digest) || !isNullableDigest(row.last_transition_digest)
    || !isTimestamp(row.created_at) || !isTimestamp(row.updated_at)
    || !isNullableTimestamp(row.claimed_at) || !isNullableTimestamp(row.claim_expires_at)
    || !isNullableTimestamp(row.completed_at)
    || !['claim_expired', 'retry_eligible', 'dead_letter_ready', 'publication_review_ready',
      'transition_events_truncated', 'collision_reviews_truncated', 'publisher_authorizations_truncated']
      .every(key => typeof row[key] === 'boolean')) {
    throw new Error('Submission detail returned an invalid core projection.');
  }
  if (row.dead_letter_ready && !row.claim_expired) {
    throw new Error('Submission detail returned an inconsistent dead-letter projection.');
  }
  validateAudit(row.audit_receipt);
  validateGrade(row.grade_receipt);
  validateReview(row.review_case);
  validateWorkerRuns(row.worker_runs);
  validateEvents(row.transition_events, row.transition_events_truncated);
  validateLicenseEvidence(row.license_evidence_receipt);
  validateCollisions(row.collision_reviews, row.collision_reviews_truncated);
  validateAuthorizations(row.publisher_authorizations, row.publisher_authorizations_truncated);
  return row;
}

export async function runSubmissionDetail(options, dependencies = {}) {
  if (!options.execute) {
    throw new Error('Refusing service-role submission detail access without the explicit --execute flag.');
  }
  const rpc = dependencies.rpc ?? createSupabaseRpcClientFromEnvironment();
  const rows = await rpc.call('get_skill_submission_operator_detail', {
    p_submission_id: options.submissionId
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('Submission detail returned an invalid exact result.');
  }
  return {
    schemaVersion: 'skillmap-operator-submission-detail/v1',
    result: 'completed',
    mutation: false,
    submission: validateSubmissionDetail(rows[0])
  };
}

function validateAudit(value) {
  if (value === null) return;
  if (!isRecord(value) || !hasExactKeys(value, AUDIT_KEYS)
    || !isPublicId(value.receiptId, 'aud') || !isDigest(value.receiptDigest)
    || !isDigest(value.sourceContentDigest) || !isDigest(value.normalizedContentDigest)
    || !['passed', 'warnings', 'blocked'].includes(value.state)
    || !isRecord(value.findingCounts) || !Array.isArray(value.publicChecks) || value.publicChecks.length > 100
    || !isReasonCodes(value.reasonCodes, true) || !isText(value.policyVersion, 1, 64)
    || !isText(value.hostProfileVersion, 1, 64) || !isText(value.workerVersion, 1, 128)
    || !['confirmed', 'noassertion', 'restricted'].includes(value.licenseState)
    || (value.spdxExpression !== null && !isText(value.spdxExpression, 1, 64))
    || typeof value.permissionScripts !== 'boolean' || typeof value.networkIndicators !== 'boolean'
    || typeof value.toolIndicators !== 'boolean' || !isTimestamp(value.createdAt)) {
    throw new Error('Submission detail returned an invalid audit receipt projection.');
  }
}

function validateGrade(value) {
  if (value === null) return;
  if (!isRecord(value) || !hasExactKeys(value, GRADE_KEYS)
    || !isPublicId(value.receiptId, 'grd') || !isDigest(value.receiptDigest)
    || !isDigest(value.auditReceiptDigest) || !isDigest(value.normalizedContentDigest)
    || !isNullableDigest(value.compatibilityEvidenceDigest) || !isNullableDigest(value.evaluationSuiteDigest)
    || !['provisional', 'blocked'].includes(value.state) || value.band !== null
    || (value.totalScore !== null && (!Number.isFinite(value.totalScore) || value.totalScore < 0 || value.totalScore > 100))
    || (value.confidence !== null && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1))
    || !Array.isArray(value.hardGates) || value.hardGates.length > 50
    || !Array.isArray(value.dimensions) || value.dimensions.length > 20
    || !isReasonCodes(value.reasonCodes, false) || !isText(value.rubricVersion, 1, 64)
    || !isText(value.hostProfileVersion, 1, 64) || !isText(value.evaluatorVersion, 1, 128)
    || !isTimestamp(value.createdAt)) {
    throw new Error('Submission detail returned an invalid grade receipt projection.');
  }
}

function validateReview(value) {
  if (value === null) return;
  if (!isRecord(value) || !hasExactKeys(value, REVIEW_KEYS)
    || !isPublicId(value.reviewId, 'rev')
    || !['pending', 'approved', 'changes-requested', 'rejected'].includes(value.state)
    || !isReasonCodes(value.reasonCodes, true)
    || (value.publicMessage !== null && !isText(value.publicMessage, 1, 500))
    || !isDigest(value.idempotencyDigest) || !isNullableDigest(value.collisionEvidenceDigest)
    || !isTimestamp(value.createdAt)) {
    throw new Error('Submission detail returned an invalid review projection.');
  }
}

function validateWorkerRuns(values) {
  if (!Array.isArray(values) || values.length > 20) throw new Error('Submission detail returned invalid worker history.');
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, WORKER_KEYS)
      || !isPublicId(value.runId, 'wrk') || !isText(value.workerVersion, 1, 128)
      || !Number.isSafeInteger(value.attemptNumber) || value.attemptNumber < 1 || value.attemptNumber > 20
      || !['succeeded', 'failed', 'cancelled'].includes(value.outcome)
      || !['accepted', 'changes-requested', 'rejected', 'failed'].includes(value.disposition)
      || !isDigest(value.inputDigest) || !isNullableDigest(value.resultDigest)
      || (value.errorCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.errorCode))
      || (value.publicErrorMessage !== null && !isText(value.publicErrorMessage, 1, 240))
      || !isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
      throw new Error('Submission detail returned invalid worker history.');
    }
  }
}

function validateEvents(values, truncated) {
  if (!Array.isArray(values) || values.length > 50 || (truncated && values.length !== 50)) {
    throw new Error('Submission detail returned invalid transition history.');
  }
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)
      || !isPublicId(value.eventId, 'sev')
      || (value.fromState !== null && typeof value.fromState !== 'string')
      || typeof value.toState !== 'string' || !['submitter', 'worker', 'system'].includes(value.actorType)
      || !isNullableDigest(value.transitionDigest) || !isTimestamp(value.createdAt)) {
      throw new Error('Submission detail returned invalid transition history.');
    }
  }
}

function validateLicenseEvidence(value) {
  if (value === null) return;
  if (!isRecord(value) || !hasExactKeys(value, LICENSE_KEYS)
    || !isPublicId(value.receiptId, 'lic') || !isText(value.workerVersion, 1, 128)
    || !isDigest(value.auditReceiptDigest) || !isText(value.spdxExpression, 1, 64)
    || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 20
    || !/^licref_[0-9a-f]{32}$/.test(value.reviewReference)
    || !isDigest(value.reviewEvidenceDigest) || !isTimestamp(value.createdAt)) {
    throw new Error('Submission detail returned invalid license evidence metadata.');
  }
  for (const evidence of value.evidence) {
    if (!isRecord(evidence) || !hasExactKeys(evidence, ['contentDigest', 'path', 'repositoryUrl', 'sourceCommit'])
      || !isDigest(evidence.contentDigest) || !isRepositoryUrl(evidence.repositoryUrl)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(evidence.sourceCommit)
      || !isText(evidence.path, 1, 500)) {
      throw new Error('Submission detail returned invalid license evidence metadata.');
    }
  }
}

function validateCollisions(values, truncated) {
  if (!Array.isArray(values) || values.length > 20 || (truncated && values.length !== 20)) {
    throw new Error('Submission detail returned invalid collision history.');
  }
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, COLLISION_KEYS)
      || !isPublicId(value.reviewId, 'col') || !isDigest(value.reviewSubjectDigest)
      || ![1, 2].includes(value.authorityVersion)
      || !['approved-distinct', 'approved-update', 'blocked-duplicate'].includes(value.disposition)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.reasonCode)
      || (value.targetPublisherId !== null && !isPublicId(value.targetPublisherId, 'pub'))
      || (value.targetSkillId !== null && !isPublicId(value.targetSkillId, 'skl'))
      || (value.targetVersionId !== null && !isPublicId(value.targetVersionId, 'skv'))
      || !isDigest(value.idempotencyDigest) || !isTimestamp(value.createdAt)) {
      throw new Error('Submission detail returned invalid collision history.');
    }
  }
}

function validateAuthorizations(values, truncated) {
  if (!Array.isArray(values) || values.length > 20 || (truncated && values.length !== 20)) {
    throw new Error('Submission detail returned invalid authorization history.');
  }
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, AUTHORIZATION_KEYS)
      || !isPublicId(value.authorizationId, 'aut') || !isText(value.publisherHandle, 2, 40)
      || !['authorized', 'revoked'].includes(value.decision)
      || (value.authorizationBasis !== null
        && !['publisher-consent', 'publisher-owner-approval', 'authorized-delegate-approval'].includes(value.authorizationBasis))
      || !/^authref_[0-9a-f]{32}$/.test(value.evidenceReference) || !isDigest(value.evidenceDigest)
      || !isNullableTimestamp(value.expiresAt) || !isDigest(value.idempotencyDigest)
      || !isTimestamp(value.createdAt)) {
      throw new Error('Submission detail returned invalid authorization history.');
    }
  }
}

function help() {
  return `SkillMap submission detail operator\n\n` +
    `Read one exact submission and bounded redacted receipt history through a service-role-only RPC.\n` +
    `Credential use requires: --execute (the command remains read-only).\n\n` +
    `Usage: node apps/worker/src/submission-detail.mjs --execute --submission-id sub_…\n`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isText(value, minimum, maximum) {
  return typeof value === 'string'
    && Array.from(value).length >= minimum && Array.from(value).length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isNullableDigest(value) {
  return value === null || isDigest(value);
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
  return isText(value, 8, 500) && !value.startsWith('/') && !value.includes('\\')
    && !value.includes('//') && !/(^|\/)\.{1,2}(\/|$)/.test(value) && /(^|\/)SKILL[.]md$/.test(value);
}

function isReasonCodes(value, allowEmpty) {
  return Array.isArray(value) && value.length <= 20 && (allowEmpty || value.length > 0)
    && value.every(code => typeof code === 'string'
      && code.length >= 1 && code.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code));
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

async function main(args) {
  try {
    const options = parseSubmissionDetailArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runSubmissionDetail(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap submission detail command failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
