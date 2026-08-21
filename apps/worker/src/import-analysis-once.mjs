#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

export const IMPORT_ANALYSIS_WORKER_VERSION = 'skillmap-import-analysis/0.1.0';

const JOB_ID = /^iaj_[0-9a-f]{32}$/;
const SKILL_ID = /^msk_[0-9a-f]{32}$/;
const VERSION_ID = /^msv_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKER_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const REASON = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function validateClaim(value) {
  if (!value || typeof value !== 'object'
    || !JOB_ID.test(value.job_public_id ?? '')
    || !SKILL_ID.test(value.skill_public_id ?? '')
    || !VERSION_ID.test(value.version_public_id ?? '')
    || !REASON.test(value.reason ?? '')
    || !Number.isSafeInteger(value.priority)
    || !Number.isSafeInteger(value.attempt_count)
    || !Number.isSafeInteger(value.max_attempts)
    || value.attempt_count < 1
    || value.max_attempts < 1
    || value.attempt_count > value.max_attempts
    || !UUID.test(value.lease_token ?? '')
    || typeof value.lease_expires_at !== 'string'
    || Number.isNaN(Date.parse(value.lease_expires_at))) {
    throw new Error('Import analysis claim is invalid.');
  }
  return value;
}

function resultDigest(claim) {
  const payload = [
    'SKILLMAP-IMPORT-ANALYSIS-RESULT-V1',
    claim.job_public_id,
    claim.skill_public_id,
    claim.version_public_id,
    claim.reason,
    String(claim.attempt_count),
    IMPORT_ANALYSIS_WORKER_VERSION,
    ''
  ].join('\n');
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export async function processImportAnalysisOnce({
  rpc,
  workerId,
  leaseSeconds = 60
}) {
  if (!rpc || typeof rpc.call !== 'function') throw new Error('An RPC client is required.');
  if (typeof workerId !== 'string' || !WORKER_ID.test(workerId)) throw new Error('Worker ID is invalid.');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 300) {
    throw new Error('Lease seconds must be from 15 through 300.');
  }
  const claimed = await rpc.call('claim_import_analysis_jobs', {
    p_worker_id: workerId,
    p_limit: 1,
    p_lease_seconds: leaseSeconds
  });
  if (!Array.isArray(claimed) || claimed.length > 1) throw new Error('Import analysis claim RPC returned an invalid bounded result.');
  if (claimed.length === 0) return { result: 'idle', mutation: false };
  const claim = validateClaim(claimed[0]);
  const digest = resultDigest(claim);
  try {
    const completion = await rpc.call('complete_import_analysis_job', {
      p_job_public_id: claim.job_public_id,
      p_worker_id: workerId,
      p_lease_token: claim.lease_token,
      p_result_digest: digest
    });
    if (!completion || completion.job_public_id !== claim.job_public_id
      || completion.state !== 'completed' || completion.result_digest !== digest) {
      throw new Error('Import analysis completion RPC returned an invalid result.');
    }
    return { result: 'completed', mutation: true, jobPublicId: claim.job_public_id, resultDigest: digest };
  } catch (error) {
    try {
      await rpc.call('fail_import_analysis_job', {
        p_job_public_id: claim.job_public_id,
        p_worker_id: workerId,
        p_lease_token: claim.lease_token,
        p_error_code: 'analysis_failed',
        p_retry_delay_seconds: 30
      });
    } catch {
      // Preserve the first failure. The exact lease remains recoverable after expiry.
    }
    throw error;
  }
}

function parseArguments(args) {
  let execute = false;
  let workerId = `import-worker-${process.pid}`;
  let leaseSeconds = 60;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') { execute = true; continue; }
    if (argument !== '--worker-id' && argument !== '--lease-seconds') throw new Error(`Unknown option: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    if (argument === '--worker-id') workerId = value;
    else leaseSeconds = Number(value);
  }
  return { execute, workerId, leaseSeconds };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node apps/worker/src/import-analysis-once.mjs --execute [--worker-id NAME] [--lease-seconds 60]\n');
    return;
  }
  if (!options.execute) throw new Error('Refusing database mutation without the explicit --execute flag.');
  const result = await processImportAnalysisOnce({
    rpc: createSupabaseRpcClientFromEnvironment(),
    workerId: options.workerId,
    leaseSeconds: options.leaseSeconds
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`SkillMap import analysis worker failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
