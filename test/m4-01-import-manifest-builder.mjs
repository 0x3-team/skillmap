import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildImportManifest } from '../dist/core/import-manifest-builder.js';

const ROOT_ID = '00000000-0000-4000-8000-000000000000';

function makeRootRecord(root) {
  return { rootId: ROOT_ID, configuredPath: root, realPath: root, approvedAt: '2026-08-01T00:00:00Z' };
}

async function makeSkill(dir, name, opts = {}) {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const body = typeof opts.skillBody === 'string'
    ? opts.skillBody
    : '---\nname: Alpha Helper\ndescription: Use for alpha work.\n---\n' + (opts.skillBody ?? 'hello');
  await writeFile(path.join(skillDir, 'SKILL.md'), body);
  if (opts.extra) {
    for (const [relative, content] of Object.entries(opts.extra)) {
      const filePath = path.join(skillDir, relative);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
  }
  return skillDir;
}

function buildOptions(overrides = {}) {
  return {
    publicId: 'pub_alpha_01',
    logicalId: 'alpha-helper',
    source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha-helper', revision: 'rev-1' },
    provenance: { publisher_id: 'local-owner', ingest_id: 'ingest-1', created_at: '2026-08-01T00:00:00Z' },
    ...overrides
  };
}

test('repeated scans of an unchanged skill produce byte-identical manifest digests', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillmap-import-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const skillDir = await makeSkill(dir, 'alpha-helper', { extra: { 'z.txt': 'one' } });
  const rootRecord = makeRootRecord(dir);
  const first = await buildImportManifest(skillDir, buildOptions({ rootRecord }));
  const second = await buildImportManifest(skillDir, buildOptions({ rootRecord }));
  assert.ok(first.importable, `expected importable: ${first.nonImportable.map((n) => n.detail).join('; ')}`);
  assert.ok(second.importable);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.manifest?.manifest_digest, second.manifest?.manifest_digest);
  assert.equal(first.canonicalBytes.toString('hex'), second.canonicalBytes.toString('hex'));
});

test('duplicate-suffix materializations preserve logical identity and manifest digest', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillmap-import-dup-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const skillA = await makeSkill(dir, 'alpha-helper', { extra: { 'z.txt': 'one' } });
  const skillB = await makeSkill(dir, 'alpha-helper-2', { extra: { 'z.txt': 'one' } });
  const rootRecord = makeRootRecord(dir);
  const resultA = await buildImportManifest(skillA, buildOptions({ rootRecord, logicalId: 'alpha-helper' }));
  const resultB = await buildImportManifest(skillB, buildOptions({ rootRecord, logicalId: 'alpha-helper' }));
  assert.ok(resultA.importable);
  assert.ok(resultB.importable);
  assert.equal(resultA.manifestDigest, resultB.manifestDigest);
  assert.equal(resultA.manifest?.identity.logical_id, 'alpha-helper');
  assert.equal(resultB.manifest?.identity.logical_id, 'alpha-helper');
  assert.notEqual(path.basename(resultA.sourceReceipt.skillDir), path.basename(resultB.sourceReceipt.skillDir));
});

test('non-importable mapping rejects hidden, generated, script, archive, active, and binary files', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillmap-import-hostile-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const skillDir = await makeSkill(dir, 'bad-skill', {
    extra: {
      'scripts/check.sh': '#!/bin/sh\necho no\n',
      'references/.env': 'FAKE=1\n',
      'references/.hidden-note.txt': 'not a credential\n',
      'dist/bundle.js': 'console.log(1);\n',
      'assets/logo.bin': Buffer.from([0x00, 0x01, 0x02]),
      'archive.zip': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'page.html': '<html></html>\n'
    }
  });
  const rootRecord = makeRootRecord(dir);
  const result = await buildImportManifest(skillDir, buildOptions({ rootRecord }));
  assert.equal(result.importable, false);
  const reasons = new Set(result.nonImportable.map((n) => n.reason));
  assert.ok(reasons.has('IMPORT_SCRIPT_DENIED'), `expected script denied, got ${[...reasons].join(', ')}`);
  assert.ok(reasons.has('IMPORT_HIDDEN_PATH'));
  assert.ok(reasons.has('IMPORT_SECRET_BLOCKED'));
  assert.ok(reasons.has('IMPORT_GENERATED_PATH'));
  assert.ok(reasons.has('IMPORT_ARCHIVE_DENIED'));
  assert.ok(reasons.has('IMPORT_ACTIVE_CONTENT_DENIED'));
  assert.ok(reasons.has('IMPORT_FILE_TYPE_DENIED'));
});

test('SKILL.md frontmatter recovery warning is treated as invalid', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillmap-import-frontmatter-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const skillDir = await makeSkill(dir, 'bad-frontmatter', { skillBody: '---\nname: x\n' });
  const rootRecord = makeRootRecord(dir);
  const result = await buildImportManifest(skillDir, buildOptions({ rootRecord }));
  assert.equal(result.importable, false);
  assert.ok(result.nonImportable.some((n) => n.reason === 'FRONTMATTER_INVALID'));
});

test('secret preflight blocks forbidden filenames and synthetic credential canaries before manifest creation', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skillmap-import-secret-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const skillDir = await makeSkill(dir, 'secret-skill', {
    extra: {
      '.env.example': 'TOKEN=placeholder\n',
      'notes.txt': `token=ghp_${'A'.repeat(36)}\n`
    }
  });
  const result = await buildImportManifest(skillDir, buildOptions({ rootRecord: makeRootRecord(dir) }));
  assert.equal(result.importable, false);
  assert.ok(result.nonImportable.some((entry) => entry.reason === 'IMPORT_SECRET_BLOCKED'));
  assert.equal(result.manifest, undefined);
  assert.equal(result.manifestDigest, undefined);
  const serialized = JSON.stringify(result.nonImportable);
  assert.ok(!serialized.includes('ghp_'));
  assert.ok(!serialized.includes(path.resolve(skillDir)));
});
