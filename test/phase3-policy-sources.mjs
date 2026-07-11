import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPolicyCommand } from '../dist/commands/apply-policy.js';
import { policyCommand } from '../dist/commands/policy.js';
import { scanCommand } from '../dist/commands/scan.js';
import { classifyExternalSourceState, sourcesCommand } from '../dist/commands/sources.js';
import { buildApprovedStatus } from '../dist/services/status-use-case.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { buildPolicyReviewQueue, retireUnmatchedPolicyEntry, setReviewedSkillPolicy } from '../dist/core/policy-reviews.js';
import { assertEndpointPayload } from '../assets/local-app/v1/modules/api.js';

const COMMIT = 'a'.repeat(40);
const ROOT_TREE = '1'.repeat(40);
const SKILLS_TREE = '2'.repeat(40);
const SKILL_TREE = '3'.repeat(40);

test('external source state keeps local drift separate from upstream staleness and risk', () => {
  const baseline = {
    localModified: false,
    adoptedContentRevision: `sha256:${'1'.repeat(64)}`,
    adoptedUpstreamContentRevision: `sha256:${'1'.repeat(64)}`,
    installedManifestDigest: `sha256:${'2'.repeat(64)}`,
    currentManifestDigest: `sha256:${'2'.repeat(64)}`,
    risky: false
  };
  assert.equal(classifyExternalSourceState(baseline), 'external-clean');
  assert.equal(classifyExternalSourceState({ ...baseline, currentManifestDigest: `sha256:${'3'.repeat(64)}` }), 'external-stale');
  assert.equal(classifyExternalSourceState({ ...baseline, currentManifestDigest: `sha256:${'3'.repeat(64)}`, risky: true }), 'external-risky-update');
  assert.equal(classifyExternalSourceState({ ...baseline, localModified: true }), 'external-modified');
  assert.equal(classifyExternalSourceState({ ...baseline, adoptedContentRevision: `sha256:${'4'.repeat(64)}` }), 'external-modified');
});

async function approvedWorkspace(t, options = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-policy-sources-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'skills');
  const skillFile = path.join(root, 'alpha', 'SKILL.md');
  mkdirSync(path.dirname(skillFile), { recursive: true });
  writeFileSync(skillFile, '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n\nLocal guidance.\n');
  const backend = new SkillMapLocalBackend(cwd, options);
  const validation = await backend.validateRoot({ candidate: root });
  const initialized = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  await scanCommand(cwd, {});
  const scanned = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: initialized.revision.revisionId, approveForRouting: false });
  await applyPolicyCommand(cwd, {});
  const approved = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: scanned.pointer.revisionId, approveForRouting: true });
  const sources = await backend.sources();
  assert.equal(sources.untrackedItems.length, 1);
  return { cwd, root, skillFile, backend, revisionId: approved.pointer.revisionId, skillId: sources.untrackedItems[0].skillId };
}

test('policy preview is an exact-revision external dry-run with truthful summaries and no workspace writes', async (t) => {
  const fixture = await approvedWorkspace(t);
  const before = directoryDigest(fixture.cwd);
  const preview = await fixture.backend.previewPolicy({ expectedRevision: fixture.revisionId, confirmation: 'review' });
  assert.deepEqual(Object.keys(preview).sort(), ['currentPresent', 'currentSummary', 'delta', 'projectedSummary', 'revision', 'routingApprovalEligible', 'state', 'warnings', 'wouldPublish']);
  assert.equal(preview.state, 'previewed');
  assert.equal(preview.revision.revisionId, fixture.revisionId);
  assert.equal(preview.wouldPublish, false);
  assert.equal(preview.currentPresent, true);
  assert.equal(preview.currentSummary.skills, 1);
  assert.equal(preview.projectedSummary.skills, 1);
  assert.equal(preview.warnings.every((warning) => /^[A-Z][A-Z0-9_]{0,63}$/.test(warning)), true);
  assert.equal(directoryDigest(fixture.cwd), before);
  await assert.rejects(
    fixture.backend.previewPolicy({ expectedRevision: `r${'9'.repeat(20)}-99999999-9999-4999-8999-999999999999`, confirmation: 'review' }),
    (error) => error?.code === 'STATE_CONFLICT'
  );
});

