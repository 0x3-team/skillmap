import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createAndRecordFeedback,
  createRouteEvent,
  maintainRouteEventLedger,
  readRouteEvent,
  readRouteEvents,
  readRouteFeedbackBacklog,
  rebuildRouteEventIndex,
  recordRouteEvent
} from '../dist/core/route-events.js';

test('feedback backlog reports bounded reviewed and pending route receipts without free text', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-feedback-backlog-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const reviewed = routeEvent();
  const pending = routeEvent();
  await recordRouteEvent(cwd, reviewed);
  await recordRouteEvent(cwd, pending);
  await createAndRecordFeedback(cwd, {
    routeId: reviewed.routeId,
    outcome: 'wrong',
    reasonCode: 'operator-wrong',
    idempotencyKey: 'feedback-backlog-reviewed-1'
  });
  const backlog = await readRouteFeedbackBacklog(cwd, [reviewed, pending]);
  assert.deepEqual(backlog, {
    reviewedRoutes: 1,
    pendingRoutes: 1,
    recordedFeedback: 1,
    outcomeCounts: { correct: 0, wrong: 1, missing: 0, unsafe: 0 },
    pendingRouteIds: [pending.routeId]
  });
  assert.equal(JSON.stringify(backlog).includes('feedback-backlog-reviewed-1'), false);
  await assert.rejects(readRouteFeedbackBacklog(cwd, Array.from({ length: 101 }, () => pending)), /at most 100/);
});

const SHA = `sha256:${'a'.repeat(64)}`;
const REVISION = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000002',
  workspaceRevision: SHA,
  effectiveDigest: SHA,
  effectiveRevisionDigest: SHA
};

function routeResult(routeId, createdAt = new Date().toISOString(), extra = {}) {
  return {
    kind: 'skillmap.route-result',
    schemaVersion: 2,
    routeId,
    createdAt,
    promptStored: false,
    decision: {
      kind: 'skillmap.route-decision',
      schemaVersion: 2,
      revision: REVISION,
      servingMode: 'current',
      recommendations: [{ skillId: `sk_${'A'.repeat(43)}`, displayName: 'alpha', score: 1, tier: 'specialist', reasonCodes: ['name-match'] }],
      exclusions: [],
      hookText: 'SkillMap: prefer alpha.',
      warningState: 'none',
      warningCodes: []
    },
    decisionDigest: SHA,
    latencyMs: 2,
    ...extra
  };
}

function routeEvent(routeId = randomUUID(), createdAt = new Date().toISOString(), extra = {}) {
  return createRouteEvent(routeResult(routeId, createdAt, extra), REVISION, 'api');
}

function filesUnder(root) {
  if (!existsSync(root)) return [];
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  return result.sort();
}

test('single route lookup validates routeId and returns only the retained canonical redacted event', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-detail-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = routeEvent();
  await recordRouteEvent(cwd, event);

  const detail = await readRouteEvent(cwd, event.routeId);
  assert.deepEqual(detail, event);
  assert.equal(detail.promptStored, false);
  assert.equal(Object.hasOwn(detail, 'prompt'), false);
  assert.equal(Object.hasOwn(detail, 'hookText'), false);

  await assert.rejects(readRouteEvent(cwd, 'not-a-route-id'), error => error?.code === 'ROUTE_EVENT_ID_INVALID');
  await assert.rejects(readRouteEvent(cwd, randomUUID()), error => error?.code === 'ROUTE_EVENT_NOT_FOUND');
});

