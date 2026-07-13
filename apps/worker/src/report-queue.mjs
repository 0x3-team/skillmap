#!/usr/bin/env node

import process from 'node:process';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing service-role report access without the explicit --execute flag.');
  const rows = await createSupabaseRpcClientFromEnvironment().call('list_skill_report_queue', {
    p_limit: options.limit
  });
  if (!Array.isArray(rows) || rows.length > options.limit) throw new Error('Report queue returned an invalid bounded result.');
  for (const row of rows) validateRow(row);
  process.stdout.write(`${JSON.stringify({ result: 'completed', mutation: false, count: rows.length, reports: rows })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap report queue command failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  let execute = false;
  let limit = 20;
  let seenLimit = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (argument !== '--limit') throw new Error(`Unknown option: ${argument}`);
    if (seenLimit) throw new Error('--limit may be supplied only once.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--limit requires a value.');
    limit = Number(value);
    seenLimit = true;
    index += 1;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be an integer from 1 through 50.');
  return { help: false, execute, limit };
}

function validateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'category,created_at,message,report_id,skill_id,version_id'
    || !/^rpt_[0-9a-f]{32}$/.test(row.report_id)
    || !/^skl_[0-9a-f]{32}$/.test(row.skill_id)
    || !/^skv_[0-9a-f]{32}$/.test(row.version_id)
    || !['security', 'malware', 'misleading', 'license', 'privacy', 'broken', 'spam', 'other'].includes(row.category)
    || typeof row.message !== 'string' || row.message.length < 1 || row.message.length > 2000
    || /[\u0000-\u001f\u007f]/.test(row.message)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error('Report queue returned an invalid report projection.');
  }
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

function help() {
  return `SkillMap report queue operator\n\n` +
    `Read at most 50 oldest queued reports through a service-role-only bounded RPC.\n` +
    `Credential use requires: --execute (the command remains read-only).\n\n` +
    `Usage: node apps/worker/src/report-queue.mjs --execute [--limit 20]\n`;
}
