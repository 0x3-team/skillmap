import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildQualifiedSkillIdentity,
  deriveSkillId,
  detectIdentityCollisions,
  hashSkillTree,
  normalizeRelativeSkillPath
} from '../dist/core/identity.js';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist/cli.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function tempProject(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-identity-'));
  t?.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function createSkill(root, relativePath = 'alpha-helper') {
  const skillDir = path.join(root, relativePath);
  mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  mkdirSync(path.join(skillDir, 'references', 'nested'), { recursive: true });
  mkdirSync(path.join(skillDir, 'assets'), { recursive: true });
  writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: alpha-helper\ndescription: Use for stable qualified identity tests.\n---\n# Alpha\n');
  writeFileSync(path.join(skillDir, 'scripts', 'check.sh'), '#!/bin/sh\necho checked\n');
  writeFileSync(path.join(skillDir, 'references', 'nested', 'guide.md'), '# Guide\n');
  writeFileSync(path.join(skillDir, 'assets', 'badge.txt'), 'badge-v1\n');
  return skillDir;
}

test('init persists opaque workspace and root IDs; scans keep skillId stable while any tree edit changes contentRevision', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  const skillDir = createSkill(root);

  const initialized = JSON.parse(run(['init', '--root', root, '--json'], cwd));
  assert.match(initialized.workspaceId, /^[0-9a-f-]{36}$/i);
  assert.equal(initialized.rootRecords.length, 1);
  assert.match(initialized.rootRecords[0].rootId, /^[0-9a-f-]{36}$/i);

  const identityFile = path.join(cwd, '.skillmap', 'identity.json');
  const persisted = JSON.parse(readFileSync(identityFile, 'utf8'));
  assert.equal(persisted.workspaceId, initialized.workspaceId);
  assert.equal(persisted.roots[0].rootId, initialized.rootRecords[0].rootId);
  assert.equal(persisted.workspaceId.includes(cwd), false);
  assert.equal(persisted.roots[0].rootId.includes(root), false);

  const first = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const firstSkill = first.skills[0];
  assert.equal(first.version, 2);
  assert.equal(first.identityVersion, 1);
  assert.equal(first.workspaceId, persisted.workspaceId);
  assert.equal(first.identityIssues.length, 0);
  assert.equal(firstSkill.id, firstSkill.skillId);
  assert.match(firstSkill.skillId, /^sk_[A-Za-z0-9_-]{43}$/);
  assert.equal(firstSkill.rootId, persisted.roots[0].rootId);
  assert.equal(firstSkill.relativePath, 'alpha-helper');
  assert.match(firstSkill.contentRevision, /^sha256:[0-9a-f]{64}$/);

  const second = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills[0];
  assert.equal(second.skillId, firstSkill.skillId);
  assert.equal(second.contentRevision, firstSkill.contentRevision);

  writeFileSync(path.join(skillDir, 'references', 'nested', 'guide.md'), '# Guide\nChanged nested evidence.\n');
  const changed = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills[0];
  assert.equal(changed.skillId, firstSkill.skillId);
  assert.notEqual(changed.contentRevision, firstSkill.contentRevision);

  const after = JSON.parse(readFileSync(identityFile, 'utf8'));
  assert.equal(after.workspaceId, persisted.workspaceId);
  assert.equal(after.roots[0].rootId, persisted.roots[0].rootId);
});