test('policy preview supports first-run inventory and policy state before effective.json exists', async (t) => {
  const fixture = await approvedWorkspace(t);
  for (const relative of ['effective.json', 'graph.effective.json', 'graph.effective.mmd']) {
    rmSync(path.join(fixture.cwd, '.skillmap', relative), { force: true });
  }
  const store = WorkspaceStateStore.open(fixture.cwd);
  const publication = await store.publishLegacySnapshot({
    expectedRevisionId: fixture.revisionId,
    actor: 'test-policy-preview',
    reason: 'Prepared inventory and policy without a current effective projection.'
  });
  const before = directoryDigest(fixture.cwd);
  const preview = await fixture.backend.previewPolicy({ expectedRevision: publication.pointer.revisionId, confirmation: 'review' });
  assert.deepEqual(preview.currentSummary, { skills: 0, routeEligible: 0, edges: 0 });
  assert.equal(preview.currentPresent, false);
  assert.equal(preview.projectedSummary.skills, 1);
  assert.equal(preview.wouldPublish, false);
  assert.equal(directoryDigest(fixture.cwd), before);
});

test('policy review queue exposes uncovered skills and persists revision-bound hold and accept receipts', async (t) => {
  const fixture = await approvedWorkspace(t);
  await policyCommand(fixture.cwd, ['migrate'], { confirm: true });
  const migrated = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revisionId,
    actor: 'test-policy-migration',
    reason: 'Activated policy v2 for the actionable review workflow.'
  });

  const initial = await fixture.backend.policyReviews();
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/reviews', initial));
  const producedWorkspace = await fixture.backend.workspace();
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/workspace', producedWorkspace));
  assert.equal(initial.policyVersion, 2);
  assert.equal(initial.actionable, 1);
  assert.equal(initial.blocking, 1);
  const uncovered = initial.items.find((item) => item.queue === 'uncovered');
  assert.ok(uncovered, 'the unique inventory skill without a v2 entry must be actionable');
  assert.equal(uncovered.action, 'set-skill-policy');
  assert.equal(uncovered.skillIds[0], fixture.skillId);
  assert.equal(uncovered.blocking, true);
  assert.match(uncovered.reviewId, /^pr_[a-f0-9]{40}$/);

  const beforeProposal = directoryDigest(fixture.cwd);
  const heldProposal = await fixture.backend.proposePolicy({
    reviewId: uncovered.reviewId,
    action: 'set-skill-policy',
    skillId: fixture.skillId,
    tier: 'specialist',
    actor: 'local-operator',
    reason: 'Reviewed the exact qualified identity but intentionally held it for another pass.',
    expectedRevision: migrated.pointer.revisionId
  });
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/proposals', heldProposal, 'POST'));
  assert.equal(heldProposal.wouldPublish, false);
  assert.deepEqual(heldProposal.decisionOptions, ['accept', 'hold', 'reject']);
  assert.equal(directoryDigest(fixture.cwd), beforeProposal, 'proposal creation must be read-only');

  const held = await fixture.backend.decidePolicyReview({
    proposalId: heldProposal.proposalId,
    proposalDigest: heldProposal.proposalDigest,
    decision: 'hold',
    expectedRevision: migrated.pointer.revisionId,
    confirmation: 'review'
  });
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/decisions', held, 'POST'));
  assert.equal(held.policyChanged, false);
  assert.equal(held.decision, 'hold');
  assert.match(held.decisionDigest, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(
    fixture.backend.decidePolicyReview({
      proposalId: heldProposal.proposalId,
      proposalDigest: heldProposal.proposalDigest,
      decision: 'accept',
      expectedRevision: migrated.pointer.revisionId,
      confirmation: 'review'
    }),
    (error) => error?.code === 'POLICY_PROPOSAL_INVALID'
  );

  const afterHold = await fixture.backend.policyReviews();
  const stillUncovered = afterHold.items.find((item) => item.queue === 'uncovered');
  assert.ok(stillUncovered, 'hold must truthfully leave readiness blocking');
  const acceptedProposal = await fixture.backend.proposePolicy({
    reviewId: stillUncovered.reviewId,
    action: 'set-skill-policy',
    skillId: fixture.skillId,
    tier: 'specialist',
    actor: 'local-operator',
    reason: 'Reviewed the exact qualified identity and approved the bounded specialist tier.',
    expectedRevision: held.revision.revisionId
  });
  const accepted = await fixture.backend.decidePolicyReview({
    proposalId: acceptedProposal.proposalId,
    proposalDigest: acceptedProposal.proposalDigest,
    decision: 'accept',
    expectedRevision: held.revision.revisionId,
    confirmation: 'review'
  });
  assert.equal(accepted.policyChanged, true);
  assert.equal(accepted.decision, 'accept');
  const afterAccept = await fixture.backend.policyReviews();
  assert.equal(afterAccept.items.some((item) => item.queue === 'uncovered'), false);
  assert.equal(afterAccept.actionable, 0);

  const reviewDir = path.join(fixture.cwd, '.skillmap', 'policies', 'reviews');
  const receipts = readdirSync(reviewDir).map((file) => JSON.parse(readFileSync(path.join(reviewDir, file), 'utf8')));
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.decision).sort(), ['accept', 'hold']);
  assert.equal(receipts.every((receipt) => receipt.expectedRevision && /^sha256:[a-f0-9]{64}$/.test(receipt.decisionDigest)), true);
  assert.equal(receipts.every((receipt) => !String(receipt.reason).includes('/')), true);
});

