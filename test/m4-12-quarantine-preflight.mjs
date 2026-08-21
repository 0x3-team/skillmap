import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LOCAL_QUARANTINE_OUTCOMES } from '../dist/contracts/local-quarantine-registry.js';
import {
  assertSameVolume,
  establishRootCapability,
  preflightQuarantine
} from '../dist/core/quarantine-preflight.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-quarantine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const quarantine = path.join(root, 'quarantine');
  await mkdir(path.join(source, 'skill-a'), { recursive: true });
  await mkdir(quarantine);
  await writeFile(path.join(source, 'skill-a', 'SKILL.md'), '# Skill A\n', 'utf8');
  const sourceCapability = await establishRootCapability({
    rootId: 'source-root-a',
    configuredPath: source,
    fixtureClass: 'synthetic_fixture',
    policyVersion: 'm4-test-v1'
  });
  const quarantineCapability = await establishRootCapability({
    rootId: 'quarantine-root-a',
    configuredPath: quarantine,
    fixtureClass: 'synthetic_fixture',
    policyVersion: 'm4-test-v1'
  });
  return { root, source, quarantine, sourceCapability, quarantineCapability };
}

function input(state, candidates = ['skill-a']) {
  return {
    sourceRoot: state.sourceCapability,
    quarantineRoot: state.quarantineCapability,
    candidates,
    operationId: 'op-0123456789abcdef',
    reservationNonce: 'nonce-0123456789abcdef',
    dateUtc: '2026-08-20',
    atomicMoveAvailable: true
  };
}

test('preflight accepts exactly one contained candidate without filesystem mutation', async (t) => {
  const state = await fixture(t);
  const before = await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8');
  const result = await preflightQuarantine(input(state));
  assert.equal(result.ok, true);
  assert.equal(result.reservation.collisionCandidateIndex, 0);
  assert.equal(result.reservation.collisionCandidateCount, 100);
  assert.match(result.reservation.destinationIdentityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.preflightDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), before);
  await assert.rejects(lstat(result.destinationPath), { code: 'ENOENT' });
});

test('preflight denies zero or multiple candidates before touching paths', async (t) => {
  const state = await fixture(t);
  assert.deepEqual(await preflightQuarantine(input(state, [])), {
    ok: false,
    outcome: LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_CARDINALITY_DENIED
  });
  assert.deepEqual(await preflightQuarantine(input(state, ['skill-a', 'missing'])), {
    ok: false,
    outcome: LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_CARDINALITY_DENIED
  });
});

test('preflight rejects traversal and symlinked path components', async (t) => {
  const state = await fixture(t);
  await assert.rejects(preflightQuarantine(input(state, ['../outside'])), /relative path/i);
  await symlink(path.join(state.source, 'skill-a'), path.join(state.source, 'alias'));
  await assert.rejects(preflightQuarantine(input(state, ['alias'])), /symbolic link/i);
});

test('preflight checks exactly unsuffixed then .1 through .99 and fails closed when occupied', async (t) => {
  const state = await fixture(t);
  const first = await preflightQuarantine(input(state));
  assert.equal(first.ok, true);
  await mkdir(path.dirname(first.destinationPath), { recursive: true });
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? first.destinationPath : `${first.destinationPath}.${index}`;
    await writeFile(candidate, `occupied-${index}`, 'utf8');
  }
  assert.deepEqual(await preflightQuarantine(input(state)), {
    ok: false,
    outcome: LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED
  });
  assert.equal(await readFile(`${first.destinationPath}.99`, 'utf8'), 'occupied-99');
});

test('same-volume and atomic primitive failures use exact closed outcomes', () => {
  assert.equal(assertSameVolume(41, 41), undefined);
  assert.deepEqual(assertSameVolume(41, 42), LOCAL_QUARANTINE_OUTCOMES.CROSS_VOLUME_NOT_ATOMIC);
});

test('preflight denies an unavailable no-replace primitive before mutation', async (t) => {
  const state = await fixture(t);
  assert.deepEqual(await preflightQuarantine({ ...input(state), atomicMoveAvailable: false }), {
    ok: false,
    outcome: LOCAL_QUARANTINE_OUTCOMES.ATOMIC_MOVE_UNSUPPORTED
  });
});
