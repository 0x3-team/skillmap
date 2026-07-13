#!/usr/bin/env node

import process from 'node:process';
import { canonicalDigest } from './operator-receipts.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const DISPOSITIONS = new Set(['approved-distinct', 'approved-update', 'blocked-duplicate']);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing collision review mutation without the explicit --execute flag.');
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.hosted-collision-review-request',
    schemaVersion: 1,
    submissionId: options.submissionId,
    disposition: options.disposition,
    reasonCode: options.reasonCode,
    operationId: options.operationId
  });
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('review_skill_submission_collisions', {
    p_submission_id: options.submissionId,
    p_disposition: options.disposition,
    p_reason_code: options.reasonCode,
    p_idempotency_digest: idempotencyDigest
  });
  process.stdout.write(`${JSON.stringify({
    result: 'collision-reviewed', mutation: true, idempotencyDigest, review: result
  })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap hosted collision review failed: ${safeError(error)}\n`);
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
    if (!['--submission-id', '--disposition', '--reason-code', '--operation-id'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!DISPOSITIONS.has(values['--disposition'])) throw new Error('--disposition is invalid.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values['--reason-code'] ?? '') || values['--reason-code'].length > 64) {
    throw new Error('--reason-code is required and invalid.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--operation-id'] ?? '')) {
    throw new Error('--operation-id is required and must be one canonical UUID.');
  }
  return {
    help: false,
    execute,
    submissionId: values['--submission-id'],
    disposition: values['--disposition'],
    reasonCode: values['--reason-code'],
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
    `Mutation requires --execute. Reuse an operation UUID only for an exact retry.\n\n` +
    `Usage: node apps/worker/src/collision-review.mjs --execute --submission-id sub_... ` +
    `--disposition approved-distinct|approved-update|blocked-duplicate --reason-code CODE --operation-id UUID\n`;
}
