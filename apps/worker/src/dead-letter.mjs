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
  if (!options.execute) throw new Error('Refusing dead-letter mutation without the explicit --execute flag.');
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-dead-letter-request',
    schemaVersion: 1,
    submissionId: options.submissionId,
    operationId: options.operationId
  });
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('dead_letter_expired_skill_submission', {
    p_submission_id: options.submissionId,
    p_idempotency_digest: idempotencyDigest
  });
  process.stdout.write(`${JSON.stringify({
    result: 'dead-lettered', mutation: true, idempotencyDigest, submission: result
  })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap hosted dead-letter recovery failed: ${safeError(error)}\n`);
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
    if (!['--submission-id', '--operation-id'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--operation-id'] ?? '')) {
    throw new Error('--operation-id is required and must be one canonical UUID.');
  }
  return { help: false, execute, submissionId: values['--submission-id'], operationId: values['--operation-id'] };
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Dead-letter recovery failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted dead-letter recovery\n\n` +
    `Terminalize one exact expired max-attempt processing claim through a service-role-only RPC.\n` +
    `Mutation requires --execute. Reuse an operation UUID only for an exact retry.\n\n` +
    `Usage: node apps/worker/src/dead-letter.mjs --execute --submission-id sub_... --operation-id UUID\n`;
}