test('feedback binds the public routeId to its independently identified redacted event', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-events-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const routeId = randomUUID();
  const result = {
    kind: 'skillmap.route-result',
    schemaVersion: 2,
    routeId,
    createdAt: '2026-07-10T12:00:00.000Z',
    promptStored: false,
    decision: {
      kind: 'skillmap.route-decision',
      schemaVersion: 2,
      revision: REVISION,
      servingMode: 'current',
      recommendations: [{ skillId: `sk_${'A'.repeat(43)}`, displayName: 'alpha', score: 1, tier: 'specialist', reasonCodes: ['name-match'] }],
      exclusions: [],
      hookText: 'SkillMap: prefer alpha.',
      warningState: 'none',
      warningCodes: []
    },
    decisionDigest: SHA,
    latencyMs: 2
  };
  const event = createRouteEvent(result, REVISION, 'api');
  assert.equal(event.routeId, routeId);
  assert.notEqual(event.eventId, routeId);
  await recordRouteEvent(cwd, event);

  const feedback = await createAndRecordFeedback(cwd, {
    routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'feedback-route-binding-1'
  });
  assert.equal(feedback.routeId, routeId);
  assert.equal(feedback.revision.revisionId, REVISION.revisionId);
  assert.deepEqual(feedback.selectedSkillIds, [`sk_${'A'.repeat(43)}`]);

  const page = await readRouteEvents(cwd);
  assert.equal(page.events[0].routeId, routeId);
  const [publicFile] = filesUnder(path.join(cwd, '.skillmap', 'events', 'feedback')).filter((file) => file.endsWith(`${path.sep}correct.json`));
  assert.ok(publicFile);
  const persisted = readFileSync(publicFile, 'utf8');
  assert.equal(persisted.includes('private prompt canary'), false);

  const matchingRetry = await createAndRecordFeedback(cwd, {
    routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'feedback-route-binding-1'
  });
  assert.equal(matchingRetry.feedbackId, feedback.feedbackId);

  rmSync(publicFile);
  const reconciled = await createAndRecordFeedback(cwd, {
    routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'feedback-route-binding-1'
  });
  assert.notEqual(reconciled.feedbackId, feedback.feedbackId, 'removing the one durable receipt removes its idempotency identity');
  assert.equal(existsSync(publicFile), true, 'the durable transaction must recreate a missing public record');

  await assert.rejects(
    createAndRecordFeedback(cwd, {
      routeId,
      outcome: 'wrong',
      reasonCode: 'operator-wrong',
      idempotencyKey: 'feedback-route-binding-1'
    }),
    /different request/
  );
});

test('route ledger enforces a bounded retained record set and removes pruned route indexes', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-cap-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  const events = Array.from({ length: 5 }, () => routeEvent(randomUUID(), now.toISOString()));
  for (const event of events) await recordRouteEvent(cwd, event);

  const maintenance = await maintainRouteEventLedger(cwd, { now, maxRecords: 3 });
  assert.equal(maintenance.retainedRecords, 3);
  assert.equal(maintenance.prunedRecords, 2);
  assert.equal(maintenance.truncated, false);

  const page = await readRouteEvents(cwd, { now, maxRecords: 3, limit: 3 });
  assert.equal(page.total, 3);
  assert.equal(page.events.length, 3);
  const retained = new Set(page.events.map((event) => event.routeId));
  const pruned = events.find((event) => !retained.has(event.routeId));
  assert.ok(pruned);
  await assert.rejects(
    createAndRecordFeedback(cwd, {
      routeId: pruned.routeId,
      outcome: 'correct',
      reasonCode: 'operator-correct',
      idempotencyKey: 'pruned-route-feedback'
    }, { now, maxRecords: 3 }),
    /retained ledger/
  );
});

test('write-time admission bounds no-read route and feedback growth and prunes receipts with their route', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-write-cap-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  const events = Array.from({ length: 8 }, () => routeEvent(randomUUID(), now.toISOString()));
  for (const [index, event] of events.entries()) {
    await recordRouteEvent(cwd, event, { now, maxRecords: 3 });
    for (const outcome of ['correct', 'wrong', 'missing', 'unsafe']) {
      await createAndRecordFeedback(cwd, {
        routeId: event.routeId,
        outcome,
        reasonCode: `operator-${outcome}`,
        idempotencyKey: `bounded-${index}-${outcome}`
      }, { now, maxRecords: 3 });
    }
  }
  const page = await readRouteEvents(cwd, { now, maxRecords: 3, limit: 10 });
  assert.equal(page.total, 3);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'routes')).filter((file) => file.endsWith('.json')).length, 3);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'route-index')).filter((file) => file.endsWith('.json')).length, 3);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'feedback')).filter((file) => file.endsWith('.json')).length, 12);
  const retained = new Set(page.events.map((event) => event.routeId));
  assert.equal(events.filter((event) => retained.has(event.routeId)).length, 3);

  const retainedEvent = page.events[0];
  await assert.rejects(createAndRecordFeedback(cwd, {
    routeId: retainedEvent.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'arbitrary-new-key-cannot-grow-storage'
  }, { now, maxRecords: 3 }), /already been recorded/);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'feedback')).filter((file) => file.endsWith('.json')).length, 12);
});

