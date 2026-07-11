import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildInventory } from '../dist/core/inventory.js';
import { deriveSkillId, hashSkillTree } from '../dist/core/identity.js';
import { createSkillWorkspaceByteBudget, SkillFilesystemLimitError } from '../dist/core/skill-tree-limits.js';
import { verifyApprovedRootManifest } from '../dist/server/filesystem-freshness.js';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  revisionId: 'r00000000000000000001-33333333-3333-4333-8333-333333333333',
  workspaceRevision: `sha256:${'1'.repeat(64)}`,
  effectiveDigest: null,
  effectiveRevisionDigest: null
};

async function fixture(t, prefix = 'skillmap-tree-limits-') {
  const cwd = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'skills');
  const skill = path.join(root, 'alpha');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: alpha\ndescription: Use for bounded alpha work.\n---\n# Alpha\n');
  return { cwd, root, skill };
}

test('canonical tree hashing fails closed on depth, file-count, per-file, and per-tree byte limits', async (t) => {
  const value = await fixture(t);
  await mkdir(path.join(value.skill, 'references', 'nested'), { recursive: true });
  await writeFile(path.join(value.skill, 'references', 'one.txt'), 'one');
  await writeFile(path.join(value.skill, 'references', 'nested', 'two.txt'), 'two');
  await writeFile(path.join(value.skill, 'references', 'bulk.txt'), 'b'.repeat(80));

  await assert.rejects(
    hashSkillTree(value.skill, { limits: { maxTreeDepth: 1 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxTreeDepth'
  );
  await assert.rejects(
    hashSkillTree(value.skill, { limits: { maxTreeFiles: 2 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxTreeFiles'
  );
  await assert.rejects(
    hashSkillTree(value.skill, { limits: { maxDiscoveryDirectories: 1 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxDiscoveryDirectories'
  );
  await assert.rejects(
    hashSkillTree(value.skill, { limits: { maxFileBytes: 8, maxSkillMarkdownBytes: 8, maxTreeBytes: 64, maxWorkspaceBytes: 64 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxFileBytes'
  );
  await assert.rejects(
    hashSkillTree(value.skill, { limits: { maxFileBytes: 128, maxSkillMarkdownBytes: 128, maxTreeBytes: 128, maxWorkspaceBytes: 256 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxTreeBytes'
  );

  const measured = await hashSkillTree(value.skill);
  const measuredBytes = measured.entries.reduce((total, entry) => total + entry.bytes, 0);
  const workspaceBudget = createSkillWorkspaceByteBudget(measuredBytes + Math.max(1, Math.floor(measuredBytes / 2)));
  await hashSkillTree(value.skill, { workspaceBudget });
  await assert.rejects(
    hashSkillTree(value.skill, { workspaceBudget }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxWorkspaceBytes'
  );
});

test('inventory discovery and SKILL.md reads use the same bounded policy before publication', async (t) => {
  const value = await fixture(t);
  await mkdir(path.join(value.root, 'beta'), { recursive: true });
  await writeFile(path.join(value.root, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Use for bounded beta work.\n---\n# Beta\n');

  await assert.rejects(
    buildInventory(value.cwd, [value.root], [], { limits: { maxDiscoveryEntries: 1 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxDiscoveryEntries'
  );
  await assert.rejects(
    buildInventory(value.cwd, [value.root], [], { limits: { maxSkillMarkdownBytes: 16 } }),
    error => error instanceof SkillFilesystemLimitError && error.limit === 'maxSkillMarkdownBytes'
  );
});

test('freshness recomputes contentRevision through the same bounded streaming hasher', async (t) => {
  const value = await fixture(t);
  await mkdir(path.join(value.skill, 'references', 'nested'), { recursive: true });
  await writeFile(path.join(value.skill, 'references', 'nested', 'guide.txt'), 'bounded guide');
  const tree = await hashSkillTree(value.skill);
  const baseline = {
    revision: REVISION,
    roots: [{ rootId: ROOT_ID, configuredPath: value.root, realPath: value.root, approvedAt: '2026-07-10T00:00:00.000Z' }],
    skills: [{ rootId: ROOT_ID, relativePath: 'alpha', skillId: deriveSkillId(ROOT_ID, 'alpha'), contentRevision: tree.contentRevision }]
  };
  const verified = await verifyApprovedRootManifest(baseline);
  assert.equal(verified.changedRootIds.length, 0);
  await assert.rejects(
    verifyApprovedRootManifest(baseline, { maxTreeDepth: 1 }),
    error => error?.reasonCode === 'verification-limit'
  );
});
