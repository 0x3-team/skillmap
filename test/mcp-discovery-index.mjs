import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { rankRoutePrompt } from '../dist/contracts/route-ranking.js';
import { routeSemanticDecision } from '../dist/core/route.js';
import {
  SkillDiscoveryIndexCache,
  compileSkillDiscoveryIndex,
  rankRoutePromptWithDiscoveryIndex,
  searchSkillOrdinalsWithDiscoveryIndex,
  serializeSkillDiscoveryIndex
} from '../dist/core/skill-discovery-index.js';
import {
  createSkillDiscoveryUseCase,
  projectLocalSkillSummary,
  projectMcpSkillDetail,
  projectMcpSkillSummary
} from '../dist/services/skill-discovery-use-case.js';

const REVISION_A = `sha256:${'a'.repeat(64)}`;
const REVISION_B = `sha256:${'b'.repeat(64)}`;
const REVISION_C = `sha256:${'c'.repeat(64)}`;

function skillId(value) {
  return `sk_${createHash('sha256').update(String(value)).digest('base64url')}`;
}

function skill(index, overrides = {}) {
  const name = overrides.name ?? `skill-${String(index).padStart(4, '0')}`;
  return {
    skillId: skillId(index),
    name,
    description: `Focused workflow for token-${index % 17} and cohort-${index % 7}.`,
    tier: 'active-default',
    family: index % 3 === 0 ? 'frontend' : undefined,
    path: `/private/${name}`,
    aliases: [`alias-${index}`],
    preferredFor: [`preferred token-${index % 17}`],
    avoidFor: [],
    supersedes: [],
    routeEligible: true,
    qualifiedExplicitAllowed: true,
    variantState: 'unique',
    hasScripts: false,
    contentRevision: `sha256:${createHash('sha256').update(`content:${index}`).digest('hex')}`,
    scope: 'project',
    referenceCount: 0,
    assetCount: 0,
    scriptPaths: [],
    frontmatterValid: true,
    effectiveReasons: [],
    overlaps: [],
    relativePath: name,
    root: '/private',
    rootId: 'root_fixture',
    identityVersion: 1,
    identitySource: 'scan',
    identityWarnings: [],
    ...overrides
  };
}

function registry(skills) {
  return {
    version: 2,
    generatedAt: '2026-07-15T00:00:00.000Z',
    inventory: { version: 2, generatedAt: '2026-07-15T00:00:00.000Z', workspaceId: 'ws_fixture', roots: [], rootRecords: [], skills, identityIssues: [] },
    policy: { version: 2, canonicalByName: {}, skillsById: {}, duplicateDecisions: {}, migration: {} },
    skills,
    graph: { version: 1, generatedAt: '2026-07-15T00:00:00.000Z', mode: 'effective', nodes: [], edges: [] }
  };
}

function read(skills, effectiveRevisionDigest = REVISION_A, revisionId = 'rev_a') {
  const revision = {
    workspaceId: 'ws_fixture',
    revisionId,
    workspaceRevision: `sha256:${'d'.repeat(64)}`,
    effectiveDigest: `sha256:${'e'.repeat(64)}`,
    effectiveRevisionDigest
  };
  return {
    state: { source: 'current' },
    revisionRoot: '/immutable/revision',
    skillmapRoot: '/immutable/revision/.skillmap',
    servingRevision: revision,
    currentRevision: revision,
    effective: registry(skills),
    warningCodes: []
  };
}

test('index compiler emits deterministic revision-bound bytes and digest', () => {
  const skills = [skill(2), skill(0), skill(1)];
  const first = compileSkillDiscoveryIndex(skills, REVISION_A);
  const second = compileSkillDiscoveryIndex(skills, REVISION_A);
  assert.equal(first.indexDigest, second.indexDigest);
  assert.equal(serializeSkillDiscoveryIndex(first), serializeSkillDiscoveryIndex(second));
  assert.equal(first.skillCount, skills.length);
  assert.equal(first.effectiveRevisionDigest, REVISION_A);
  assert.match(first.indexDigest, /^sha256:[a-f0-9]{64}$/);

  const rebound = compileSkillDiscoveryIndex(skills, REVISION_B);
  assert.notEqual(rebound.indexDigest, first.indexDigest, 'revision identity must be part of the canonical index');
  assert.throws(
    () => searchSkillOrdinalsWithDiscoveryIndex(first, skills, REVISION_B, 'skill'),
    /revision binding/i
  );
});

