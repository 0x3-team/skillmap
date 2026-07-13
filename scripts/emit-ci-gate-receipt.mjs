#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const CONTEXT = /^[A-Za-z0-9._:/-]{1,160}$/;
const GATE_KINDS = new Set(['static-preflight', 'database-recovery']);

export function parseArguments(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    assert.ok(argument === '--kind' || argument === '--receipt', `Unknown argument: ${argument}`);
    assert.equal(values[argument], undefined, `${argument} may be supplied only once`);
    assert.ok(index + 1 < argv.length, `${argument} requires a value`);
    values[argument] = argv[index + 1];
    index += 1;
  }
  assert.equal(GATE_KINDS.has(values['--kind']), true, '--kind is invalid');
  assert.ok(values['--receipt'], '--receipt is required');
  return { kind: values['--kind'], receipt: values['--receipt'] };
}

export function buildRetainedGateReceipt({ kind, receiptBytes, environment = process.env }) {
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'gate receipt must be one JSON object');
  const receiptCommit = receipt.candidate?.commit ?? receipt.sourceCommit;
  const receiptTree = receipt.candidate?.tree ?? receipt.sourceTree;
  assert.match(receiptCommit ?? '', SHA, 'gate receipt omits an exact source commit');
  assert.match(receiptTree ?? '', SHA, 'gate receipt omits an exact source tree');
  assert.match(environment.GITHUB_SHA ?? '', SHA, 'GITHUB_SHA must identify the exact CI commit');
  assert.equal(receiptCommit, environment.GITHUB_SHA, 'gate receipt commit does not match the CI commit');
  assert.match(environment.GITHUB_RUN_ID ?? '', CONTEXT, 'GITHUB_RUN_ID is missing or invalid');
  assert.match(environment.GITHUB_JOB ?? '', CONTEXT, 'GITHUB_JOB is missing or invalid');
  return {
    schemaVersion: 'skillmap-ci-retained-gate-receipt/v1',
    authority: 'gitea-actions',
    gate: kind,
    sourceCommit: receiptCommit,
    sourceTree: receiptTree,
    runId: environment.GITHUB_RUN_ID,
    job: environment.GITHUB_JOB,
    receiptSha256: `sha256:${createHash('sha256').update(receiptBytes).digest('hex')}`,
    receipt
  };
}

function readBoundedRegularFile(target) {
  const absolute = path.resolve(target);
  const descriptor = openSync(absolute, constants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = fstatSync(descriptor);
    assert.equal(stats.isFile(), true, 'gate receipt must be a regular file');
    assert.ok(stats.size > 0 && stats.size <= 1024 * 1024, 'gate receipt exceeds the one-megabyte log boundary');
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function main(argv) {
  const options = parseArguments(argv);
  const envelope = buildRetainedGateReceipt({
    kind: options.kind,
    receiptBytes: readBoundedRegularFile(options.receipt)
  });
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
