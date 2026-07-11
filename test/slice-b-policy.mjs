import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist/cli.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function writeSkill(root, directory, name, description) {
  const skillDir = path.join(root, directory);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`
  );
  return skillDir;
}

function policyProject() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-policy-v2-'));
  const root = path.join(cwd, 'skills');
  writeSkill(root, 'alpha-one', 'alpha', 'Use for alpha audit workflows and first variant review.');
  writeSkill(root, 'alpha-two', 'alpha', 'Use for alpha audit workflows and second variant review.');
  writeSkill(root, 'beta', 'beta', 'Use for beta migration and unique policy checks.');
  run(['init', '--root', root], cwd);
  const policyText = [
    'version: 1',
    'skills:',
    '  alpha:',
    '    tier: active-default',
    '    preferred_for:',
    '      - alpha audit workflow',
    '  beta:',
    '    tier: active-default',
    '    preferred_for:',
    '      - beta migration workflow',
    ''
  ].join('\n');
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), policyText);
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['scan'], cwd);
  return { cwd, root, policyText };
}

test('policy v2 migration is explicit, preserves exact v1 rollback bytes, and never auto-maps duplicates', () => {
  const { cwd, root, policyText } = policyProject();
  const rootBefore = readFileSync(path.join(root, 'alpha-one/SKILL.md'), 'utf8');
  const inventoryBefore = readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8');

  const preview = JSON.parse(run(['policy', 'migrate', '--dry-run', '--json'], cwd));
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.unresolvedNames, ['alpha']);
  assert.equal(preview.mappedSkills, 1);
  assert.equal(existsSync(path.join(cwd, '.skillmap/policies/active.json')), false);
  assert.equal(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'), inventoryBefore);

  const migrated = JSON.parse(run(['policy', 'migrate', '--confirm', '--json'], cwd));
  assert.equal(migrated.dryRun, false);
  assert.equal(migrated.policy.version, 2);
  assert.deepEqual(migrated.policy.migration.unresolvedNames, ['alpha']);
  assert.equal(Object.keys(migrated.policy.skillsById).length, 1);
  assert.deepEqual(migrated.policy.canonicalByName, {});
  assert.deepEqual(migrated.policy.duplicateDecisions, {});
  assert.equal(readFileSync(migrated.rollbackArtifact, 'utf8'), policyText);
  assert.equal(readFileSync(path.join(cwd, '.skillmap/policy.yml'), 'utf8'), policyText);
  assert.equal(readFileSync(path.join(root, 'alpha-one/SKILL.md'), 'utf8'), rootBefore);

  const active = JSON.parse(run(['policy', 'status', '--json'], cwd));
  assert.equal(active.activePolicyVersion, 2);
  assert.deepEqual(active.unresolvedNames, ['alpha']);
});

test('canonical decisions are hash-bound, shadow implicit routing, default-deny unconfigured shadows, and invalidate on edits', () => {
  const { cwd, root } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const variants = inventory.skills.filter((skill) => skill.name === 'alpha');
  assert.equal(variants.length, 2);

  run(['apply-policy'], cwd);
  let effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  assert.deepEqual(effective.skills.filter((skill) => skill.name === 'alpha').map((skill) => skill.variantState), [
    'unresolved-duplicate',
    'unresolved-duplicate'
  ]);
  assert.equal(effective.skills.some((skill) => skill.name === 'alpha' && skill.routeEligible), false);

  const selected = variants[0];
  const shadow = variants[1];
  const decision = JSON.parse(run([
    'policy',
    'select-canonical',
    'alpha',
    '--skill-id',
    selected.skillId,
    '--actor',
    'fixture-reviewer',
    '--reason',
    'Reviewed both variants and selected the maintained implementation.',
    '--confirm',
    '--json'
  ], cwd));
  assert.equal(decision.decision.selectedSkillId, selected.skillId);
  assert.match(decision.decision.decisionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(decision.decision.comparedVariants.length, 2);
  const selectedPolicy = JSON.parse(readFileSync(decision.policyArtifact, 'utf8'));
  assert.equal(Object.hasOwn(selectedPolicy.migration.unresolvedEntries, 'alpha'), false);

  run(['apply-policy'], cwd);
  effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  const selectedEffective = effective.skills.find((skill) => skill.skillId === selected.skillId);
  const shadowEffective = effective.skills.find((skill) => skill.skillId === shadow.skillId);
  assert.equal(selectedEffective.variantState, 'canonical');
  assert.equal(selectedEffective.routeEligible, true);
  assert.equal(shadowEffective.variantState, 'shadowed-duplicate');
  assert.equal(shadowEffective.routeEligible, false);

  const implicit = JSON.parse(run(['route', 'alpha audit workflow', '--json'], cwd));
  assert.equal(implicit.decision.recommendations[0].skillId, selected.skillId);
  assert.equal(implicit.decision.recommendations.some((item) => item.skillId === shadow.skillId), false);

  const qualified = JSON.parse(run(['route', 'use the reviewed qualified variant', '--skill-id', shadow.skillId, '--json'], cwd));
  assert.equal(qualified.decision.recommendations.some((item) => item.skillId === shadow.skillId), false);
  assert.ok(qualified.decision.exclusions.some((item) => item.skillId === shadow.skillId && item.reasonCode === 'qualified-invocation-blocked'));

  mkdirSync(path.join(root, 'alpha-one/references'), { recursive: true });
  writeFileSync(path.join(root, 'alpha-one/references/security.md'), 'changed security-relevant content\n');
  run(['scan'], cwd);
  run(['apply-policy'], cwd);
  effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  assert.equal(effective.skills.some((skill) => skill.name === 'alpha' && skill.routeEligible), false);
  assert.ok(effective.skills.filter((skill) => skill.name === 'alpha').every((skill) => skill.variantState === 'unresolved-duplicate'));
});

test('policy rollback changes only the active pointer and restores v1 dual-read semantics', () => {
  const { cwd, policyText } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  const rolledBack = JSON.parse(run(['policy', 'rollback', '--confirm', '--json'], cwd));
  assert.equal(rolledBack.activePolicyVersion, 1);
  assert.equal(readFileSync(rolledBack.rollbackArtifact, 'utf8'), policyText);
  assert.equal(readFileSync(path.join(cwd, '.skillmap/policy.yml'), 'utf8'), policyText);

  run(['apply-policy'], cwd);
  const effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  assert.equal(effective.policy.version, 1);
  assert.equal(effective.skills.find((skill) => skill.name === 'beta').tier, 'active-default');
  assert.ok(effective.skills.filter((skill) => skill.name === 'alpha').every((skill) => skill.routeEligible === false));
  const alphaIds = new Set(effective.skills.filter((skill) => skill.name === 'alpha').map((skill) => `skill:${skill.skillId}`));
  assert.equal(effective.graph.edges.some((edge) => alphaIds.has(edge.from) && edge.source === 'policy'), false);

  const remigrated = JSON.parse(run(['policy', 'migrate', '--confirm', '--json'], cwd));
  assert.equal(remigrated.pointer.activePolicyVersion, 2);
  assert.ok(existsSync(remigrated.policyArtifact));
});

test('rollback invalidates routing approval until policy reapplication and all consumers then agree', () => {
  const { cwd } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const canonical = inventory.skills.find((skill) => skill.name === 'alpha');
  run(['policy', 'select-canonical', 'alpha', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed both variants for stale-consumer parity coverage.', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  assert.ok(JSON.parse(run(['route', 'alpha audit workflow', '--json'], cwd)).decision.recommendations.length > 0);
  run(['policy', 'rollback', '--confirm'], cwd);

  assert.match(runFailure(['route', 'alpha audit workflow', '--json'], cwd), /current canonical or raw routing state differs from the last explicitly approved revision/i);
  const staleStatus = JSON.parse(run(['status', '--json'], cwd)).status;
  assert.deepEqual(staleStatus.policy.invalidCanonicalDecisions, ['alpha']);
  assert.equal(staleStatus.policy.duplicateInventoryNameGroups.length, 1);

  const safeFile = path.join(cwd, 'rollback-safe.json');
  run(['export', '--output', safeFile], cwd);
  const safe = JSON.parse(readFileSync(safeFile, 'utf8'));
  assert.ok(safe.payload.skills.filter((skill) => skill.displayName === 'alpha').every((skill) => skill.routeEligible === false));

  const dashboardFile = path.join(cwd, 'rollback-dashboard.json');
  run(['export', '--dashboard-snapshot', '--redact-paths', '--output', dashboardFile], cwd);
  const dashboard = JSON.parse(readFileSync(dashboardFile, 'utf8'));
  assert.ok(dashboard.skills.filter((skill) => skill.name === 'alpha').every((skill) => skill.routeEligible === false));

  assert.match(runFailure(['graph', 'effective', '--json'], cwd), /current canonical or raw routing state differs from the last explicitly approved revision/i);
  assert.match(runFailure(['mcp', 'call', 'show_skillgraph', '--json'], cwd), /current canonical or raw routing state differs from the last explicitly approved revision/i);

  const evalFile = path.join(cwd, 'rollback-eval.json');
  writeFileSync(evalFile, `${JSON.stringify({ version: 1, evals: [{ prompt: 'alpha audit workflow', expected: ['alpha'], avoid: [] }] }, null, 2)}\n`);
  assert.match(runFailure(['eval', '--file', evalFile, '--json'], cwd), /current canonical or raw routing state differs from the last explicitly approved revision/i);

  run(['policy', 'migrate', '--confirm'], cwd);
  run(['policy', 'select-canonical', 'alpha', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Re-approved the reviewed alpha variant after the explicit policy rollback.', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  assert.equal(JSON.parse(run(['route', 'alpha audit workflow', '--json'], cwd)).decision.recommendations[0].skillId, canonical.skillId);
  const status = JSON.parse(run(['status', '--json'], cwd)).status;
  assert.equal(status.effective.stale, false);

  const effectiveGraph = JSON.parse(run(['graph', 'effective', '--json'], cwd)).graph;
  assert.equal(effectiveGraph.nodes.some((node) => node.type === 'skill' && node.label === 'alpha'), true);
  const mcpGraph = JSON.parse(run(['mcp', 'call', 'show_skillgraph', '--json'], cwd));
  assert.equal(mcpGraph.data.graph.items.some((item) => item.kind === 'node' && item.type === 'skill' && item.label === 'alpha'), true);

  const evaluated = JSON.parse(run(['eval', '--file', evalFile, '--json'], cwd));
  assert.equal(evaluated.rows[0].recommended.includes('alpha'), true);
  assert.notEqual(evaluated.effectiveRevisionDigest, status.artifacts.effective.hash);
});

test('mechanical v2 migration preserves the curation chain and advances the documented workflow', () => {
  const { cwd, policyText } = policyProject();
  run(['doctor'], cwd);
  run(['doctor-pack', '--summary'], cwd);
  const proposals = path.join(cwd, '.skillmap/proposals');
  mkdirSync(proposals, { recursive: true });
  const proposal = path.join(proposals, 'policy.yml');
  const rationale = path.join(proposals, 'policy-rationale.md');
  writeFileSync(proposal, policyText);
  writeFileSync(rationale, '# Rationale\n\nReviewed fixture policy before qualified migration.\n');
  run(['curate', 'codex', '--ingest', proposal, '--rationale', rationale, '--model', 'fixture-model', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const canonical = inventory.skills.find((skill) => skill.name === 'alpha');
  run(['policy', 'migrate', '--confirm'], cwd);
  run(['policy', 'select-canonical', 'alpha', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Compared both alpha variants after curated v1 migration.', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  run(['graph', 'build'], cwd);
  const status = JSON.parse(run(['status', '--json'], cwd)).status;
  assert.equal(status.curation.stale, false);
  assert.equal(status.readinessPhase, 'needs-sources');
});

test('policy v2 denies new unique identities until an exact reviewed entry exists', () => {
  const { cwd, root } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  writeSkill(root, 'gamma', 'gamma', 'A newly observed unique identity without a reviewed policy entry.');
  run(['scan'], cwd);
  run(['apply-policy'], cwd);
  const effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  const gamma = effective.skills.find((skill) => skill.name === 'gamma');
  assert.equal(gamma.routeEligible, false);
  assert.equal(gamma.qualifiedExplicitAllowed, false);
  assert.match(gamma.effectiveReasons.join('\n'), /no reviewed policy v2 entry/);
});

test('adopting a moved unconfigured shadow preserves exact-entry absence and qualified denial', () => {
  const { cwd, root } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const variants = inventory.skills.filter((skill) => skill.name === 'alpha');
  const canonical = variants[0];
  const shadow = variants[1];
  run(['policy', 'select-canonical', 'alpha', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed both variants and selected the maintained canonical implementation.', '--confirm'], cwd);
  renameSync(path.join(root, shadow.relativePath), path.join(root, 'moved-shadow'));
  const movedInventory = JSON.parse(run(['scan', '--json'], cwd)).inventory;
  const moved = movedInventory.skills.find((skill) => skill.relativePath === 'moved-shadow');
  const adopted = JSON.parse(run(['identity', 'adopt-move', '--from', shadow.skillId, '--to', moved.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed the shadow filesystem move without granting invocation rights.', '--confirm', '--json'], cwd));
  const policy = JSON.parse(readFileSync(adopted.policyArtifact, 'utf8'));
  assert.equal(Object.hasOwn(policy.skillsById, shadow.skillId), false);
  assert.equal(Object.hasOwn(policy.skillsById, moved.skillId), false);
  run(['apply-policy'], cwd);
  const effective = JSON.parse(readFileSync(path.join(cwd, '.skillmap/effective.json'), 'utf8'));
  const movedEffective = effective.skills.find((skill) => skill.skillId === moved.skillId);
  assert.equal(movedEffective.routeEligible, false);
  assert.equal(movedEffective.qualifiedExplicitAllowed, false);
});

test('adopting a moved identity preserves an independently reviewed target-specific policy entry', () => {
  const { cwd, root } = policyProject();
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const variants = inventory.skills.filter((skill) => skill.name === 'alpha');
  const canonical = variants[0];
  const shadow = variants[1];
  run(['policy', 'select-canonical', 'alpha', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Reviewed both variants for target-entry preservation coverage.', '--confirm'], cwd);
  renameSync(path.join(root, shadow.relativePath), path.join(root, 'target-reviewed-shadow'));
  const moved = JSON.parse(run(['scan', '--json'], cwd)).inventory.skills.find((skill) => skill.relativePath === 'target-reviewed-shadow');
  const pointer = JSON.parse(readFileSync(path.join(cwd, '.skillmap/policies/active.json'), 'utf8'));
  const activeFile = path.join(cwd, '.skillmap', pointer.policyPath);
  const active = JSON.parse(readFileSync(activeFile, 'utf8'));
  active.skillsById[moved.skillId] = { tier: 'explicit-only', notes: 'Independently reviewed target entry.' };
  writeFileSync(activeFile, `${JSON.stringify(active, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  const adopted = JSON.parse(run(['identity', 'adopt-move', '--from', shadow.skillId, '--to', moved.skillId, '--actor', 'fixture-reviewer', '--reason', 'Confirmed the move while preserving the independently reviewed target policy.', '--confirm', '--json'], cwd));
  const policy = JSON.parse(readFileSync(adopted.policyArtifact, 'utf8'));
  assert.equal(policy.skillsById[moved.skillId].tier, 'explicit-only');
  assert.equal(policy.skillsById[moved.skillId].notes, 'Independently reviewed target entry.');
});

test('policy name dictionaries safely preserve prototype-like skill names without pollution', async () => {
  const { parsePolicyYaml, validatePolicy } = await import('../dist/core/policy.js');
  const { canonicalJson } = await import('../dist/core/policy-state.js');
  const policy = validatePolicy(parsePolicyYaml([
    'version: 1',
    'skills:',
    '  __proto__:',
    '    tier: blocked',
    '  constructor:',
    '    tier: specialist',
    '  prototype:',
    '    tier: explicit-only',
    ''
  ].join('\n')));
  assert.deepEqual(Object.keys(policy.skills).sort(), ['__proto__', 'constructor', 'prototype']);
  assert.equal(policy.skills.__proto__.tier, 'blocked');
  assert.equal(policy.skills.constructor.tier, 'specialist');
  assert.equal(({}).tier, undefined);
  const protoOne = JSON.parse('{"__proto__":{"value":1}}');
  const protoTwo = JSON.parse('{"__proto__":{"value":2}}');
  assert.match(canonicalJson(protoOne), /"__proto__"/);
  assert.notEqual(canonicalJson(protoOne), canonicalJson(protoTwo));
});

test('policy v2 validation rejects unknown fields and non-string family or notes before routing', async () => {
  const { cwd } = policyProject();
  const migrated = JSON.parse(run(['policy', 'migrate', '--confirm', '--json'], cwd)).policy;
  const { validatePolicyV2 } = await import('../dist/core/policy-state.js');
  const skillId = Object.keys(migrated.skillsById)[0];
  const unknown = structuredClone(migrated);
  unknown.skillsById[skillId].untrustedControl = true;
  assert.throws(() => validatePolicyV2(unknown), /unknown field/);
  const badFamily = structuredClone(migrated);
  badFamily.skillsById[skillId].family = { nested: 'not a string' };
  assert.throws(() => validatePolicyV2(badFamily), /family must be a string/);
  const badNotes = structuredClone(migrated);
  badNotes.skillsById[skillId].notes = 42;
  assert.throws(() => validatePolicyV2(badNotes), /notes must be a string/);
});

function runFailure(args, cwd) {
  try {
    run(args, cwd);
  } catch (error) {
    return `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
  }
  assert.fail(`Expected command to fail: ${args.join(' ')}`);
}
