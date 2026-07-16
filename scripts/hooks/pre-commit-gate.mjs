#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MAX_HOOK_INPUT_BYTES = 64 * 1024;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function isDirectGitCommitCommand(value) {
  return typeof value === 'string' && /^\s*git\s+commit(?:\s|$)/.test(value);
}

export function shouldRunPreCommitGate(input) {
  return Boolean(
    input
      && typeof input === 'object'
      && input.tool_name === 'Bash'
      && input.tool_input
      && typeof input.tool_input === 'object'
      && isDirectGitCommitCommand(input.tool_input.command)
  );
}

export function runPreCommitGate(input, spawn = spawnSync) {
  if (!shouldRunPreCommitGate(input)) return 0;

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const args of [['ci'], ['test']]) {
    const result = spawn(npm, args, {
      cwd: repo,
      env: process.env,
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function main() {
  const bytes = readFileSync(0);
  if (bytes.length > MAX_HOOK_INPUT_BYTES) {
    throw new Error('hook input exceeds the 64 KiB limit');
  }
  const input = JSON.parse(bytes.toString('utf8'));
  process.exitCode = runPreCommitGate(input);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown hook error';
    console.error(`SkillMap pre-commit hook failed: ${message}`);
    process.exitCode = 2;
  }
}