test('skill IDs use versioned portable normalized relative paths and reject traversal', () => {
  const rootId = '00000000-0000-4000-8000-000000000001';
  const slashId = deriveSkillId(rootId, 'group/skill');
  assert.equal(slashId, deriveSkillId(rootId, 'group\\skill'));
  assert.equal(deriveSkillId(rootId, 'cafe\u0301'), deriveSkillId(rootId, 'caf\u00e9'));
  assert.equal(normalizeRelativeSkillPath('group\\skill'), 'group/skill');
  assert.match(slashId, /^sk_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(slashId, deriveSkillId(rootId, 'group/other-skill'));
  assert.throws(() => normalizeRelativeSkillPath('../escape'), /traversal/);
  assert.throws(() => normalizeRelativeSkillPath('/absolute/skill'), /Absolute skill paths/);
  assert.throws(() => normalizeRelativeSkillPath('C:\\absolute\\skill'), /Absolute skill paths/);
  assert.throws(() => deriveSkillId('not-a-uuid', 'group/skill'), /opaque UUID/);
});

test('contentRevision is independent of creation order and covers every nested regular file', async (t) => {
  const cwd = tempProject(t);
  const first = path.join(cwd, 'first');
  const second = path.join(cwd, 'second');
  createSkill(first, 'same');
  createSkill(second, 'same');

  const firstRevision = await hashSkillTree(path.join(first, 'same'));
  const secondRevision = await hashSkillTree(path.join(second, 'same'));
  assert.equal(firstRevision.contentRevision, secondRevision.contentRevision);
  assert.deepEqual(firstRevision.entries.map((entry) => entry.path), secondRevision.entries.map((entry) => entry.path));

  writeFileSync(path.join(second, 'same', 'assets', 'deep.txt'), 'new security-relevant asset\n');
  const changedRevision = await hashSkillTree(path.join(second, 'same'));
  assert.notEqual(changedRevision.contentRevision, firstRevision.contentRevision);
  assert.ok(changedRevision.entries.some((entry) => entry.path === 'assets/deep.txt'));
});

test('qualified identity rejects root escape', async (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root);
  const outsideDir = createSkill(path.join(cwd, 'outside'));
  const initialized = JSON.parse(run(['init', '--root', root, '--json'], cwd));
  const approvedRoot = initialized.rootRecords[0];

  await assert.rejects(() => buildQualifiedSkillIdentity(approvedRoot, outsideDir), /escapes/);
});

test('file symlinks fail the identity scan closed', {
  skip: process.platform === 'win32' ? 'File symlink creation is not reliably available without Windows developer mode or elevated privileges.' : false
}, (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  const skillDir = createSkill(root);
  const outsideDir = createSkill(path.join(cwd, 'outside'));
  run(['init', '--root', root], cwd);

  symlinkSync(path.join(outsideDir, 'assets', 'badge.txt'), path.join(skillDir, 'assets', 'escape.txt'));
  assert.throws(() => run(['scan'], cwd), /Symbolic links are not allowed/);
  assert.equal(readFileMaybe(path.join(cwd, '.skillmap', 'inventory.json')), undefined);
});

test('identity collision diagnostics distinguish ID, normalized-path, and physical-path collisions', () => {
  const records = [
    { skillId: 'sk_same', rootId: 'root-a', relativePath: 'one', path: '/tmp/one/SKILL.md' },
    { skillId: 'sk_same', rootId: 'root-b', relativePath: 'two', path: '/tmp/two/SKILL.md' },
    { skillId: 'sk_three', rootId: 'root-a', relativePath: 'one', path: '/tmp/three/SKILL.md' },
    { skillId: 'sk_four', rootId: 'root-c', relativePath: 'four', path: '/tmp/one/SKILL.md' }
  ];
  const codes = new Set(detectIdentityCollisions(records).map((issue) => issue.code));
  assert.deepEqual(codes, new Set(['skill-id-collision', 'normalized-path-collision', 'physical-path-collision']));
});