test('policy queue derives all five honest queue classes and retires only stale entries', async (t) => {
  const fixture = await approvedWorkspace(t);
  await policyCommand(fixture.cwd, ['migrate'], { confirm: true });
  const inventory = JSON.parse(readFileSync(path.join(fixture.cwd, '.skillmap', 'inventory.json'), 'utf8'));
  const pointer = JSON.parse(readFileSync(path.join(fixture.cwd, '.skillmap', 'policies', 'active.json'), 'utf8'));
  const activePolicy = JSON.parse(readFileSync(path.join(fixture.cwd, '.skillmap', pointer.policyPath), 'utf8'));

  assert.deepEqual(buildPolicyReviewQueue(inventory, activePolicy).map((item) => item.queue), ['uncovered']);
  const explicit = setReviewedSkillPolicy(activePolicy, inventory, fixture.skillId, 'explicit-only');
  assert.deepEqual(buildPolicyReviewQueue(inventory, explicit).map((item) => item.queue), ['explicit-only']);
  assert.equal(buildPolicyReviewQueue(inventory, explicit)[0].blocking, false);
  const blocked = setReviewedSkillPolicy(activePolicy, inventory, fixture.skillId, 'blocked');
  assert.deepEqual(buildPolicyReviewQueue(inventory, blocked).map((item) => item.queue), ['blocked']);
  assert.equal(buildPolicyReviewQueue(inventory, blocked)[0].blocking, false);

  const staleSkillId = `sk_${'Z'.repeat(43)}`;
  const stale = JSON.parse(JSON.stringify(explicit));
  stale.skillsById[staleSkillId] = { tier: 'specialist' };
  assert.deepEqual(buildPolicyReviewQueue(inventory, stale).map((item) => item.queue).sort(), ['explicit-only', 'unmatched']);
  const retired = retireUnmatchedPolicyEntry(stale, inventory, staleSkillId);
  assert.equal(Object.hasOwn(retired.skillsById, staleSkillId), false);
  assert.throws(() => retireUnmatchedPolicyEntry(explicit, inventory, fixture.skillId), /current policy entry cannot be retired/);

  const duplicateInventory = JSON.parse(JSON.stringify(inventory));
  duplicateInventory.skills.push({ ...duplicateInventory.skills[0], skillId: `sk_${'Y'.repeat(43)}`, contentRevision: `sha256:${'9'.repeat(64)}`, path: `${duplicateInventory.skills[0].path}-variant` });
  const duplicateQueues = buildPolicyReviewQueue(duplicateInventory, explicit).map((item) => item.queue);
  assert.equal(duplicateQueues.includes('duplicate'), true);
});

