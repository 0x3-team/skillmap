import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(repo, 'catalog', 'skill-library.json'), 'utf8'));

test('portable skill manifest is deterministic, unique, and Lovable-compatible', () => {
  assert.equal(manifest.schemaVersion, 'skillmap.skill-library/v1');
  assert.equal(manifest.skillCount, 153);
  assert.equal(new Set(manifest.skills.map(skill => skill.name)).size, manifest.skillCount);
  assert.deepEqual(manifest.excluded.map(entry => entry.name).sort(), ['cloudflare', 'pentest-tools']);
  for (const skill of manifest.skills) {
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(skill.entrypoint, `skills/${skill.name}/SKILL.md`);
    assert.equal(skill.compatibility.agentSkills, true);
    assert.equal(skill.compatibility.lovable, true);
    assert.equal(skill.review.status, 'unreviewed');
    assert.equal(skill.review.autoUseRecommended, false);
    assert.equal(typeof skill.review.hasExecutableContent, 'boolean');
    assert.equal(skill.compatibility.lovableImportUrl, `https://github.com/0x3-team/skillmap/tree/main/skills/${skill.name}`);
    assert.ok(skill.integrity.fileCount <= manifest.limits.lovable.maxFiles);
    assert.ok(skill.integrity.totalBytes <= manifest.limits.lovable.maxTotalBytes);
    assert.ok(skill.integrity.largestFileBytes <= manifest.limits.lovable.maxFileBytes);
    assert.match(skill.integrity.treeDigest, /^[a-f0-9]{64}$/);
    assert.match(skill.source.commit, /^[a-f0-9]{40}$/);
  }
});

test('generated portable skill manifest is current', () => {
  const result = spawnSync(process.execPath, ['scripts/build-skill-library.mjs', '--check'], {
    cwd: repo,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Lovable adapter emits a direct subdirectory import URL', () => {
  const result = spawnSync(process.execPath, [
    'scripts/install-skill-library.mjs',
    '--target', 'lovable',
    '--skill', 'supabase',
    '--json'
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repositoryMustBePublic, true);
  assert.deepEqual(payload.skills, [{
    name: 'supabase',
    importUrl: 'https://github.com/0x3-team/skillmap/tree/main/skills/supabase'
  }]);
});

test('local adapter dry-run does not write and resolves the requested project target', () => {
  const projectRoot = path.join(repo, '.tmp', 'portable-skill-test');
  const result = spawnSync(process.execPath, [
    'scripts/install-skill-library.mjs',
    '--target', 'copilot',
    '--scope', 'project',
    '--project-root', projectRoot,
    '--skill', 'supabase',
    '--dry-run',
    '--json'
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.results[0].status, 'would-install');
  assert.equal(payload.results[0].destination, path.join(projectRoot, '.github', 'skills', 'supabase'));
});

test('Lovable ZIP export is deterministic, wrapped, and manifest-bound', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'skillmap-lovable-'));
  try {
    const first = spawnSync(process.execPath, [
      'scripts/export-lovable-skills.mjs',
      '--skill', 'supabase',
      '--output', output,
      '--json'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const payload = JSON.parse(first.stdout);
    assert.equal(payload.wrappingFolder, true);
    assert.equal(payload.results[0].files, manifest.skills.find(skill => skill.name === 'supabase').files.length);
    const archive = await readFile(path.join(output, 'supabase.zip'));
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.ok(archive.includes(Buffer.from('supabase/SKILL.md', 'utf8')));
    const firstDigest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(archive).digest('hex'));

    const second = spawnSync(process.execPath, [
      'scripts/export-lovable-skills.mjs',
      '--skill', 'supabase',
      '--output', output,
      '--force',
      '--json'
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    const secondArchive = await readFile(path.join(output, 'supabase.zip'));
    const secondDigest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(secondArchive).digest('hex'));
    assert.equal(secondDigest, firstDigest);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
