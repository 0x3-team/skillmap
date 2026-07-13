import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('append-only submission authority migration binds publication and reclaim evidence', () => {
  const source = readFileSync('supabase/migrations/20260713050000_submission_authority_completion.sql', 'utf8');
  const operatorSource = readFileSync('supabase/migrations/20260712233000_hosted_operator_publication_authority.sql', 'utf8');
  for (const pattern of [
    /submission_publisher_authorization_receipts/,
    /publisher_authorization_revocation_tombstones/,
    /submission_license_evidence_receipts/,
    /publication requires current exact-source publisher authorization/,
    /publication requires exact-commit reviewed license evidence/,
    /authority_version = 2/,
    /publication identity does not match the exact approved update target/,
    /CLAIM_LEASE_EXPIRED/,
    /version_has_current_publisher_authorization/,
    /receipt\.expires_at > clock_timestamp\(\)/,
    /published authorization renewal must match the exact source publisher version/,
    /published authorization renewal requires an active non-revoked exact source version/,
    /publisher authorization revocation is terminal for the exact source/,
    /lock_exact_source_authority/,
    /pg_advisory_xact_lock/,
    /prior_row\.expires_at <= clock_timestamp\(\)/,
    /authorization_row\.expires_at <= clock_timestamp\(\)/,
    /jsonb_typeof\(item -> 'repositoryUrl'\) is distinct from 'string'/,
    /jsonb_typeof\(item -> 'sourceCommit'\) is distinct from 'string'/,
    /jsonb_typeof\(item -> 'path'\) is distinct from 'string'/,
    /jsonb_typeof\(item -> 'contentDigest'\) is distinct from 'string'/,
    /collision_subject_is_complete/,
    /total_matches <> jsonb_array_length/,
    /partial collision evidence cannot authorize publication/,
    /publication requires complete untruncated collision evidence/,
    /set publication_state = 'blocked'/,
    /force row level security/i,
    /grant execute on function api\.record_skill_submission_publisher_authorization[\s\S]+to service_role/i
  ]) assert.match(source, pattern);
  for (const pattern of [
    /valid_submission_audit_receipt\(p_audit_receipt, p_worker_version\) is not true/,
    /valid_submission_grade_receipt\(p_grade_receipt, p_audit_receipt\) is not true/,
    /jsonb_typeof\(check_row -> 'code'\) is distinct from 'string'/,
    /jsonb_typeof\(check_row -> 'outcome'\) is distinct from 'string'/,
    /jsonb_typeof\(check_row -> 'severity'\) is distinct from 'string'/,
    /jsonb_typeof\(gate_row -> 'evidenceDigest'\) = 'null'[\s\S]+sha256:/,
    /perform private\.lock_exact_source_authority\([\s\S]+if submission_row\.state = 'published'/,
    /publication replay no longer has current exact-source authority/,
    /skill_row\.current_version_id is distinct from version_row\.id/,
    /skill_row\.visibility_state <> 'public'[\s\S]+skill_row\.lifecycle_state not in \('published', 'deprecated'\)[\s\S]+skill_row\.revoked_at is not null/,
    /publisher_row\.catalog_state <> 'published'[\s\S]+publisher_row\.revoked_at is not null/,
    /repository_row\.catalog_state <> 'published'[\s\S]+repository_row\.revoked_at is not null/,
    /version_row\.source_commit is distinct from submission_row\.source_commit[\s\S]+version_row\.source_path is distinct from submission_row\.source_path/
  ]) assert.match(operatorSource, pattern);
  assert.doesNotMatch(source, /grant execute[\s\S]+to authenticated[\s\S]+record_skill_submission_(?:publisher_authorization|license_evidence)/i);
});

test('publisher authorization CLI is exposed through both operator package surfaces', () => {
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  const workerPackage = JSON.parse(readFileSync('apps/worker/package.json', 'utf8'));
  assert.equal(rootPackage.scripts['hosted:publisher:authorization'],
    'npm run build && node apps/worker/src/authorization.mjs');
  assert.equal(workerPackage.scripts['publisher:authorization'], 'node src/authorization.mjs');
  const readme = readFileSync('apps/worker/README.md', 'utf8');
  assert.match(readme, /20260713060000_operator_submission_read_plane\.sql/);
  assert.match(readme, /npm run hosted:publisher:authorization/);
  assert.match(readme, /renews an expired[\s\S]+exact still-published source version/i);
  assert.match(readme, /cannot be renewed/i);
  assert.match(readme, /terminal for the exact repository, commit,[\s\S]+across accounts and publisher handles/i);
  assert.match(readme, /--license-evidence-path LICENSE/);
  const runbook = readFileSync('docs/operations/free-public-alpha-runbook.md', 'utf8');
  assert.match(runbook, /20260713060000_operator_submission_read_plane\.sql/);
  assert.match(runbook, /claim-scoped exact license evidence/);
  assert.match(runbook, /current unexpired publisher authorization/);
  assert.match(runbook, /target-bound collision/);
  assert.match(runbook, /truncated: true[\s\S]+both fail closed/i);
  assert.match(runbook, /becomes visible again without a new submission/i);
  assert.match(runbook, /explicit revocation is terminal/i);
  assert.match(runbook, /tombstone survives submission\/account deletion/i);
  assert.match(runbook, /stale authorized replay fails/i);
});

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
    workerVersion: 'skillmap-worker/0.1.0',
    licenseReviewReference: `licref_${'1'.repeat(32)}`,
    licenseReviewEvidenceDigest: `sha256:${'9'.repeat(64)}`
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
    workerVersion: 'skillmap-worker/0.1.0',
    licenseReviewReference: `licref_${'1'.repeat(32)}`,
    licenseReviewEvidenceDigest: `sha256:${'9'.repeat(64)}`
  });
  assert.equal(payloads.grade.state, 'provisional');
  assert.match(payloads.grade.compatibilityEvidenceDigest, /^sha256:[0-9a-f]{64}$/);
});