test('indexed and shadow routing are exactly equal to the full scanner', () => {
  const skills = [
    skill(0, { name: 'alpha', aliases: ['ship-ui'], preferredFor: ['polish frontend'], supersedes: ['bravo'] }),
    skill(1, { name: 'bravo', description: 'Frontend polish and ship workflow' }),
    skill(2, { name: 'charlie', tier: 'blocked', routeEligible: false }),
    skill(3, { name: 'delta', tier: 'explicit-only' }),
    skill(4, { name: 'go', description: 'Specialized runtime', aliases: [], preferredFor: [] }),
    skill(5, { name: 'scripts', description: 'Security workflow', hasScripts: true }),
    skill(6, { name: 'avoidance', description: 'Deployment workflow', avoidFor: ['unsafe deployment'] })
  ];
  const index = compileSkillDiscoveryIndex(skills, REVISION_A);
  const prompts = [
    'ship-ui and polish frontend',
    'frontend polish workflow',
    'delta',
    'Review a google deployment',
    'Use go for this runtime',
    'unsafe deployment workflow',
    'no confident unrelated phrase'
  ];

  for (const prompt of prompts) {
    const reference = rankRoutePrompt(skills, prompt, 3);
    const indexed = rankRoutePromptWithDiscoveryIndex(skills, prompt, 3, undefined, {
      strategy: 'indexed', index, effectiveRevisionDigest: REVISION_A, verifyIndexed: true
    });
    const shadow = rankRoutePromptWithDiscoveryIndex(skills, prompt, 3, undefined, {
      strategy: 'shadow', index, effectiveRevisionDigest: REVISION_A
    });
    assert.deepEqual(indexed.result, reference, prompt);
    assert.deepEqual(shadow.result, reference, prompt);
    assert.equal(indexed.comparison.matched, true);
    assert.equal(shadow.comparison.matched, true);
    assert.equal(shadow.comparison.referenceCompared, true);
    assert.ok(indexed.comparison.candidateCount <= skills.length);
  }

  const qualified = skills[4];
  const explicit = rankRoutePromptWithDiscoveryIndex(skills, '', 1, qualified.skillId, {
    strategy: 'indexed', index, effectiveRevisionDigest: REVISION_A, verifyIndexed: true
  });
  assert.deepEqual(explicit.result, rankRoutePrompt(skills, '', 1, qualified.skillId));
});

test('indexed routing normalizes Unicode compatibility characters before candidate selection', () => {
  const skills = [
    skill(70, { name: 'foo', aliases: [], preferredFor: [] }),
    skill(71, { name: 'unrelated', aliases: [], preferredFor: [] })
  ];
  const prompt = String.fromCodePoint(0xff26, 0xff2f, 0xff2f);
  const reference = rankRoutePrompt(skills, prompt, 3);
  assert.equal(reference.recommendations[0]?.skillId, skills[0].skillId);

  const index = compileSkillDiscoveryIndex(skills, REVISION_A);
  const indexed = rankRoutePromptWithDiscoveryIndex(skills, prompt, 3, undefined, {
    strategy: 'indexed', index, effectiveRevisionDigest: REVISION_A, verifyIndexed: true
  });
  assert.deepEqual(indexed.result, reference);
  assert.equal(indexed.comparison.matched, true);
});

test('prepared scoring preserves unique-token semantics for repeated metadata', () => {
  const repeated = skill(88, {
    name: 'unrelated-name',
    description: 'repeat repeat repeat',
    aliases: [],
    preferredFor: []
  });
  const reference = rankRoutePrompt([repeated], 'repeat', 3);
  assert.equal(reference.recommendations[0]?.score, 6, 'description token counts once plus the active-default boost');
  assert.deepEqual(reference.recommendations[0]?.reasons, ['description token:repeat', 'active-default tier boost']);
  const index = compileSkillDiscoveryIndex([repeated], REVISION_A);
  const indexed = rankRoutePromptWithDiscoveryIndex([repeated], 'repeat', 3, undefined, {
    strategy: 'indexed', index, effectiveRevisionDigest: REVISION_A, verifyIndexed: true
  });
  assert.deepEqual(indexed.result, reference);
});