test('write-time admission rejects expired and future-skewed route events', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-clock-boundary-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date('2026-07-10T12:00:00.000Z');
  await assert.rejects(
    recordRouteEvent(cwd, routeEvent(randomUUID(), new Date(now.getTime() - 91 * 86_400_000).toISOString()), { now }),
    /outside the bounded retention window/
  );
  await assert.rejects(
    recordRouteEvent(cwd, routeEvent(randomUUID(), new Date(now.getTime() + 6 * 60_000).toISOString()), { now }),
    /too far in the future/
  );
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events')).filter((file) => file.endsWith('.json')).length, 0);
});

test('route, index, and feedback writers reject deep symlink escapes before persisting outside the workspace', async (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), 'skillmap-route-symlink-boundary-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const outside = path.join(parent, 'outside');
  mkdirSync(outside);

  const routeCwd = path.join(parent, 'route-workspace');
  const route = routeEvent();
  const routeDay = route.createdAt.slice(0, 10);
  mkdirSync(path.join(routeCwd, '.skillmap', 'events', 'routes'), { recursive: true });
  symlinkSync(outside, path.join(routeCwd, '.skillmap', 'events', 'routes', routeDay), directoryLinkType());
  await assert.rejects(recordRouteEvent(routeCwd, route), /must not be symbolic links/);
  assert.deepEqual(readdirSync(outside), []);

  const indexCwd = path.join(parent, 'index-workspace');
  const indexed = routeEvent();
  mkdirSync(path.join(indexCwd, '.skillmap', 'events'), { recursive: true });
  symlinkSync(outside, path.join(indexCwd, '.skillmap', 'events', 'route-index'), directoryLinkType());
  await assert.rejects(recordRouteEvent(indexCwd, indexed), /must not be symbolic links/);
  assert.deepEqual(readdirSync(outside), []);

  const feedbackCwd = path.join(parent, 'feedback-workspace');
  const feedbackEvent = routeEvent();
  mkdirSync(feedbackCwd);
  await recordRouteEvent(feedbackCwd, feedbackEvent);
  const feedbackRoot = path.join(feedbackCwd, '.skillmap', 'events', 'feedback');
  mkdirSync(feedbackRoot, { recursive: true });
  symlinkSync(outside, path.join(feedbackRoot, 'v2'), directoryLinkType());
  await assert.rejects(createAndRecordFeedback(feedbackCwd, {
    routeId: feedbackEvent.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'symlink-boundary-1'
  }), /must not be symbolic links/);
  assert.deepEqual(readdirSync(outside), []);
});

function directoryLinkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

test('route partitions fail closed after their explicit directory scan cap', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-partition-cap-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  for (let index = 0; index < 4; index += 1) await recordRouteEvent(cwd, routeEvent(randomUUID(), now.toISOString()));
  await assert.rejects(
    readRouteEvents(cwd, { now, maxRecords: 10, maxFilesPerPartition: 3 }),
    /partition exceeds its bounded record limit/
  );
});

test('a corrupt routeId index is repaired from a bounded historical partition scan', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-index-repair-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = routeEvent();
  await recordRouteEvent(cwd, event);
  const indexRoot = path.join(cwd, '.skillmap', 'events', 'route-index');
  const [primary] = filesUnder(indexRoot).filter((file) => file.endsWith('.json'));
  assert.ok(primary);
  writeFileSync(primary, '{"prompt":"CANARY_PRIVATE_PROMPT","path":"/private/operator/path"}\n', 'utf8');

  const detail = await readRouteEvent(cwd, event.routeId);
  assert.equal(detail.payloadDigest, event.payloadDigest);

  const feedback = await createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'index-repair-feedback'
  });
  assert.equal(feedback.routeId, event.routeId);

  const indexFiles = filesUnder(indexRoot).filter((file) => file.endsWith('.json'));
  assert.equal(indexFiles.length, 1, 'the corrupt primary anchor is removed after a valid deterministic repair exists');
  const persisted = readFileSync(indexFiles[0], 'utf8');
  assert.equal(persisted.includes('CANARY_PRIVATE_PROMPT'), false);
  assert.equal(persisted.includes('/private/operator/path'), false);
  assert.equal(persisted.includes(cwd), false);
});

