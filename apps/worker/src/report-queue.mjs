#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const MAX_REPORT_ROWS = 50;
const REPORT_KEYS = [
  'category', 'created_at', 'message', 'report_id', 'skill_id', 'version_id'
];

export function parseReportQueueArguments(args) {
  const options = {
    help: false,
    execute: false,
    limit: 20,
    afterCreatedAt: null,
    afterReportId: null
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
    if (!['--limit', '--after-created-at', '--after-report-id'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`${argument} may be supplied only once.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    seen.add(argument);
    index += 1;
    if (argument === '--limit') options.limit = Number(value);
    if (argument === '--after-created-at') options.afterCreatedAt = value;
    if (argument === '--after-report-id') options.afterReportId = value;
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_REPORT_ROWS) {
    throw new Error(`--limit must be an integer from 1 through ${MAX_REPORT_ROWS}.`);
  }
  if ((options.afterCreatedAt === null) !== (options.afterReportId === null)) {
    throw new Error('Both report cursor options must be supplied together.');
  }
  if (options.afterCreatedAt !== null && !isTimestamp(options.afterCreatedAt)) {
    throw new Error('--after-created-at must be an ISO timestamp.');
  }
  if (options.afterReportId !== null && !/^rpt_[0-9a-f]{32}$/.test(options.afterReportId)) {
    throw new Error('--after-report-id must be a valid report ID.');
  }
  return options;
}

export function validateReportQueueRow(row) {
  if (!isRecord(row)
    || Object.keys(row).sort().join(',') !== [...REPORT_KEYS].sort().join(',')
    || !/^rpt_[0-9a-f]{32}$/.test(row.report_id)
    || !/^skl_[0-9a-f]{32}$/.test(row.skill_id)
    || !/^skv_[0-9a-f]{32}$/.test(row.version_id)
    || !['security', 'malware', 'misleading', 'license', 'privacy', 'broken', 'spam', 'other'].includes(row.category)
    || typeof row.message !== 'string'
    || Array.from(row.message).length < 1
    || Array.from(row.message).length > 2000
    || /[\u0000-\u001f\u007f]/.test(row.message)
    || !isTimestamp(row.created_at)) {
    throw new Error('Report queue returned an invalid report projection.');
  }
  return row;
}

export async function runReportQueue(options, dependencies = {}) {
  if (!options.execute) {
    throw new Error('Refusing service-role report access without the explicit --execute flag.');
  }
  const rpc = dependencies.rpc ?? createSupabaseRpcClientFromEnvironment();
  const rows = await rpc.call('list_skill_report_queue', {
    p_limit: options.limit,
    p_after_created_at: options.afterCreatedAt,
    p_after_report_id: options.afterReportId
  });
  if (!Array.isArray(rows) || rows.length > options.limit) {
    throw new Error('Report queue returned an invalid bounded result.');
  }
  for (const row of rows) validateReportQueueRow(row);
  const last = rows.at(-1);
  return {
    schemaVersion: 'skillmap-operator-report-queue/v1',
    result: 'completed',
    mutation: false,
    count: rows.length,
    reports: rows,
    cursorSemantics: 'best-effort-live-by-created-at-restart-required',
    reconciliationRequired: true,
    nextCursor: last ? { createdAt: last.created_at, reportId: last.report_id } : null
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

function help() {
  return `SkillMap report queue operator\n\n` +
    `Read at most 50 queued reports after an exact paired cursor through a service-role-only bounded RPC.\n` +
    `Credential use requires: --execute (the command remains read-only).\n\n` +
    `Usage: node apps/worker/src/report-queue.mjs --execute [options]\n\n` +
    `Options:\n` +
    `  --limit 20                    Return 1 through 50 rows.\n` +
    `  --after-created-at ISO        Live cursor timestamp; requires --after-report-id.\n` +
    `  --after-report-id rpt_…       Cursor public ID; requires --after-created-at.\n`;
}

async function main(args) {
  try {
    const options = parseReportQueueArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runReportQueue(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap report queue command failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