test('source adoption is deferred for GitHub, revisioned but unapproved, immediately visible, and never mutates roots', async (t) => {
  let networkCalls = 0;
  const fixture = await approvedWorkspace(t, { sourceFetcherOptions: { transport: async () => { networkCalls += 1; throw new Error('network must not run during adoption'); } } });
  const configBefore = readFileSync(path.join(fixture.cwd, '.skillmap', 'config.yml'), 'utf8');
  const skillBefore = readFileSync(fixture.skillFile, 'utf8');
  const local = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'local', reason: 'Reviewed local authorship for this qualified skill.',
    expectedRevision: fixture.revisionId, confirm: true
  });
  assert.deepEqual(Object.keys(local).sort(), ['adoptionDigest', 'nextAction', 'revision', 'routingApprovalRequired', 'skillId', 'sourceType', 'state']);
  assert.equal(local.routingApprovalRequired, true);
  assert.equal(local.nextAction, 'sources-check');
  assert.match(local.adoptionDigest, /^sha256:[a-f0-9]{64}$/);
  const afterLocal = await fixture.backend.sources();
  assert.equal(afterLocal.trackedSkills, 1);
  assert.equal(afterLocal.untrackedTotal, 0);
  assert.equal(afterLocal.untrackedTruncated, false);
  assert.equal(afterLocal.coverage, 'partial');
  assert.equal(afterLocal.items.length, 1);
  assert.deepEqual(
    { sourceType: afterLocal.items[0].sourceType, state: afterLocal.items[0].state, checked: afterLocal.items[0].checked, reviewable: afterLocal.items[0].reviewable },
    { sourceType: 'local', state: 'local-authored', checked: false, reviewable: false }
  );

  await sourcesCommand(fixture.cwd, ['check'], {});
  const checkedPublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: local.revision.revisionId,
    actor: 'test-source-check',
    reason: 'Recorded a checked local source state before re-adoption.'
  });
  const checkedLocal = await fixture.backend.sources();
  assert.deepEqual(
    { sourceType: checkedLocal.items[0].sourceType, state: checkedLocal.items[0].state, checked: checkedLocal.items[0].checked, reviewable: checkedLocal.items[0].reviewable },
    { sourceType: 'local', state: 'local-authored', checked: true, reviewable: false }
  );

  const github = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'feature/source-v2',
    expectedRevision: checkedPublication.pointer.revisionId, confirm: true
  });
  assert.equal(github.sourceType, 'github');
  assert.equal(networkCalls, 0);
  const afterGithub = await fixture.backend.sources();
  assert.equal(afterGithub.items.length, 1);
  assert.deepEqual(
    { sourceType: afterGithub.items[0].sourceType, state: afterGithub.items[0].state, checked: afterGithub.items[0].checked, reviewable: afterGithub.items[0].reviewable, upstreamCommit: afterGithub.items[0].upstreamCommit },
    { sourceType: 'github', state: 'unknown', checked: false, reviewable: false, upstreamCommit: null }
  );
  const persisted = JSON.parse(readFileSync(path.join(fixture.cwd, '.skillmap', 'sources.json'), 'utf8'));
  assert.equal(persisted.records[0].source.repo, 'owner/repo');
  assert.equal(persisted.records[0].source.path, 'skills/demo');
  assert.equal(persisted.records[0].source.ref, 'feature/source-v2');
  assert.equal(persisted.records[0].source.resolvedCommit, undefined);
  assert.equal(readFileSync(path.join(fixture.cwd, '.skillmap', 'config.yml'), 'utf8'), configBefore);
  assert.equal(readFileSync(fixture.skillFile, 'utf8'), skillBefore);
  await assert.rejects(
    fixture.backend.adoptSource({ skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: '../escape', ref: 'main', expectedRevision: github.revision.revisionId, confirm: true }),
    (error) => error?.code === 'INVALID_SUBTREE'
  );
});

test('source diff resolves one immutable snapshot, returns bounded local-only lines, and leaves workspace bytes unchanged', async (t) => {
  const transport = githubFixtureTransport({ 'SKILL.md': '---\nname: alpha\ndescription: Upstream alpha guidance.\n---\n# Alpha\n\nUpstream guidance.\n' });
  const fixture = await approvedWorkspace(t, { sourceFetcherOptions: { transport: transport.transport, maxRetries: 0 } });
  const adopted = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'main',
    expectedRevision: fixture.revisionId, confirm: true
  });
  const before = directoryDigest(fixture.cwd);
  const receipt = await fixture.backend.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId });
  assert.deepEqual(Object.keys(receipt).sort(), ['diff', 'persisted', 'promptStored', 'revision', 'risk', 'skillId', 'state', 'upstreamCommit']);
  assert.deepEqual(Object.keys(receipt.diff).sort(), ['additions', 'changedLines', 'deletions', 'lines', 'truncated']);
  assert.equal(receipt.skillId, fixture.skillId);
  assert.equal(receipt.upstreamCommit, COMMIT);
  assert.equal(receipt.revision.revisionId, adopted.revision.revisionId);
  assert.equal(receipt.promptStored, false);
  assert.equal(receipt.persisted, false);
  assert.equal(receipt.diff.lines.length <= 120, true);
  assert.equal(receipt.diff.lines.every((line) => ['local', 'upstream'].includes(line.kind) && line.text.length <= 500), true);
  assert.equal(transport.commitRequests, 1, 'one diff must resolve a mutable ref only once');
  assert.equal(directoryDigest(fixture.cwd), before);
});