test('backend recovery and collision operator commands require explicit authority', () => {
  for (const [script, helpPattern] of [
    ['apps/worker/src/dead-letter.mjs', /expired max-attempt processing claim/i],
    ['apps/worker/src/collision-list.mjs', /completion-time and current-catalog collision evidence/i],
    ['apps/worker/src/collision-review.mjs', /immutable disposition/i],
    ['apps/worker/src/authorization.mjs', /redacted.*publisher authorization/i]
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
  const authorizationHelp = spawnSync(process.execPath, [
    'apps/worker/src/authorization.mjs', '--help'
  ], { encoding: 'utf8' });
  assert.equal(authorizationHelp.status, 0, authorizationHelp.stderr);
  assert.match(authorizationHelp.stdout, /renews an expired or expiring exact published source version/i);
  assert.match(authorizationHelp.stdout, /Revocation is terminal[\s\S]+across accounts and publisher handles/i);
});

test('operator RPC client allowlists mutation and read-plane boundaries without reflecting secrets', async () => {
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
      p_target_publisher_id: null,
      p_target_skill_id: null,
      p_target_version_id: null,
      p_idempotency_digest: digest('review')
    }],
    ['record_skill_submission_publisher_authorization', {
      p_submission_id: `sub_${'d'.repeat(32)}`,
      p_publisher_handle: 'example-owner',
      p_decision: 'authorized',
      p_authorization_basis: 'publisher-consent',
      p_evidence_reference: `authref_${'1'.repeat(32)}`,
      p_evidence_digest: digest('authorization'),
      p_expires_at: '2026-08-01T00:00:00.000Z',
      p_idempotency_digest: digest('authorize')
    }],
    ['record_skill_submission_license_evidence', {
      p_submission_id: `sub_${'e'.repeat(32)}`,
      p_claim_id: '11111111-1111-4111-8111-111111111111',
      p_worker_version: 'skillmap-worker/0.1.0',
      p_audit_receipt_digest: digest('audit'),
      p_spdx_expression: 'MIT',
      p_evidence: [{ repositoryUrl: 'https://github.com/example/skills', sourceCommit: 'a'.repeat(40), path: 'LICENSE', contentDigest: digest('license') }],
      p_review_reference: `licref_${'2'.repeat(32)}`,
      p_review_evidence_digest: digest('license-review'),
      p_idempotency_digest: digest('license-record')
    }],
    ['get_skill_submission_queue_summary', {}],
    ['list_skill_submission_operator_queue', {
      p_state: null,
      p_limit: 20,
      p_after_updated_at: null,
      p_after_submission_id: null
    }],
    ['get_skill_submission_operator_detail', {
      p_submission_id: `sub_${'f'.repeat(32)}`
    }]
  ]) await client.call(name, parameters);
  assert.deepEqual(observed.map(item => item.url.split('/').at(-1)), [
    'dead_letter_expired_skill_submission',
    'list_skill_submission_collisions',
    'review_skill_submission_collisions',
    'record_skill_submission_publisher_authorization',
    'record_skill_submission_license_evidence',
    'get_skill_submission_queue_summary',
    'list_skill_submission_operator_queue',
    'get_skill_submission_operator_detail'
  ]);
  assert.equal(JSON.stringify(observed).includes(SECRET), false);
});

test('publisher authorization and collision update CLIs reject incomplete authority tuples', () => {
  const missingExpiry = spawnSync(process.execPath, [
    'apps/worker/src/authorization.mjs', '--execute',
    '--submission-id', `sub_${'a'.repeat(32)}`, '--publisher-handle', 'example-owner',
    '--decision', 'authorized', '--basis', 'publisher-consent',
    '--evidence-reference', `authref_${'1'.repeat(32)}`,
    '--evidence-digest', digest('authorization'),
    '--operation-id', '11111111-1111-4111-8111-111111111111'
  ], { encoding: 'utf8' });
  assert.equal(missingExpiry.status, 1);
  assert.match(missingExpiry.stderr, /expires-at must be a future ISO timestamp/i);

  const missingTarget = spawnSync(process.execPath, [
    'apps/worker/src/collision-review.mjs', '--execute',
    '--submission-id', `sub_${'b'.repeat(32)}`, '--disposition', 'approved-update',
    '--reason-code', 'reviewed-update',
    '--operation-id', '22222222-2222-4222-8222-222222222222'
  ], { encoding: 'utf8' });
  assert.equal(missingTarget.status, 1);
  assert.match(missingTarget.stderr, /requires exact target publisher, skill, and version IDs/i);

  const distinctWithTarget = spawnSync(process.execPath, [
    'apps/worker/src/collision-review.mjs', '--execute',
    '--submission-id', `sub_${'c'.repeat(32)}`, '--disposition', 'approved-distinct',
    '--reason-code', 'reviewed-distinct', '--target-skill-id', `skl_${'1'.repeat(32)}`,
    '--operation-id', '33333333-3333-4333-8333-333333333333'
  ], { encoding: 'utf8' });
  assert.equal(distinctWithTarget.status, 1);
  assert.match(distinctWithTarget.stderr, /Only approved-update accepts a target identity/i);
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