test('an index-only route is rejected as feedback authority and its derived anchors are removed', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-index-only-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = routeEvent();
  await recordRouteEvent(cwd, event);
  const publicFile = filesUnder(path.join(cwd, '.skillmap', 'events', 'routes')).find((file) => file.endsWith(`${event.eventId}.json`));
  assert.ok(publicFile);
  unlinkSync(publicFile);

  await assert.rejects(readRouteEvent(cwd, event.routeId), error => error?.code === 'ROUTE_EVENT_NOT_FOUND');

  await assert.rejects(createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'index-only-feedback'
  }), /retained ledger/);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'route-index')).filter((file) => file.endsWith('.json')).length, 0);
});

test('legacy public event files remain readable through bounded lazy index migration', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-legacy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = routeEvent();
  const day = event.createdAt.slice(0, 10);
  const dir = path.join(cwd, '.skillmap', 'events', 'routes', day);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, `${event.eventId}.json`), `${JSON.stringify(event, null, 2)}\n`, { mode: 0o600 });
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'route-index')).length, 0);

  const detail = await readRouteEvent(cwd, event.routeId);
  assert.equal(detail.payloadDigest, event.payloadDigest);

  const feedback = await createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'legacy-index-feedback'
  });
  assert.equal(feedback.routeId, event.routeId);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'route-index')).filter((file) => file.endsWith('.json')).length, 1);
});

test('an interrupted public-first write leaves a bounded-rebuildable event instead of an orphan index', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-interrupted-index-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = routeEvent();
  const eventsRoot = path.join(cwd, '.skillmap', 'events');
  mkdirSync(eventsRoot, { recursive: true, mode: 0o700 });
  const blockedIndexRoot = path.join(eventsRoot, 'route-index');
  writeFileSync(blockedIndexRoot, 'failpoint\n', { mode: 0o600 });

  await assert.rejects(recordRouteEvent(cwd, event));
  const publicFiles = filesUnder(path.join(eventsRoot, 'routes')).filter((file) => file.endsWith('.json'));
  assert.equal(publicFiles.length, 1, 'the redacted public event remains available to bounded migration');
  assert.equal(publicFiles[0].endsWith(`${event.eventId}.json`), true);
  assert.equal(readFileSync(blockedIndexRoot, 'utf8'), 'failpoint\n', 'a failed index write cannot replace the blocker with an index-only anchor');

  unlinkSync(blockedIndexRoot);
  const feedback = await createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'interrupted-index-feedback'
  });
  assert.equal(feedback.routeId, event.routeId);
  assert.equal(filesUnder(path.join(eventsRoot, 'route-index')).filter((file) => file.endsWith('.json')).length, 1);
});

test('retention removes expired partitions and prevents expired index lookup', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-retention-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  const expiredAt = new Date(now.getTime() - 100 * 86_400_000).toISOString();
  const expired = routeEvent(randomUUID(), expiredAt);
  const current = routeEvent(randomUUID(), now.toISOString());
  await recordRouteEvent(cwd, expired, { now: new Date(expiredAt) });
  await createAndRecordFeedback(cwd, {
    routeId: expired.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'historical-feedback-1'
  }, { now: new Date(expiredAt) });

  const maintenance = await maintainRouteEventLedger(cwd, { now, retentionDays: 30, maxPartitions: 30 });
  assert.equal(maintenance.prunedRecords, 1);
  assert.equal(maintenance.prunedPartitions, 1);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'feedback')).filter((file) => file.endsWith('.json')).length, 0);
  await recordRouteEvent(cwd, current, { now, retentionDays: 30, maxPartitions: 30 });
  const page = await readRouteEvents(cwd, { now, retentionDays: 30, maxPartitions: 30 });
  assert.deepEqual(page.events.map((event) => event.routeId), [current.routeId]);
  await assert.rejects(
    createAndRecordFeedback(cwd, {
      routeId: expired.routeId,
      outcome: 'correct',
      reasonCode: 'operator-correct',
      idempotencyKey: 'expired-route-feedback'
    }, { now, retentionDays: 30, maxPartitions: 30 }),
    /retained ledger/
  );
});

