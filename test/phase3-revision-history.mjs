import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';

function workspace(t, prefix = 'skillmap-revision-history-') {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

async function revisionFixture(t) {
  const cwd = workspace(t);
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const initial = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  const store = WorkspaceStateStore.open(cwd);
  writeFileSync(path.join(cwd, '.skillmap', 'doctor.json'), '{"version":1,"generation":2}\n');
  const second = await store.publishLegacySnapshot({
    expectedRevisionId: initial.revision.revisionId,
    actor: 'history-reviewer',
    reason: 'PRIVATE_REASON_CANARY at /opt/private/history'
  });
  writeFileSync(path.join(cwd, '.skillmap', 'doctor.json'), '{"version":1,"generation":3}\n');
  const third = await store.publishLegacySnapshot({
    expectedRevisionId: second.pointer.revisionId,
    actor: 'private/path/actor',
    reason: 'SECOND_PRIVATE_REASON_CANARY at C:/private/history'
  });
  return { cwd, backend, store, initial: initial.revision, second, third };
}

test('verified revision history is bounded, cursor-paged, and redacts free-text mutation receipts', async (t) => {
  const fixture = await revisionFixture(t);
  const first = await fixture.backend.stateRevisions({ limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].revision.revisionId, fixture.third.pointer.revisionId);
  assert.equal(first.items[0].isCurrent, true);
  assert.equal(first.items[0].mutation.actor, null, 'unsafe historical actor must not cross the API projection');
  assert.match(first.items[0].mutation.reasonDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.hasMore, true);
  assert.equal(typeof first.nextCursor, 'string');
  const second = await fixture.backend.stateRevisions({ limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].revision.revisionId, fixture.initial.revisionId);
  assert.equal(second.hasMore, false);
  for (const value of [first, second]) {
    const text = JSON.stringify(value);
    assert.equal(text.includes('PRIVATE_REASON_CANARY'), false);
    assert.equal(text.includes('/opt/private/history'), false);
    assert.equal(text.includes('C:/private/history'), false);
    assert.equal(text.includes('private/path/actor'), false);
  }
  await assert.rejects(
    fixture.backend.stateRevisions({ limit: 2, cursor: `${first.nextCursor}tampered` }),
    (error) => error?.code === 'STATE_REVISION_CURSOR_INVALID'
  );
});

test('rollback accepts only a verified ancestor/current CAS and never silently grants routing approval', async (t) => {
  const fixture = await revisionFixture(t);
  const arbitrary = `r${'9'.repeat(20)}-99999999-9999-4999-8999-999999999999`;
  await assert.rejects(
    fixture.backend.rollbackState({ targetRevision: fixture.initial.revisionId, expectedRevision: fixture.third.pointer.revisionId, actor: 'local api with spaces', reason: '/private/operator/reason', confirm: true }),
    (error) => error?.code === 'STATE_ROLLBACK_RECEIPT_INVALID'
  );
  await assert.rejects(
    fixture.backend.rollbackState({ targetRevision: arbitrary, expectedRevision: fixture.third.pointer.revisionId, actor: 'rollback-reviewer', reason: 'verified-rollback', confirm: true }),
    (error) => error?.code === 'STATE_ROLLBACK_TARGET_NOT_ANCESTOR'
  );
  await assert.rejects(
    fixture.backend.rollbackState({ targetRevision: fixture.initial.revisionId, expectedRevision: fixture.second.pointer.revisionId, actor: 'rollback-reviewer', reason: 'verified-rollback', confirm: true }),
    (error) => error?.code === 'STATE_CONFLICT'
  );

  const attempts = await Promise.allSettled([
    fixture.backend.rollbackState({ targetRevision: fixture.initial.revisionId, expectedRevision: fixture.third.pointer.revisionId, actor: 'rollback-reviewer', reason: 'verified-rollback', confirm: true }),
    fixture.backend.rollbackState({ targetRevision: fixture.initial.revisionId, expectedRevision: fixture.third.pointer.revisionId, actor: 'rollback-reviewer', reason: 'verified-rollback', confirm: true })
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((item) => item.status === 'rejected' && item.reason?.code === 'STATE_CONFLICT').length, 1);
  const receipt = attempts.find((item) => item.status === 'fulfilled').value;
  assert.equal(receipt.state, 'rolled-back');
  assert.equal(receipt.targetRevisionId, fixture.initial.revisionId);
  assert.equal(receipt.routingApproved, false);
  assert.equal(receipt.routingApprovalRequired, true);
  const current = await fixture.store.readCurrent({ purpose: 'status' });
  assert.equal(current.currentPointer.revisionId, receipt.revision.revisionId);
  assert.equal(current.revision.manifest.mutation.kind, 'rollback');
  assert.equal(current.revision.manifest.mutation.targetRevisionId, fixture.initial.revisionId);
  await assert.rejects(fixture.store.readCurrent({ purpose: 'routing' }), (error) => /^STATE_ROUTING_/.test(error?.code ?? ''));
});

test('revision history rejects corrupt ancestor bytes instead of returning a partial trusted list', async (t) => {
  const fixture = await revisionFixture(t);
  writeFileSync(path.join(fixture.store.paths.revisions, fixture.initial.revisionId, 'manifest.json'), '{"tampered":true}\n');
  await assert.rejects(
    fixture.backend.stateRevisions({ limit: 100 }),
    (error) => /^STATE_REVISION_/.test(error?.code ?? '') || /manifest/i.test(error?.message ?? '')
  );
});
