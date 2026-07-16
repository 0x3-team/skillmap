#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const MAX_HOOK_INPUT_BYTES = 64 * 1024;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function isDirectGitCommitCommand(value) {
  return typeof value === 'string' && /^[ \t]*git[ \t]+commit(?:[ \t]|$)/.test(value);
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
  const result = spawn(npm, ['test'], {
    cwd: repo,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  return result.status === 0 ? 0 : result.status ?? 1;
}

export async function readBoundedHookInput(stream, maxBytes = MAX_HOOK_INPUT_BYTES) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length > maxBytes - totalBytes) {
      const limit = maxBytes === MAX_HOOK_INPUT_BYTES ? '64 KiB' : `${maxBytes} bytes`;
      throw new Error(`hook input exceeds the ${limit} limit`);
    }
    chunks.push(bytes);
    totalBytes += bytes.length;
  }
  return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
}

async function main() {
  const input = await readBoundedHookInput(process.stdin);
  process.exitCode = runPreCommitGate(input);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown hook error';
    console.error(`SkillMap pre-commit hook failed: ${message}`);
    process.exitCode = 2;
  }
}