test('route pagination is stable for one corpus and rejects a cursor after a new event', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-pagination-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  for (let index = 0; index < 5; index += 1) await recordRouteEvent(cwd, routeEvent(randomUUID(), now.toISOString()));

  const first = await readRouteEvents(cwd, { now, maxRecords: 10, limit: 2 });
  assert.equal(first.events.length, 2);
  assert.ok(first.nextCursor);
  const second = await readRouteEvents(cwd, { now, maxRecords: 10, limit: 2, cursor: first.nextCursor });
  const third = await readRouteEvents(cwd, { now, maxRecords: 10, limit: 2, cursor: second.nextCursor });
  assert.equal(new Set([...first.events, ...second.events, ...third.events].map((event) => event.routeId)).size, 5);
  assert.equal(third.nextCursor, null);

  await recordRouteEvent(cwd, routeEvent(randomUUID(), now.toISOString()));
  await assert.rejects(
    readRouteEvents(cwd, { now, maxRecords: 10, limit: 2, cursor: first.nextCursor }),
    /cursor is stale/
  );
});

test('same-day activity is ordered newest-first by recorded timestamp instead of random event UUID', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-chronology-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date('2026-07-10T12:00:00.000Z');
  const timestamps = [
    '2026-07-10T09:00:00.000Z',
    '2026-07-10T11:00:00.000Z',
    '2026-07-10T10:00:00.000Z'
  ];
  for (const createdAt of timestamps) await recordRouteEvent(cwd, routeEvent(randomUUID(), createdAt), { now });
  const page = await readRouteEvents(cwd, { now, limit: 10 });
  assert.deepEqual(page.events.map((event) => event.createdAt), [...timestamps].sort().reverse());
});

test('concurrent event writes and bounded index rebuilds converge without duplicate anchors', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-concurrency-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const now = new Date();
  const events = Array.from({ length: 24 }, () => routeEvent(randomUUID(), now.toISOString()));
  await Promise.all(events.map((event) => recordRouteEvent(cwd, event)));
  rmSync(path.join(cwd, '.skillmap', 'events', 'route-index'), { recursive: true, force: true });

  const rebuilt = await Promise.all(Array.from({ length: 4 }, () => rebuildRouteEventIndex(cwd, { now, maxRecords: 100 })));
  assert.equal(rebuilt.every((result) => result.scannedRecords === 24 && result.invalidRecords === 0), true);
  const page = await readRouteEvents(cwd, { now, maxRecords: 100, limit: 100 });
  assert.equal(page.total, 24);
  assert.equal(new Set(page.events.map((event) => event.routeId)).size, 24);
  assert.equal(filesUnder(path.join(cwd, '.skillmap', 'events', 'route-index')).filter((file) => file.endsWith('.json')).length, 24);
});

test('route, index, and feedback persistence exclude prompt, path, and free-comment canaries', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-route-privacy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const canaryPrompt = 'CANARY_PRIVATE_PROMPT_7812';
  const canaryPath = '/Users/operator/private/skills/secret.md';
  const canaryComment = 'free form comment must never persist';
  const event = routeEvent(randomUUID(), new Date().toISOString(), { prompt: canaryPrompt, localPath: canaryPath, comment: canaryComment });
  await recordRouteEvent(cwd, event);
  await assert.rejects(createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: canaryPrompt,
    idempotencyKey: 'privacy-reason-canary'
  }), /reasonCode must be operator-correct/);
  await assert.rejects(createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'wrong',
    reasonCode: 'operator-wrong',
    idempotencyKey: 'privacy-selected-canary',
    selectedSkillIds: [`sk_${'B'.repeat(43)}`]
  }), /must exactly match/);
  await assert.rejects(createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'missing',
    reasonCode: 'operator-missing',
    idempotencyKey: 'privacy-expected-canary',
    expectedSkillIds: [`sk_${'B'.repeat(43)}`]
  }));
  await createAndRecordFeedback(cwd, {
    routeId: event.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'sk_live_SECRET',
    comment: canaryComment
  });

  const persisted = filesUnder(path.join(cwd, '.skillmap', 'events')).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.equal(persisted.includes(canaryPrompt), false);
  assert.equal(persisted.includes(canaryPath), false);
  assert.equal(persisted.includes(canaryComment), false);
  assert.equal(persisted.includes('sk_live_SECRET'), false);
  assert.equal(persisted.includes(`sk_${'B'.repeat(43)}`), false);
  assert.equal(persisted.includes(cwd), false);
  assert.match(persisted, /"promptStored": false/);
  assert.match(persisted, /"commentStored": false/);
});