test('source diff propagates cancellation and timeout and rejects revision skew after an in-flight operation', async (t) => {
  const initial = githubFixtureTransport({ 'SKILL.md': '# Upstream\n' });
  const fixture = await approvedWorkspace(t, { sourceFetcherOptions: { transport: initial.transport, maxRetries: 0 } });
  const adopted = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'main',
    expectedRevision: fixture.revisionId, confirm: true
  });

  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const hangingTransport = async () => { enteredResolve(); return new Promise(() => {}); };
  const cancellable = new SkillMapLocalBackend(fixture.cwd, { sourceFetcherOptions: { transport: hangingTransport, maxRetries: 0 } });
  const controller = new AbortController();
  const pending = cancellable.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId }, { signal: controller.signal });
  await entered;
  controller.abort();
  await assert.rejects(pending, (error) => error?.code === 'REQUEST_ABORTED');

  const timed = new SkillMapLocalBackend(fixture.cwd, { sourceFetcherOptions: { transport: async () => new Promise(() => {}), timeoutMs: 5, maxRetries: 0 } });
  await assert.rejects(
    timed.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId }),
    (error) => error?.code === 'REQUEST_TIMEOUT'
  );

  let releaseResolve;
  let operationEnteredResolve;
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const operationEntered = new Promise((resolve) => { operationEnteredResolve = resolve; });
  const runner = async () => {
    operationEnteredResolve();
    await release;
    return { record: { state: 'external-clean', risk: 'low', upstreamCommit: COMMIT }, diff: { additions: 0, deletions: 0, changedLines: 0, truncated: false, lines: [] } };
  };
  const skewed = new SkillMapLocalBackend(fixture.cwd, { sourceCommandRunner: runner });
  const skewedPromise = skewed.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId });
  await operationEntered;
  const store = WorkspaceStateStore.open(fixture.cwd);
  await store.publishLegacySnapshot({ expectedRevisionId: adopted.revision.revisionId, actor: 'test-source-skew', reason: 'Advanced revision during source diff.' });
  releaseResolve();
  await assert.rejects(skewedPromise, (error) => error?.code === 'STATE_CONFLICT');
  assert.equal(readFileSync(fixture.skillFile, 'utf8').includes('Local guidance.'), true);
});

test('source diff rejects a canonical source record redirected outside its approved inventory root before network', async (t) => {
  let networkCalls = 0;
  const fixture = await approvedWorkspace(t, { sourceFetcherOptions: { transport: async () => { networkCalls += 1; throw new Error('network must not run'); }, maxRetries: 0 } });
  const adopted = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'main',
    expectedRevision: fixture.revisionId, confirm: true
  });
  const outside = path.join(fixture.cwd, 'outside-private.md');
  writeFileSync(outside, 'PRIVATE_CANARY_OUTSIDE_APPROVED_ROOT\n');
  const sourcePath = path.join(fixture.cwd, '.skillmap', 'sources.json');
  const sources = JSON.parse(readFileSync(sourcePath, 'utf8'));
  sources.records[0].localPath = outside;
  writeFileSync(sourcePath, `${JSON.stringify(sources, null, 2)}\n`);
  const publication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: adopted.revision.revisionId,
    actor: 'test-source-binding',
    reason: 'Prepared a malicious source binding regression.'
  });
  await assert.rejects(
    fixture.backend.sourceDiff({ skillId: fixture.skillId, expectedRevision: publication.pointer.revisionId }),
    (error) => error?.code === 'SOURCE_BINDING_INVALID'
  );
  assert.equal(networkCalls, 0);
});

