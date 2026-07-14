#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';
import { runSubmissionQueue } from './submission-queue.mjs';
import { runReportQueue } from './report-queue.mjs';

const REPORT_PAGE_SIZE = 50;
const MAX_REPORT_PAGES = 20;

const POLICY_FIELDS = Object.freeze({
  maxQueuedAgeSeconds: {
    variable: 'SKILLMAP_OPS_MAX_QUEUED_AGE_SECONDS', defaultValue: 3600, minimum: 60, maximum: 86400
  },
  maxAcceptedAgeSeconds: {
    variable: 'SKILLMAP_OPS_MAX_ACCEPTED_AGE_SECONDS', defaultValue: 7200, minimum: 60, maximum: 172800
  },
  maxRemediationAgeSeconds: {
    variable: 'SKILLMAP_OPS_MAX_REMEDIATION_AGE_SECONDS', defaultValue: 86400, minimum: 300, maximum: 604800
  },
  maxReportAgeSeconds: {
    variable: 'SKILLMAP_OPS_MAX_REPORT_AGE_SECONDS', defaultValue: 3600, minimum: 60, maximum: 86400
  },
  maxQueuedSubmissions: {
    variable: 'SKILLMAP_OPS_MAX_QUEUED_SUBMISSIONS', defaultValue: 32, minimum: 1, maximum: 10000
  },
  maxQueuedReports: {
    variable: 'SKILLMAP_OPS_MAX_QUEUED_REPORTS', defaultValue: 20, minimum: 1, maximum: 1000
  }
});