test('skill moves fail closed until an explicit receipt transfers exact policy identity', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  const originalDir = createSkill(root, 'original-alpha');
  run(['init', '--root', root], cwd);
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), 'version: 1\nskills:\n  alpha-helper:\n    tier: blocked\n');
  run(['state', 'import-legacy', '--confirm'], cwd);
  const before = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills[0];
  run(['policy', 'migrate', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  assert.equal(JSON.parse(run(['route', 'alpha-helper', '--json'], cwd)).decision.recommendations.length, 0);

  const movedDir = path.join(root, 'moved-alpha');
  renameSync(originalDir, movedDir);
  const movedInventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  let moved = movedInventory.skills[0];
  assert.notEqual(moved.skillId, before.skillId);
  assert.equal(moved.contentRevision, before.contentRevision);
  const issue = movedInventory.identityIssues.find((item) => item.code === 'pending-skill-move');
  assert.equal(issue.fromSkillId, before.skillId);
  assert.equal(issue.toSkillId, moved.skillId);
  writeFileSync(path.join(movedDir, 'assets', 'badge.txt'), 'badge changed after move\n');
  let rescanned = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  let pending = rescanned.identityIssues.find((item) => item.code === 'pending-skill-move');
  assert.equal(pending.fromSkillId, before.skillId);
  assert.equal(pending.toSkillId, moved.skillId);
  assert.notEqual(pending.contentRevision, before.contentRevision);

  const finalDir = path.join(root, 'final-alpha');
  renameSync(movedDir, finalDir);
  rescanned = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  moved = rescanned.skills[0];
  pending = rescanned.identityIssues.find((item) => item.code === 'pending-skill-move');
  assert.equal(pending.fromSkillId, before.skillId);
  assert.equal(pending.toSkillId, moved.skillId);
  assert.equal(JSON.parse(run(['status', '--json'], cwd)).status.readinessPhase, 'identity-invalid');
  assert.match(runFailure(['route', 'alpha-helper'], cwd), /(?:current canonical or raw routing state differs from the last explicitly approved revision|approved effective routing receipt does not match its immutable artifact)/i);

  const preview = JSON.parse(run(['identity', 'adopt-move', '--from', before.skillId, '--to', moved.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed the updated full-tree revision across the complete move chain.', '--dry-run', '--json'], cwd));
  assert.equal(preview.dryRun, true);
  const registryAfterDryRun = JSON.parse(readFileSync(path.join(cwd, '.skillmap/identity-migrations.json'), 'utf8'));
  assert.equal(registryAfterDryRun.moves.length, 0);
  assert.ok(registryAfterDryRun.tombstones.some((item) => item.skillId === before.skillId));
  const adopted = JSON.parse(run(['identity', 'adopt-move', '--from', before.skillId, '--to', moved.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed the updated full-tree revision across the complete move chain.', '--confirm', '--json'], cwd));
  assert.equal(adopted.dryRun, false);
  assert.match(adopted.receipt.receiptDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8')).identityIssues.length, 0);
  run(['apply-policy'], cwd);
  assert.equal(JSON.parse(run(['route', 'alpha-helper', '--json'], cwd)).decision.recommendations.length, 0);
  const active = JSON.parse(readFileSync(adopted.policyArtifact, 'utf8'));
  assert.equal(active.skillsById[moved.skillId].tier, 'blocked');
  assert.equal(active.skillsById[before.skillId], undefined);
  assert.equal(JSON.parse(run(['scan', '--json'], cwd)).inventory.identityIssues.length, 0);
});

test('legacy v1 inventory upgrades on first scan without fabricating undefined move identities', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root);
  run(['init', '--root', root], cwd);
  const qualified = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const legacy = {
    version: 1,
    workspaceId: qualified.workspaceId,
    generatedAt: qualified.generatedAt,
    cwd,
    roots: qualified.roots,
    warnings: [],
    skills: qualified.skills.map(({ skillId, identityVersion, rootId, relativePath, contentRevision, ...skill }) => ({ ...skill, id: skill.path }))
  };
  writeFileSync(path.join(cwd, '.skillmap/inventory.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  const upgraded = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.identityIssues.length, 0);
  assert.match(upgraded.skills[0].skillId, /^sk_[A-Za-z0-9_-]{43}$/);
});

test('explicitly imported legacy identity fails closed until scan and policy approval publish qualified state', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root);
  run(['init', '--root', root], cwd);
  const qualified = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  run(['apply-policy'], cwd);
  const legacy = {
    version: 1,
    workspaceId: qualified.workspaceId,
    generatedAt: qualified.generatedAt,
    cwd,
    roots: qualified.roots,
    warnings: [],
    skills: qualified.skills.map(({ skillId, identityVersion, rootId, relativePath, contentRevision, ...skill }) => ({ ...skill, id: skill.path }))
  };
  writeFileSync(path.join(cwd, '.skillmap/inventory.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  assert.equal(JSON.parse(run(['identity', 'status', '--json'], cwd)).legacyIdentity, true);
  const status = JSON.parse(run(['status', '--json'], cwd)).status;
  assert.equal(status.readinessPhase, 'identity-invalid');
  assert.deepEqual(status.nextActions, ['skillmap scan']);
  assert.match(runFailure(['route', '--hook', '--prompt', 'alpha helper'], cwd), /(?:current canonical or raw routing state differs from the last explicitly approved revision|approved effective routing receipt does not match its immutable artifact)/i);
  const upgraded = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.identityIssues.length, 0);
  run(['apply-policy'], cwd);
  assert.doesNotThrow(() => run(['route', '--hook', '--prompt', 'alpha helper'], cwd));
});

test('ambiguous moves and renamed pending targets persist until an explicit source is adopted', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root, 'first-alpha');
  createSkill(root, 'second-alpha');
  run(['init', '--root', root], cwd);
  const before = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills;
  rmSync(path.join(root, 'first-alpha'), { recursive: true });
  rmSync(path.join(root, 'second-alpha'), { recursive: true });
  const targetDir = createSkill(root, 'replacement-alpha');
  let inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  let issue = inventory.identityIssues.find((item) => item.code === 'ambiguous-skill-move');
  assert.ok(issue);
  assert.equal(issue.skillIds.length, 3);
  inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  issue = inventory.identityIssues.find((item) => item.code === 'ambiguous-skill-move');
  assert.ok(issue, 'no-op rescans must not clear ambiguity');
  assert.match(runFailure(['identity', 'adopt-move', '--from', issue.toSkillId, '--to', issue.toSkillId, '--actor', 'reviewer', '--reason', 'Reviewed identity ambiguity and selected a source.', '--confirm'], cwd), /different old and new/);

  writeFileSync(path.join(targetDir, 'SKILL.md'), '---\nname: beta-helper\ndescription: Renamed while identity review remains pending.\n---\n# Beta\n');
  inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  issue = inventory.identityIssues.find((item) => item.code === 'ambiguous-skill-move');
  assert.ok(issue);
  assert.equal(issue.displayName, 'beta-helper');
  inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.ok(inventory.identityIssues.some((item) => item.code === 'ambiguous-skill-move'));

  const source = before[0].skillId;
  run(['identity', 'adopt-move', '--from', source, '--to', issue.toSkillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed the ambiguous prior variants and selected the matching historical source.', '--confirm'], cwd);
  assert.equal(JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8')).identityIssues.length, 0);
});

test('delete-scan-add move history remains adoptable after name and content both change', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root, 'old-alpha');
  run(['init', '--root', root], cwd);
  const oldSkill = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills[0];
  rmSync(path.join(root, 'old-alpha'), { recursive: true });
  assert.equal(JSON.parse(run(['scan', '--json'], cwd)).inventory.skills.length, 0);
  const status = JSON.parse(run(['identity', 'status', '--json'], cwd));
  assert.ok(status.tombstones.some((item) => item.skillId === oldSkill.skillId));

  const newDir = createSkill(root, 'new-beta');
  writeFileSync(path.join(newDir, 'SKILL.md'), '---\nname: beta-helper\ndescription: Changed identity and content after a separately observed removal.\n---\n# Beta\n');
  const inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const target = inventory.skills[0];
  const pending = inventory.identityIssues.find((item) => item.code === 'pending-skill-move');
  assert.equal(pending.fromSkillId, oldSkill.skillId);
  assert.equal(pending.toSkillId, target.skillId);
  run(['identity', 'adopt-move', '--from', oldSkill.skillId, '--to', target.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed the tombstoned removal and the renamed replacement content.', '--confirm'], cwd);
  assert.equal(JSON.parse(run(['identity', 'status', '--json'], cwd)).tombstones.length, 0);
});

test('diagnostic doctor scopes cannot overwrite canonical move or root-set gates', (t) => {
  const cwd = tempProject(t);
  const firstRoot = path.join(cwd, 'first-root');
  const secondRoot = path.join(cwd, 'second-root');
  const original = createSkill(firstRoot, 'alpha');
  createSkill(secondRoot, 'beta');
  run(['init', '--root', firstRoot, '--root', secondRoot], cwd);
  run(['scan'], cwd);
  renameSync(original, path.join(firstRoot, 'moved-alpha'));
  const pendingInventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.ok(pendingInventory.identityIssues.some((item) => item.code === 'pending-skill-move'));
  const identityBefore = readFileSync(path.join(cwd, '.skillmap/identity.json'), 'utf8');
  const diagnosticRoot = path.join(cwd, 'diagnostic-only-root');
  createSkill(diagnosticRoot, 'gamma');
  run(['doctor', '--root', diagnosticRoot], cwd);
  const canonical = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  assert.equal(canonical.roots.length, 2);
  assert.ok(canonical.identityIssues.some((item) => item.code === 'pending-skill-move'));
  assert.equal(readFileSync(path.join(cwd, '.skillmap/identity.json'), 'utf8'), identityBefore);
  assert.match(runFailure(['scan', '--fixtures', path.join(repo, 'test/fixtures/basic')], cwd), /Refusing to replace a canonical real-root inventory/);
  assert.match(runFailure(['scan', '--fixtures', diagnosticRoot], cwd), /Refusing to replace a canonical real-root inventory/);
  assert.match(runFailure(['scan', '--root', path.join(repo, 'test/fixtures/basic')], cwd), /Refusing to replace a canonical real-root inventory/);
  assert.ok(JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8')).identityIssues.some((item) => item.code === 'pending-skill-move'));
});

test('an unrelated replacement can be explicitly approved as new without transferring a tombstoned policy identity', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root, 'old-alpha');
  run(['init', '--root', root], cwd);
  const oldSkill = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills[0];
  rmSync(path.join(root, 'old-alpha'), { recursive: true });
  run(['scan'], cwd);
  const newDir = createSkill(root, 'unrelated-beta');
  writeFileSync(path.join(newDir, 'SKILL.md'), '---\nname: unrelated-beta\ndescription: A genuinely new identity unrelated to the removed skill.\n---\n# New\n');
  const inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const target = inventory.skills[0];
  assert.ok(inventory.identityIssues.some((item) => item.toSkillId === target.skillId));
  const preview = JSON.parse(run(['identity', 'approve-new', '--skill-id', target.skillId, '--actor', 'fixture-reviewer', '--reason', 'Confirmed this is a new skill and not a replacement for the removed identity.', '--dry-run', '--json'], cwd));
  assert.equal(preview.dryRun, true);
  const approved = JSON.parse(run(['identity', 'approve-new', '--skill-id', target.skillId, '--actor', 'fixture-reviewer', '--reason', 'Confirmed this is a new skill and not a replacement for the removed identity.', '--confirm', '--json'], cwd));
  assert.equal(approved.dryRun, false);
  const status = JSON.parse(run(['identity', 'status', '--json'], cwd));
  assert.equal(status.identityIssues.length, 0);
  assert.ok(status.tombstones.some((item) => item.skillId === oldSkill.skillId));
  assert.ok(status.approvedNewIdentities.some((item) => item.skillId === target.skillId));
});

test('approved-new receipt clears an ambiguous blocker after an interrupted inventory write', (t) => {
  const cwd = tempProject(t);
  const root = path.join(cwd, 'skills');
  createSkill(root, 'first-alpha');
  createSkill(root, 'second-alpha');
  run(['init', '--root', root], cwd);
  run(['scan'], cwd);
  rmSync(path.join(root, 'first-alpha'), { recursive: true });
  rmSync(path.join(root, 'second-alpha'), { recursive: true });
  createSkill(root, 'unrelated-alpha');
  const ambiguous = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const target = ambiguous.skills[0];
  assert.ok(ambiguous.identityIssues.some((item) => item.code === 'ambiguous-skill-move'));
  run(['identity', 'approve-new', '--skill-id', target.skillId, '--actor', 'fixture-reviewer', '--reason', 'Confirmed the replacement is new despite multiple historical candidates.', '--confirm'], cwd);
  writeFileSync(path.join(cwd, '.skillmap/inventory.json'), `${JSON.stringify(ambiguous, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  const recovered = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.equal(recovered.identityIssues.length, 0);
});

test('fixture inventory never becomes a move ancestor for a later real-root scan', (t) => {
  const cwd = tempProject(t);
  run(['scan', '--fixtures', path.join(repo, 'test/fixtures/basic')], cwd);
  const realRoot = path.join(cwd, 'real-skills');
  createSkill(realRoot, 'frontend-design');
  run(['init', '--root', realRoot], cwd);
  const real = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.equal(real.skills.length, 1);
  assert.equal(real.identityIssues.length, 0);
  assert.equal(real.skills[0].scope === 'fixture', false);
});

test('a missing configured root persists an incomplete-root-set blocker', (t) => {
  const cwd = tempProject(t);
  const firstRoot = path.join(cwd, 'first-root');
  const secondRoot = path.join(cwd, 'second-root');
  createSkill(firstRoot, 'alpha');
  createSkill(secondRoot, 'beta');
  run(['init', '--root', firstRoot, '--root', secondRoot], cwd);
  run(['scan'], cwd);
  renameSync(secondRoot, `${secondRoot}-offline`);
  const inventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  assert.ok(inventory.identityIssues.some((issue) => issue.code === 'incomplete-root-set'));
  assert.equal(JSON.parse(run(['status', '--json'], cwd)).status.readinessPhase, 'identity-invalid');
  assert.throws(() => run(['apply-policy', '--dry-run'], cwd), /Policy application blocked/);
});

function readFileMaybe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function runFailure(args, cwd) {
  try {
    run(args, cwd);
  } catch (error) {
    return `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
  }
  assert.fail(`Expected command to fail: ${args.join(' ')}`);
}
