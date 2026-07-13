#!/usr/bin/env node

import process from 'node:process';
import { canonicalDigest } from './operator-receipts.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing requeue without the explicit --execute flag.');
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-requeue-request', schemaVersion: 1,
    submissionId: options.submissionId
  });
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('requeue_skill_submission', {
    p_submission_id: options.submissionId,
    p_idempotency_digest: idempotencyDigest
  });
  process.stdout.write(`${JSON.stringify({ result: 'requeued', mutation: true, idempotencyDigest, submission: result })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Requeue failed.';
  process.stderr.write(`SkillMap hosted requeue failed: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const execute = args.includes('--execute');
  const index = args.indexOf('--submission-id');
  const submissionId = index >= 0 ? args[index + 1] : '';
  const allowed = new Set(['--execute', '--submission-id', submissionId]);
  if (args.some(argument => !allowed.has(argument)) || args.filter(argument => argument === '--execute').length > 1
    || args.filter(argument => argument === '--submission-id').length !== 1
    || !/^sub_[0-9a-f]{32}$/.test(submissionId)) throw new Error('Usage requires one canonical --submission-id and optional --execute.');
  return { help: false, execute, submissionId };
}

function help() {
  return `SkillMap hosted requeue\n\n` +
    `Requeue one eligible failed or changes-requested submission. Mutation requires --execute.\n` +
    `Usage: node apps/worker/src/requeue.mjs --execute --submission-id sub_...\n`;
}