export function parseOperationsCheckArguments(args) {
  let execute = false;
  for (const argument of args) {
    if (argument === '--help' || argument === '-h') return { help: true, execute };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return { help: false, execute };
}

export function loadOperationsPolicy(environment = process.env) {
  const policy = {};
  for (const [field, contract] of Object.entries(POLICY_FIELDS)) {
    const raw = environment[contract.variable];
    if (raw === undefined || raw === '') {
      policy[field] = contract.defaultValue;
      continue;
    }
    if (raw !== raw.trim() || !/^[1-9]\d*$/.test(raw)) {
      throw new Error(`${contract.variable} must be one canonical positive integer.`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < contract.minimum || value > contract.maximum) {
      throw new Error(`${contract.variable} must be from ${contract.minimum} through ${contract.maximum}.`);
    }
    policy[field] = value;
  }
  return Object.freeze(policy);
}

export function evaluateOperationsSnapshot({
  summary,
  reportCount,
  oldestReportAt,
  reportTraversalTruncated,
  policy
}) {
  const observedAtMs = Date.parse(summary.observed_at);
  if (!Number.isFinite(observedAtMs)) throw new Error('Operations snapshot has an invalid observation time.');
  const ages = {
    oldestQueuedSeconds: ageSeconds(summary.oldest_queued_at, observedAtMs),
    oldestAcceptedSeconds: ageSeconds(summary.oldest_accepted_at, observedAtMs),
    oldestRemediationSeconds: ageSeconds(summary.oldest_remediation_at, observedAtMs),
    oldestReportSeconds: ageSeconds(oldestReportAt, observedAtMs)
  };
  const alerts = [];
  const add = (code, severity, observed, threshold = null) => {
    alerts.push({ code, severity, observed, threshold });
  };

  if (summary.queued_count > policy.maxQueuedSubmissions) {
    add('SUBMISSION_QUEUE_COUNT_HIGH', 'warning', summary.queued_count, policy.maxQueuedSubmissions);
  }
  if (ages.oldestQueuedSeconds !== null && ages.oldestQueuedSeconds > policy.maxQueuedAgeSeconds) {
    add('SUBMISSION_QUEUE_AGE_HIGH', 'warning', ages.oldestQueuedSeconds, policy.maxQueuedAgeSeconds);
  }
  if (ages.oldestAcceptedSeconds !== null && ages.oldestAcceptedSeconds > policy.maxAcceptedAgeSeconds) {
    add('PUBLICATION_REVIEW_AGE_HIGH', 'warning', ages.oldestAcceptedSeconds, policy.maxAcceptedAgeSeconds);
  }
  if (ages.oldestRemediationSeconds !== null && ages.oldestRemediationSeconds > policy.maxRemediationAgeSeconds) {
    add('REMEDIATION_AGE_HIGH', 'warning', ages.oldestRemediationSeconds, policy.maxRemediationAgeSeconds);
  }
  if (summary.expired_processing_count > 0) {
    add('EXPIRED_PROCESSING_CLAIM', 'critical', summary.expired_processing_count, 0);
  }
  if (summary.retryable_count > 0) {
    add('RETRYABLE_SUBMISSION_PENDING', 'warning', summary.retryable_count, 0);
  }
  if (summary.dead_letter_ready_count > 0) {
    add('DEAD_LETTER_ACTION_REQUIRED', 'critical', summary.dead_letter_ready_count, 0);
  }
  if (summary.failed_count > 0) {
    add('FAILED_SUBMISSION_PRESENT', 'warning', summary.failed_count, 0);
  }
  if ((summary.queued_count > 0) !== (summary.oldest_queued_at !== null)
    || (summary.accepted_count > 0) !== (summary.oldest_accepted_at !== null)) {
    add('SUBMISSION_SUMMARY_CONTRADICTION', 'critical', true, false);
  }
  if (reportCount > policy.maxQueuedReports) {
    add('REPORT_QUEUE_COUNT_HIGH', 'warning', reportCount, policy.maxQueuedReports);
  }
  if (ages.oldestReportSeconds !== null && ages.oldestReportSeconds > policy.maxReportAgeSeconds) {
    add('REPORT_QUEUE_AGE_HIGH', 'warning', ages.oldestReportSeconds, policy.maxReportAgeSeconds);
  }
  if ((reportCount > 0) !== (oldestReportAt !== null)) {
    add('REPORT_SUMMARY_CONTRADICTION', 'critical', true, false);
  }
  if (reportTraversalTruncated) {
    add('REPORT_QUEUE_TRAVERSAL_TRUNCATED', 'critical', reportCount, REPORT_PAGE_SIZE * MAX_REPORT_PAGES);
  }

  return {
    schemaVersion: 'skillmap-hosted-operations-check/v1',
    result: alerts.length ? 'alert' : 'passed',
    mutation: false,
    observedAt: summary.observed_at,
    policy,
    metrics: {
      submissions: {
        queued: summary.queued_count,
        processing: summary.processing_count,
        accepted: summary.accepted_count,
        changesRequested: summary.changes_requested_count,
        failed: summary.failed_count,
        expiredProcessing: summary.expired_processing_count,
        retryable: summary.retryable_count,
        deadLetterReady: summary.dead_letter_ready_count,
        oldestQueuedSeconds: ages.oldestQueuedSeconds,
        oldestAcceptedSeconds: ages.oldestAcceptedSeconds,
        oldestRemediationSeconds: ages.oldestRemediationSeconds
      },
      reports: {
        queued: reportCount,
        oldestQueuedSeconds: ages.oldestReportSeconds,
        traversalTruncated: reportTraversalTruncated
      }
    },
    alerts
  };
}

export async function runOperationsCheck(options, dependencies = {}) {
  if (!options.execute) {
    throw new Error('Refusing service-role operations access without the explicit --execute flag.');
  }
  const rpc = dependencies.rpc ?? createSupabaseRpcClientFromEnvironment();
  const policy = dependencies.policy ?? loadOperationsPolicy(dependencies.environment);
  const submissionQueue = await runSubmissionQueue({
    help: false,
    execute: true,
    state: null,
    limit: 1,
    afterUpdatedAt: null,
    afterSubmissionId: null
  }, { rpc });

  let afterCreatedAt = null;
  let afterReportId = null;
  let reportCount = 0;
  let oldestReportAt = null;
  let reportTraversalTruncated = false;
  for (let page = 0; page < MAX_REPORT_PAGES; page += 1) {
    const reportQueue = await runReportQueue({
      help: false,
      execute: true,
      limit: REPORT_PAGE_SIZE,
      afterCreatedAt,
      afterReportId
    }, { rpc });
    reportCount += reportQueue.count;
    oldestReportAt ??= reportQueue.reports[0]?.created_at ?? null;
    if (reportQueue.count < REPORT_PAGE_SIZE) break;
    if (!reportQueue.nextCursor) throw new Error('Report queue pagination returned an incomplete cursor.');
    afterCreatedAt = reportQueue.nextCursor.createdAt;
    afterReportId = reportQueue.nextCursor.reportId;
    if (page === MAX_REPORT_PAGES - 1) reportTraversalTruncated = true;
  }

  return evaluateOperationsSnapshot({
    summary: submissionQueue.summary,
    reportCount,
    oldestReportAt,
    reportTraversalTruncated,
    policy
  });
}

function ageSeconds(timestamp, observedAtMs) {
  if (timestamp === null) return null;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error('Operations snapshot contains an invalid queue timestamp.');
  return Math.max(0, Math.floor((observedAtMs - value) / 1000));
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

function help() {
  return `SkillMap hosted operations check\n\n` +
    `Read the redacted service-only submission and report queues, evaluate bounded private-alpha thresholds,\n` +
    `and emit one identifier-free versioned JSON receipt. The command never mutates queue state.\n` +
    `Credential use requires: --execute\n\n` +
    `Usage: node apps/worker/src/operations-check.mjs --execute\n`;
}

async function main(args) {
  try {
    const options = parseOperationsCheckArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    const receipt = await runOperationsCheck(options);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.result !== 'passed') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`SkillMap hosted operations check failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
