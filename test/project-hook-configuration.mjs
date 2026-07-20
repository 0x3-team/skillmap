import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isDirectGitCommitCommand,
  MAX_HOOK_INPUT_BYTES,
  readBoundedHookInput,
  runPreCommitGate,
  shouldRunPreCommitGate
} from '../scripts/hooks/pre-commit-gate.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repo, relativePath), 'utf8'));
}

test('Claude and Codex project hooks match Bash and delegate command filtering', () => {
  const expectedCommand = 'node "${CLAUDE_PROJECT_DIR:-.}/scripts/hooks/pre-commit-gate.mjs"';
  for (const relativePath of ['.claude/settings.json', '.codex/hooks.json']) {
    const config = readJson(relativePath);
    const entry = config.hooks.PreToolUse[0];
    assert.equal(entry.matcher, 'Bash');
    assert.equal(entry.hooks.length, 1);
    assert.equal(entry.hooks[0].type, 'command');
    assert.equal(entry.hooks[0].command, expectedCommand);
    assert.equal(entry.hooks[0].timeout, 390);
    const stop = config.hooks.Stop[0].hooks[0];
    assert.equal(stop.command, 'cd -- "${CLAUDE_PROJECT_DIR:-.}" && chunk validate');
    assert.equal(stop.timeout, 600);
  }
});

test('pre-commit gate recognizes only a direct git commit Bash command', () => {
  assert.equal(isDirectGitCommitCommand('git commit -m "message"'), true);
  assert.equal(isDirectGitCommitCommand('  git   commit --amend'), true);
  assert.equal(isDirectGitCommitCommand('git status'), false);
  assert.equal(isDirectGitCommitCommand('git\ncommit -m message'), false);
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

test('pre-commit gate skips non-commit commands and runs npm test once', () => {
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
  assert.deepEqual(calls.map(call => call.args), [['test']]);
  assert.deepEqual(calls.map(call => call.cwd), [repo]);
  assert.deepEqual(calls.map(call => call.stdio), ['inherit']);
});

test('pre-commit gate returns the npm test failure status', () => {
  const calls = [];
  const status = runPreCommitGate({
    tool_name: 'Bash',
    tool_input: { command: 'git commit' }
  }, (_command, args) => {
    calls.push(args);
    return { status: 7 };
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, [['test']]);
});

test('hook input is parsed from bounded streamed chunks', async () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'git commit' } };
  const encoded = JSON.stringify(input);
  const parsed = await readBoundedHookInput(Readable.from([
    encoded.slice(0, 12),
    encoded.slice(12)
  ]));
  assert.deepEqual(parsed, input);
});

test('hook input rejects streamed data beyond 64 KiB before retaining it', async () => {
  await assert.rejects(
    readBoundedHookInput(Readable.from([
      Buffer.alloc(MAX_HOOK_INPUT_BYTES),
      Buffer.from('x')
    ])),
    /hook input exceeds the 64 KiB limit/
  );
});

test('hook input reports an injected custom byte limit accurately', async () => {
  await assert.rejects(
    readBoundedHookInput(Readable.from(['12345']), 4),
    /hook input exceeds the 4 bytes limit/
  );
});
