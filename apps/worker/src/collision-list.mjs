#!/usr/bin/env node

import process from 'node:process';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing service-authority collision lookup without the explicit --execute flag.');
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('list_skill_submission_collisions', {
    p_submission_id: options.submissionId
  });
  process.stdout.write(`${JSON.stringify({ result: 'collision-evidence', mutation: false, evidence: result })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap hosted collision lookup failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

export function parseArguments(args) {
  let execute = false;
  let submissionId;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (argument !== '--submission-id' || submissionId !== undefined) throw new Error(`Unknown or duplicate option: ${argument}`);
    submissionId = args[index + 1];
    if (!submissionId || submissionId.startsWith('--')) throw new Error('--submission-id requires a value.');
    index += 1;
  }
  if (!/^sub_[0-9a-f]{32}$/.test(submissionId ?? '')) throw new Error('--submission-id is required and invalid.');
  return { help: false, execute, submissionId };
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Collision lookup failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted collision lookup\n\n` +
    `Read bounded completion-time and current-catalog collision evidence through a service-role-only RPC.\n` +
    `The command is read-only but requires --execute before loading service authority.\n\n` +
    `Usage: node apps/worker/src/collision-list.mjs --execute --submission-id sub_...\n`;
}