test('core route projection accepts the same explicit bounded index runtime', () => {
  const skills = [skill(90, { name: 'alpha', preferredFor: ['focused delivery'] }), skill(91, { name: 'bravo' })];
  const cache = new SkillDiscoveryIndexCache(2);
  const reference = routeSemanticDecision({ skills }, 'focused delivery', 3);
  const comparisons = [];
  const indexed = routeSemanticDecision({ skills }, 'focused delivery', 3, undefined, {
    strategy: 'indexed',
    indexCache: cache,
    effectiveRevisionDigest: REVISION_A,
    verifyIndexed: true,
    onStrategyComparison: (comparison) => comparisons.push(comparison)
  });
  assert.deepEqual(indexed, reference);
  assert.equal(comparisons[0]?.matched, true);
  assert.equal(cache.size, 1);
});

test('seeded routing fuzz has zero canonical mismatches and no candidate cap', () => {
  let state = 0x5eed1234;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const skills = Array.from({ length: 500 }, (_, index) => skill(index, {
    tier: index % 41 === 0 ? 'blocked' : index % 37 === 0 ? 'explicit-only' : index % 11 === 0 ? 'specialist' : 'active-default',
    routeEligible: index % 41 !== 0,
    hasScripts: index % 13 === 0,
    avoidFor: index % 19 === 0 ? [`cohort-${index % 7}`] : []
  }));
  const index = compileSkillDiscoveryIndex(skills, REVISION_A);
  let largestCandidateSet = 0;
  for (let caseIndex = 0; caseIndex < 750; caseIndex += 1) {
    const token = Math.floor(random() * 17);
    const cohort = Math.floor(random() * 7);
    const prompt = caseIndex % 11 === 0
      ? 'workflow'
      : `Need token-${token} for cohort-${cohort} workflow ${Math.floor(random() * 500)}`;
    const reference = rankRoutePrompt(skills, prompt, 3);
    const indexed = rankRoutePromptWithDiscoveryIndex(skills, prompt, 3, undefined, {
      strategy: 'indexed', index, effectiveRevisionDigest: REVISION_A, verifyIndexed: true
    });
    largestCandidateSet = Math.max(largestCandidateSet, indexed.comparison.candidateCount);
    assert.deepEqual(indexed.result, reference, `seeded case ${caseIndex}`);
  }
  assert.ok(largestCandidateSet > 100, 'broad terms must be evaluated exactly instead of silently capped');
});

