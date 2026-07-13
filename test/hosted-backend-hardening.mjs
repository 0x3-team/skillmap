import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { computeGithubSnapshotManifestDigest } from '../dist/network/github-source-fetcher.js';
import {
  auditHostedSkillSnapshot,
  createHostedDeclaredCompatibilityReceiptDigest,
  gradeHostedSkill
} from '../dist/hosted/audit-grade.js';
import { buildOperatorReceiptPayloads } from '../apps/worker/src/operator-receipts.mjs';
import { createSupabaseRpcClient } from '../apps/worker/src/supabase-rpc.mjs';

const COMMIT = 'a'.repeat(40);
const SECRET = `service-role-${'x'.repeat(48)}`;

test('malformed frontmatter produces a persistable blocked adapter shape with no compatibility digest', () => {
  const audit = auditHostedSkillSnapshot(snapshot({
    'SKILL.md': '---\nname: malformed\ndescription: Use for a bounded malformed-fixture review.\n# Missing frontmatter terminator\n',
    LICENSE: 'MIT License\n'
  }), {
    sourcePath: 'SKILL.md',
    license: { state: 'confirmed', spdxExpression: 'MIT' }
  });
  assert.equal(audit.state, 'blocked');
  assert.equal(audit.compatibility.state, 'blocked');
  const grade = gradeHostedSkill({
    normalizedPackageDigest: audit.subject.normalizedEvaluationDigest,
    auditReceipt: audit,
    hostProfileVersion: 'codex-host/v1'
  });
  assert.equal(grade.state, 'blocked');
  const payloads = buildOperatorReceiptPayloads({
    auditReceipt: audit,
    gradeEvaluation: grade,
    compatibilityReceiptDigest: null,
    workerVersion: 'skillmap-worker/0.1.0'
  });
  assert.equal(payloads.grade.state, 'blocked');
  assert.equal(payloads.grade.compatibilityEvidenceDigest, null);
  assert.deepEqual(
    payloads.grade.hardGates.find(gate => gate.code === 'compatibility-evidence-bound'),
    { code: 'compatibility-evidence-bound', passed: false, evidenceDigest: null }
  );
});

test('provisional adapter output remains bound to a non-null compatibility digest', () => {
  const audit = auditHostedSkillSnapshot(snapshot({
    'SKILL.md': '---\nname: focused-review\ndescription: Use for reviewing a bounded implementation against explicit evidence.\n---\nInspect the requested files and report evidence.\n',
    LICENSE: 'MIT License\n'
  }), {
    sourcePath: 'SKILL.md',
    license: { state: 'confirmed', spdxExpression: 'MIT' }
  });
  const compatibilityReceiptDigest = createHostedDeclaredCompatibilityReceiptDigest(audit, 'codex-host/v1');
  const grade = gradeHostedSkill({
    normalizedPackageDigest: audit.subject.normalizedEvaluationDigest,
    auditReceipt: audit,
    compatibilityReceiptDigest,
    hostProfileVersion: 'codex-host/v1'
  });
  const payloads = buildOperatorReceiptPayloads({
    auditReceipt: audit,
    gradeEvaluation: grade,
    compatibilityReceiptDigest,
    workerVersion: 'skillmap-worker/0.1.0'
  });
  assert.equal(payloads.grade.state, 'provisional');
  assert.match(payloads.grade.compatibilityEvidenceDigest, /^sha256:[0-9a-f]{64}$/);
});

test('backend recovery and collision operator commands require explicit authority', () => {
  for (const [script, helpPattern] of [
    ['apps/worker/src/dead-letter.mjs', /expired max-attempt processing claim/i],
    ['apps/worker/src/collision-list.mjs', /completion-time and current-catalog collision evidence/i],
    ['apps/worker/src/collision-review.mjs', /immutable disposition/i]
  ]) {
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, helpPattern);
    const refused = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /without the explicit --execute flag|submission-id is required/i);
    assert.doesNotMatch(refused.stdout + refused.stderr, /PRIVATE-CANARY/);
  }
});

test('operator RPC client allowlists the recovery and collision boundary without reflecting secrets', async () => {
  const observed = [];
  const client = createSupabaseRpcClient({
    url: 'http://127.0.0.1:54321',
    serviceRoleKey: SECRET,
    fetchImpl: async (url, options) => {
      observed.push({ url: url.toString(), body: JSON.parse(options.body) });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  for (const [name, parameters] of [
    ['dead_letter_expired_skill_submission', { p_submission_id: `sub_${'a'.repeat(32)}`, p_idempotency_digest: digest('dead') }],
    ['list_skill_submission_collisions', { p_submission_id: `sub_${'b'.repeat(32)}` }],
    ['review_skill_submission_collisions', {
      p_submission_id: `sub_${'c'.repeat(32)}`,
      p_disposition: 'approved-distinct',
      p_reason_code: 'manual-source-review',
      p_idempotency_digest: digest('review')
    }]
  ]) await client.call(name, parameters);
  assert.deepEqual(observed.map(item => item.url.split('/').at(-1)), [
    'dead_letter_expired_skill_submission',
    'list_skill_submission_collisions',
    'review_skill_submission_collisions'
  ]);
  assert.equal(JSON.stringify(observed).includes(SECRET), false);
});

function snapshot(files) {
  const entries = [];
  const snapshots = [];
  let totalBytes = 0;
  for (const [path, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const bytes = Buffer.from(content);
    const contentDigest = digest(bytes);
    totalBytes += bytes.length;
    entries.push({ path, type: 'file', mode: '100644', size: bytes.length, blobDigest: `git:${'b'.repeat(40)}`, contentDigest });
    snapshots.push({ path, mode: '100644', size: bytes.length, blobDigest: `git:${'b'.repeat(40)}`, contentDigest, bytes: new Uint8Array(bytes) });
  }
  const value = {
    version: 1,
    provider: 'github',
    repository: 'example/skills',
    requestedRef: COMMIT,
    resolvedCommit: COMMIT,
    subtree: '.',
    rootTreeDigest: `git:${'c'.repeat(40)}`,
    manifestDigest: '',
    totalBytes,
    entries,
    files: snapshots
  };
  value.manifestDigest = computeGithubSnapshotManifestDigest(value);
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
