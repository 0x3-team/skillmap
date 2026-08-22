import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImportPreview } from '../dist/core/import-preview.js';

const baseManifest = {
  schema_version: '1.0',
  identity: { logical_id: 'alpha-helper', public_id: 'pub_alpha_01' },
  display: { name: 'Alpha Helper', description: 'Use for alpha work.' },
  source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha-helper', revision: 'rev-1' },
  files: [
    { path: 'SKILL.md', media_type: 'text/markdown; charset=utf-8', utf8_bytes: 5, digest: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', executable: false },
    { path: 'z.txt', media_type: 'text/plain', utf8_bytes: 3, digest: 'sha256:7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed', executable: false }
  ],
  provenance: { publisher_id: 'local-owner', ingest_id: 'ingest-1', created_at: '2026-08-01T00:00:00Z' },
  compatibility: { manifest_major: 1, minimum_consumer_major: 1 },
  manifest_digest: 'sha256:d5f665936d3e01f96a3b7ce0ad2ad6af3294661491c3d4b0b1fa6eb4cbcc93d4'
};

function importableResult(overrides = {}) {
  return {
    importable: true,
    manifest: baseManifest,
    manifestDigest: 'sha256:d5f665936d3e01f96a3b7ce0ad2ad6af3294661491c3d4b0b1fa6eb4cbcc93d4',
    canonicalBytes: Buffer.from('{}'),
    files: baseManifest.files,
    nonImportable: [],
    warnings: [],
    sourceReceipt: {
      rootId: '00000000-0000-4000-8000-000000000000',
      skillDir: '/private/absolute/path',
      relativePath: 'alpha-helper',
      source: baseManifest.source,
      provenance: baseManifest.provenance,
      generatedAt: '2026-08-01T00:00:00Z'
    },
    ...overrides
  };
}

function nonImportableResult(overrides = {}) {
  return {
    importable: false,
    manifest: undefined,
    manifestDigest: undefined,
    canonicalBytes: undefined,
    files: [],
    nonImportable: [{ path: 'scripts/evil.sh', reason: 'IMPORT_SCRIPT_DENIED', detail: 'script-like', retryable: false }],
    warnings: [],
    sourceReceipt: {
      rootId: '00000000-0000-4000-8000-000000000000',
      skillDir: '/private/absolute/path',
      relativePath: 'bad-skill',
      source: baseManifest.source,
      provenance: baseManifest.provenance,
      generatedAt: '2026-08-01T00:00:00Z'
    },
    ...overrides
  };
}

test('dashboard-safe preview exposes bounded totals, skills, and proposed actions', () => {
  const preview = buildImportPreview([importableResult(), nonImportableResult()]);
  assert.equal(preview.total_skills, 2);
  assert.equal(preview.importable_skills, 1);
  assert.equal(preview.non_importable_skills, 1);
  assert.equal(preview.total_files, 2);
  assert.equal(preview.total_bytes, 8);
  assert.equal(preview.proposed_actions.import, 1);
  assert.equal(preview.proposed_actions.block, 1);
  assert.equal(preview.proposed_actions.review, 0);
  assert.equal(preview.skills.length, 2);
  assert.ok(preview.skills.every((skill) => skill.display_name !== undefined));
});

test('preview does not expose sourceReceipt absolute skillDir or raw content', () => {
  const preview = buildImportPreview([importableResult()]);
  const json = JSON.stringify(preview);
  assert.ok(!json.includes('/private/absolute/path'));
  assert.ok(!json.includes('Use for alpha work'));
  assert.ok(!json.includes('2cf24dba'));
});

test('preview accepts and counts stable blocked and excluded records without inspecting content', () => {
  const blocked = [
    { skillPublicId: 'pub_alpha_01', path: 'SKILL.md', reason: 'IMPORT_SECRET_BLOCKED', detail: 'key material' },
    {
      skillPublicId: 'pub_alpha_01',
      path: '/Users/sensitive/path.pem',
      reason: 'IMPORT_SECRET_BLOCKED',
      detail: 'failed at /Users/sensitive/path.pem'
    }
  ];
  const excluded = [
    { skillPublicId: 'pub_unknown', path: 'notes.md', reason: 'IMPORT_BLOCKED_FOR_REVIEW', detail: 'needs review' }
  ];
  const preview = buildImportPreview([importableResult()], { blockedRecords: blocked, excludedRecords: excluded });
  assert.equal(preview.total_blocked, 2);
  assert.equal(preview.total_excluded, 1);
  assert.equal(preview.proposed_actions.import, 0);
  assert.equal(preview.proposed_actions.block, 1);
  assert.equal(preview.skills[0].blocked, 2);
  assert.equal(preview.skills[0].excluded, 0);
  assert.ok(preview.blocked.some((record) => record.path === undefined));
  assert.ok(!JSON.stringify(preview).includes('/Users/sensitive/'));
  assert.ok(!JSON.stringify(preview).includes('path.pem'));
});

test('preview removes home, URI, traversal paths and unsafe details', () => {
  const records = [
    { path: '~/private/key.pem', reason: 'IMPORT_REJECTED', detail: 'read ~/private/key.pem' },
    { path: 'file:///private/key.pem', reason: 'IMPORT_REJECTED', detail: 'file:///private/key.pem' },
    { path: '../private/key.pem', reason: 'IMPORT_REJECTED', detail: '../private/key.pem' }
  ];
  const preview = buildImportPreview([importableResult()], { blockedRecords: records });
  for (const record of preview.blocked) {
    assert.equal(record.path, undefined);
    assert.equal(record.detail, undefined);
  }
});

test('preview reconciles duplicate manifest digests', () => {
  const a = importableResult();
  const b = importableResult({ sourceReceipt: { ...a.sourceReceipt, relativePath: 'alpha-helper-2' } });
  const preview = buildImportPreview([a, b]);
  assert.equal(preview.total_skills, 2);
  assert.equal(preview.total_duplicates, 2);
});

test('preview bounds output to configured limits', () => {
  const results = Array.from({ length: 100 }, (_, i) => importableResult({
    manifest: { ...baseManifest, identity: { logical_id: `skill-${i}`, public_id: `pub_${i}` } },
    manifestDigest: `sha256:${String(i).padStart(64, '0')}`
  }));
  const preview = buildImportPreview(results, { maxSkills: 5, maxItems: 3 });
  assert.equal(preview.skills.length, 5);
  assert.equal(preview.blocked.length + preview.excluded.length, 0);
  assert.equal(preview.truncated, true);
  assert.equal(preview.total_skills, 100);
});
