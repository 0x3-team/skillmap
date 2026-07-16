import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isDirectGitCommitCommand,
  runPreCommitGate,
  shouldRunPreCommitGate
} from '../scripts/hooks/pre-commit-gate.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repo, relativePath), 'utf8'));
}

test('Claude and Codex project hooks match Bash and delegate command filtering', () => {
  const expectedCommand = 'node scripts/hooks/pre-commit-gate.mjs';
  for (const relativePath of ['.claude/settings.json', '.codex/hooks.json']) {
    const config = readJson(relativePath);
    const entry = config.hooks.PreToolUse[0];
    assert.equal(entry.matcher, 'Bash');
    assert.equal(entry.hooks.length, 1);
    assert.equal(entry.hooks[0].type, 'command');
    assert.equal(entry.hooks[0].command, expectedCommand);
    assert.equal(entry.hooks[0].timeout, 390);
  }
});

test('pre-commit gate recognizes only a direct git commit Bash command', () => {
  assert.equal(isDirectGitCommitCommand('git commit -m "message"'), true);
  assert.equal(isDirectGitCommitCommand('  git   commit --amend'), true);
  assert.equal(isDirectGitCommitCommand('git status'), false);
  assert.equal(isDirectGitCommitCommand('git add . && git commit -m message'), false);
  assert.equal(isDirectGitCommitCommand('echo git commit'), false);
  assert.equal(isDirectGitCommitCommand(undefined), false);

  assert.equal(shouldRunPreCommitGate({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m message' }
  }), true);
  assert.equal(shouldRunPreCommitGate({
    tool_name: 'apply_patch',
    tool_input: { command: 'git commit -m message' }
  }), false);
});

test('pre-commit gate skips non-commit commands and runs npm ci then npm test', () => {
  const skipped = [];
  assert.equal(runPreCommitGate({
    tool_name: 'Bash',
    tool_input: { command: 'git status' }
  }, (...args) => {
    skipped.push(args);
    return { status: 0 };
  }), 0);
  assert.deepEqual(skipped, []);

  const calls = [];
  const status = runPreCommitGate({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m message' }
  }, (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, stdio: options.stdio });
    return { status: 0 };
  });

  assert.equal(status, 0);
  assert.deepEqual(calls.map(call => call.args), [['ci'], ['test']]);
  assert.deepEqual(calls.map(call => call.cwd), [repo, repo]);
  assert.deepEqual(calls.map(call => call.stdio), ['inherit', 'inherit']);
});

test('pre-commit gate stops after the first failing npm command', () => {
  const calls = [];
  const status = runPreCommitGate({
    tool_name: 'Bash',
    tool_input: { command: 'git commit' }
  }, (_command, args) => {
    calls.push(args);
    return { status: 7 };
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, [['ci']]);
});