test('search service shares exact ids, order, cursors, and explicit projections', () => {
  const skills = [
    skill(0, { name: 'Zulu', aliases: ['shared-alias'], description: 'PRIVATE_DESCRIPTION_CANARY /opt/private/value' }),
    skill(1, { name: 'Alpha', preferredFor: ['shared-alias'] }),
    skill(2, { name: 'Bravo' })
  ];
  const cache = new SkillDiscoveryIndexCache(2);
  const reference = createSkillDiscoveryUseCase(read(skills), { strategy: 'reference' });
  const indexed = createSkillDiscoveryUseCase(read(skills), { strategy: 'indexed', indexCache: cache });
  const shadowReceipts = [];
  const shadow = createSkillDiscoveryUseCase(read(skills), {
    strategy: 'shadow',
    indexCache: cache,
    onStrategyComparison: (receipt) => shadowReceipts.push(receipt)
  });

  const firstReference = reference.search({ query: 'shared-alias', limit: 1 });
  const firstIndexed = indexed.search({ query: 'shared-alias', limit: 1 });
  const firstShadow = shadow.search({ query: 'shared-alias', limit: 1 });
  assert.deepEqual(firstIndexed, firstReference);
  assert.deepEqual(firstShadow, firstReference);
  assert.equal(firstReference.items[0].name, 'Alpha');
  assert.equal(typeof firstReference.nextCursor, 'string');
  assert.equal(shadowReceipts.at(-1)?.matched, true);

  const paddedReference = reference.search({ query: '  ShArEd-AlIaS  ', limit: 2 });
  const paddedIndexed = indexed.search({ query: '  ShArEd-AlIaS  ', limit: 2 });
  assert.deepEqual(paddedReference, reference.search({ query: 'shared-alias', limit: 2 }));
  assert.deepEqual(paddedIndexed, paddedReference, 'MCP and loopback discovery retain trim and case-fold semantics');

  const second = indexed.search({ query: 'shared-alias', limit: 1, cursor: firstIndexed.nextCursor });
  assert.equal(second.items[0].name, 'Zulu');
  assert.equal(second.nextCursor, null);
  assert.throws(
    () => indexed.search({ query: 'different-query', limit: 1, cursor: firstIndexed.nextCursor }),
    /stale or invalid/i
  );
  assert.throws(
    () => indexed.search({ query: 'shared-alias', limit: 1, cursor: `${firstIndexed.nextCursor}tampered` }),
    /invalid/i
  );
  const nextRevision = createSkillDiscoveryUseCase(read(skills, REVISION_B, 'rev_b'), {
    strategy: 'indexed',
    indexCache: cache
  });
  assert.throws(
    () => nextRevision.search({ query: 'shared-alias', limit: 1, cursor: firstIndexed.nextCursor }),
    /stale or invalid/i
  );
  assert.throws(() => indexed.search({ query: '\0', limit: 1 }), /forbidden NUL/i);
  assert.throws(() => indexed.search({ query: '😀'.repeat(65), limit: 1 }), /256-byte limit/i);
  assert.throws(() => indexed.search({ limit: 0 }), /integer between 1 and 100/i);
  assert.throws(() => indexed.search({ limit: 1, cursor: 'x'.repeat(1_025) }), /cursor is invalid/i);

  const mcp = projectMcpSkillSummary(skills[0]);
  const detail = projectMcpSkillDetail(skills[0]);
  const local = projectLocalSkillSummary(skills[0]);
  assert.deepEqual(detail, mcp);
  assert.equal(Object.hasOwn(mcp, 'path'), false);
  assert.equal(Object.hasOwn(mcp, 'description'), false);
  assert.equal(JSON.stringify(mcp).includes('PRIVATE_DESCRIPTION_CANARY'), false);
  assert.equal(local.description, 'Description withheld because it contains sensitive local metadata.');
  assert.equal(Object.hasOwn(local, 'path'), false);

  for (const dangerousName of [
    'owner@example.invalid',
    'Cookie: session=private',
    'prefix:C:/Users/alice/private-skill'
  ]) {
    const dangerous = skill(99, { name: dangerousName });
    assert.equal(projectMcpSkillSummary(dangerous).displayName, dangerous.skillId);
    assert.equal(projectMcpSkillDetail(dangerous).displayName, dangerous.skillId);
  }
});

test('two-revision cache evicts deterministically and cannot reuse stale indexes', () => {
  const cache = new SkillDiscoveryIndexCache(2);
  const skillsA = [skill(0)];
  const skillsB = [skill(1)];
  const skillsC = [skill(2)];
  const indexA = cache.getOrCompile(skillsA, REVISION_A);
  assert.throws(
    () => cache.getOrCompile([...skillsA, skill(99)], REVISION_A),
    /registry binding mismatch/i,
    'a cache hit cannot silently bind the same revision digest to different registry bytes'
  );
  const indexB = cache.getOrCompile(skillsB, REVISION_B);
  assert.deepEqual(cache.revisionDigests(), [REVISION_A, REVISION_B]);
  assert.equal(cache.getOrCompile(skillsA, REVISION_A), indexA, 'cache hit returns the exact compiled immutable index');
  assert.deepEqual(cache.revisionDigests(), [REVISION_B, REVISION_A], 'a hit refreshes deterministic LRU order');
  cache.getOrCompile(skillsC, REVISION_C);
  assert.deepEqual(cache.revisionDigests(), [REVISION_A, REVISION_C]);
  assert.notEqual(cache.getOrCompile(skillsB, REVISION_B), indexB, 'evicted revision compiles a fresh index');
  assert.equal(cache.size, 2);
  cache.clear();
  assert.equal(cache.size, 0);
});