test('source diff rejects a symlink swap and an in-flight approved-tree change without returning local lines', async (t) => {
  if (process.platform === 'win32') return t.skip('File-symlink creation is not reliable on standard Windows CI runners.');
  const transport = githubFixtureTransport({ 'SKILL.md': '# Upstream\n' });
  const fixture = await approvedWorkspace(t, { sourceFetcherOptions: { transport: transport.transport, maxRetries: 0 } });
  const adopted = await fixture.backend.adoptSource({
    skillId: fixture.skillId, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'main',
    expectedRevision: fixture.revisionId, confirm: true
  });
  const outside = path.join(fixture.cwd, 'outside-symlink-target.md');
  writeFileSync(outside, 'PRIVATE_CANARY_SYMLINK_TARGET\n');
  rmSync(fixture.skillFile);
  symlinkSync(outside, fixture.skillFile, 'file');
  await assert.rejects(
    fixture.backend.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId }),
    (error) => error?.code === 'SOURCE_BINDING_INVALID' || error?.code === 'SOURCE_LOCAL_CHANGED'
  );

  rmSync(fixture.skillFile);
  writeFileSync(fixture.skillFile, '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n\nLocal guidance.\n');
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const raced = new SkillMapLocalBackend(fixture.cwd, { sourceCommandRunner: async () => {
    enteredResolve();
    await release;
    return { record: { state: 'external-clean', risk: 'low', upstreamCommit: COMMIT }, diff: { additions: 0, deletions: 0, changedLines: 0, truncated: false, lines: [] } };
  } });
  const pending = raced.sourceDiff({ skillId: fixture.skillId, expectedRevision: adopted.revision.revisionId });
  await entered;
  writeFileSync(fixture.skillFile, '# Changed during source diff\n');
  releaseResolve();
  await assert.rejects(pending, (error) => error?.code === 'SOURCE_LOCAL_CHANGED');
});

test('dashboard evidence exposes truthful resumable inventory, doctor, pack, and curation state', async (t) => {
  const fixture = await approvedWorkspace(t);
  const { status } = await buildApprovedStatus(fixture.cwd);
  const dashboard = await fixture.backend.dashboard();
  assert.equal(dashboard.evidence.inventorySkills, status.inventory?.skills ?? 0);
  assert.equal(dashboard.evidence.doctorPresent, status.artifacts.doctor?.present === true);
  assert.equal(dashboard.evidence.doctorPackPresent, status.artifacts.doctorPack?.present === true || status.artifacts.doctorPackFull?.present === true);
  assert.equal(dashboard.evidence.curationPresent, status.curation?.present === true);
  assert.equal(dashboard.evidence.curationStale, status.curation?.stale === true);
  for (const key of ['doctorPresent', 'doctorPackPresent', 'curationPresent', 'curationStale']) assert.equal(typeof dashboard.evidence[key], 'boolean');
  assert.equal(Number.isSafeInteger(dashboard.evidence.inventorySkills) && dashboard.evidence.inventorySkills >= 0, true);
});

function directoryDigest(root) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(relative).update('\0').update(readFileSync(absolute));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function githubFixtureTransport(files) {
  const buffers = new Map(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)]));
  const entries = [...buffers.entries()].map(([name, bytes]) => ({ path: name, mode: '100644', type: 'blob', sha: gitBlobSha(bytes), size: bytes.length }));
  const state = { commitRequests: 0 };
  state.transport = async (request) => {
    const target = new URL(request.url);
    if (target.hostname === 'api.github.com' && target.pathname.includes('/commits/')) {
      state.commitRequests += 1;
      return jsonResponse({ sha: COMMIT, commit: { tree: { sha: ROOT_TREE } } });
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${ROOT_TREE}`) && !target.search) {
      return jsonResponse({ sha: ROOT_TREE, truncated: false, tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: SKILLS_TREE }] });
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${SKILLS_TREE}`) && !target.search) {
      return jsonResponse({ sha: SKILLS_TREE, truncated: false, tree: [{ path: 'demo', mode: '040000', type: 'tree', sha: SKILL_TREE }] });
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${SKILL_TREE}`) && target.searchParams.get('recursive') === '1') {
      return jsonResponse({ sha: SKILL_TREE, truncated: false, tree: entries });
    }
    if (target.hostname === 'raw.githubusercontent.com') {
      const marker = `/${COMMIT}/skills/demo/`;
      const offset = target.pathname.indexOf(marker);
      const relative = offset >= 0 ? target.pathname.slice(offset + marker.length).split('/').map(decodeURIComponent).join('/') : '';
      const bytes = buffers.get(relative);
      return bytes ? response(200, bytes) : response(404, 'missing fixture file');
    }
    return response(404, 'unknown fixture request');
  };
  return state;
}

function jsonResponse(value) { return response(200, JSON.stringify(value), { 'content-type': 'application/json' }); }
function response(status, body = '', headers = {}) { return { status, headers, body: body instanceof Uint8Array ? body : Buffer.from(body) }; }
function gitBlobSha(bytes) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
