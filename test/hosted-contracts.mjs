import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateContract } from '../dist/contracts/validate.js';

const IDS = {
  grade: 'https://skillmap.dev/contracts/hosted-grade-summary/v1.schema.json',
  skill: 'https://skillmap.dev/contracts/hosted-skill/v1.schema.json',
  list: 'https://skillmap.dev/contracts/hosted-skill-list/v1.schema.json',
  api: 'https://skillmap.dev/contracts/hosted-api-response/v1.schema.json'
};

const PUBLISHER_ID = `pub_${'0'.repeat(31)}1`;
const SKILL_ID = `skl_${'0'.repeat(31)}1`;
const OTHER_SKILL_ID = `skl_${'0'.repeat(31)}2`;
const VERSION_ID = `skv_${'0'.repeat(31)}1`;
const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const COMMIT = 'd1c23990af82d1c8c99997cb8d9a2c23707d91fa';
const NOW = '2026-07-11T19:03:51.000Z';
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';

function ungraded() {
  return {
    kind: 'skillmap.hosted-grade-summary',
    schemaVersion: 1,
    state: 'ungraded',
    band: null,
    confidence: null,
    receipt: null,
    invalidatedAt: null,
    reasonCodes: ['evaluation-not-run']
  };
}

function hostedSkill() {
  return {
    kind: 'skillmap.hosted-skill',
    schemaVersion: 1,
    skillId: SKILL_ID,
    publisher: {
      publisherId: PUBLISHER_ID,
      handle: '0x3-team',
      displayName: '0x3 Team',
      verificationState: 'unverified'
    },
    slug: 'skill-audit',
    displayName: 'Skill Audit',
    summary: 'Audit a skill without treating structural checks as a safety certificate.',
    description: 'A first-party catalog audit skill.',
    lifecycleState: 'published',
    currentVersion: {
      versionId: VERSION_ID,
      version: '1.0.0',
      entrypointContentDigest: SHA_A,
      licenseState: 'confirmed',
      redistribution: 'metadata-only',
      compatibilityState: 'not-tested',
      grade: ungraded(),
      publishedAt: NOW
    },
    capabilities: ['skill.audit', 'skill.provenance'],
    updatedAt: NOW,
    source: {
      repositoryUrl: 'https://github.com/0x3-team/skillmap',
      commit: COMMIT,
      path: 'catalog/first-party/skill-audit/SKILL.md',
      entrypointContentDigest: SHA_A,
      rawSnapshotDigest: null
    },
    artifact: {
      availability: 'metadata-only',
      normalizedDigest: null,
      manifestDigest: null
    },
    license: {
      state: 'confirmed',
      spdxExpression: 'MIT',
      redistribution: 'metadata-only',
      files: ['LICENSE']
    },
    compatibility: {
      host: 'codex',
      state: 'not-tested',
      profileVersion: null,
      evidenceDigest: null
    },
    permissions: {
      scripts: false,
      network: [],
      tools: []
    },
    evidence: {
      provenance: 'unverified',
      audit: 'not-run',
      compatibility: 'not-tested'
    },
    relationships: [{
      type: 'alternative',
      targetSkillId: OTHER_SKILL_ID,
      evidenceState: 'declared',
      reason: 'Both review skill quality from different evidence perspectives.'
    }]
  };
}

function hostedList(skill = hostedSkill()) {
  const {
    kind: _kind,
    schemaVersion: _schemaVersion,
    description: _description,
    source: _source,
    artifact: _artifact,
    license: _license,
    compatibility: _compatibility,
    permissions: _permissions,
    evidence: _evidence,
    relationships: _relationships,
    ...summary
  } = skill;
  return {
    kind: 'skillmap.hosted-skill-list',
    schemaVersion: 1,
    query: { q: null, limit: 24, cursor: null },
    items: [summary],
    pagination: { nextCursor: null, hasMore: false, stableSortKey: 'published_at_desc_skill_id_asc' },
    generatedAt: NOW
  };
}

function assertValid(schemaId, value) {
  const result = validateContract(schemaId, value);
  assert.equal(result.ok, true, `expected valid ${schemaId}: ${JSON.stringify(result.issues)}`);
}

function assertInvalid(schemaId, value, pattern) {
  const result = validateContract(schemaId, value);
  assert.equal(result.ok, false, `expected invalid ${schemaId}`);
  if (pattern) assert.match(result.issues.map((issue) => `${issue.path} ${issue.message}`).join(' '), pattern);
}

test('hosted grade, detail, list, and API contracts accept the bounded first-party vector', () => {
  const skill = hostedSkill();
  const list = hostedList(skill);
  assertValid(IDS.grade, skill.currentVersion.grade);
  assertValid(IDS.skill, skill);
  assertValid(IDS.list, list);
  assertValid(IDS.api, {
    kind: 'skillmap.hosted-api-response',
    schemaVersion: 1,
    ok: true,
    requestId: REQUEST_ID,
    data: list
  });
  assertValid(IDS.api, {
    kind: 'skillmap.hosted-api-response',
    schemaVersion: 1,
    ok: true,
    requestId: REQUEST_ID,
    data: skill
  });
});

test('ungraded and current grade states cannot borrow each other\'s authority', () => {
  const fabricated = ungraded();
  fabricated.band = 'A';
  assertInvalid(IDS.grade, fabricated, /must be null|oneOf/);

  const unbound = ungraded();
  unbound.state = 'current';
  unbound.band = 'A';
  assertInvalid(IDS.grade, unbound, /must be object|oneOf/);

  const blockedWithoutReason = ungraded();
  blockedWithoutReason.state = 'blocked';
  blockedWithoutReason.reasonCodes = [];
  assertInvalid(IDS.grade, blockedWithoutReason, /fewer than 1|oneOf/);

  const staleBeforeEvaluation = {
    kind: 'skillmap.hosted-grade-summary',
    schemaVersion: 1,
    state: 'stale',
    band: 'B',
    confidence: 0.72,
    receipt: {
      receiptId: `grd_${'0'.repeat(31)}1`,
      receiptDigest: SHA_B,
      gradedAt: '2026-07-11T20:00:00.000Z',
      rubricVersion: 'skillmap-rubric/v1',
      hostProfileVersion: 'codex/v1'
    },
    invalidatedAt: '2026-07-11T19:00:00.000Z',
    reasonCodes: ['host-profile-changed']
  };
  assertInvalid(IDS.grade, staleBeforeEvaluation, /invalidatedAt|timestamp/);

  const gradeWithPrivateField = ungraded();
  gradeWithPrivateField.privateEvidence = true;
  assertInvalid(IDS.grade, gradeWithPrivateField, /additional properties|must NOT have/);
});

test('hosted identity and source boundaries reject local IDs, mutable refs, traversal, and unknown fields', () => {
  const sha256Repository = hostedSkill();
  sha256Repository.source.commit = 'c'.repeat(64);
  assertValid(IDS.skill, sha256Repository);

  const localIdentity = hostedSkill();
  localIdentity.skillId = `sk_${'A'.repeat(43)}`;
  assertInvalid(IDS.skill, localIdentity, /pattern/);

  const mutableRef = hostedSkill();
  mutableRef.source.commit = 'main';
  assertInvalid(IDS.skill, mutableRef, /pattern/);

  const traversal = hostedSkill();
  traversal.source.path = '../secret/SKILL.md';
  assertInvalid(IDS.skill, traversal, /pattern/);

  const credentialedRepository = hostedSkill();
  credentialedRepository.source.repositoryUrl = 'https://user:token@example.invalid/repository';
  assertInvalid(IDS.skill, credentialedRepository, /pattern/);

  const tokenQueryRepository = hostedSkill();
  tokenQueryRepository.source.repositoryUrl = 'https://example.invalid/repository?token=secret';
  assertInvalid(IDS.skill, tokenQueryRepository, /pattern/);

  const fragmentRepository = hostedSkill();
  fragmentRepository.source.repositoryUrl = 'https://example.invalid/repository#private-ref';
  assertInvalid(IDS.skill, fragmentRepository, /pattern/);

  const unsupportedRepositoryProvider = hostedSkill();
  unsupportedRepositoryProvider.source.repositoryUrl = 'https://gitlab.com/0x3-team/skillmap';
  assertInvalid(IDS.skill, unsupportedRepositoryProvider, /pattern/);

  const extra = hostedList();
  extra.items[0].privateNotes = 'must never be public';
  assertInvalid(IDS.list, extra, /unevaluated properties|must NOT have/);
});

test('hosted list bounds and API envelope validate the inner payload rather than accepting arbitrary data', () => {
  const oversized = hostedList();
  oversized.query.limit = 51;
  assertInvalid(IDS.list, oversized, /must be <= 50/);

  const invalidInner = hostedList();
  invalidInner.items[0].currentVersion.entrypointContentDigest = 'sha256:not-a-digest';
  assertInvalid(IDS.api, {
    kind: 'skillmap.hosted-api-response',
    schemaVersion: 1,
    ok: true,
    requestId: REQUEST_ID,
    data: invalidInner
  }, /pattern|oneOf/);

  assertValid(IDS.api, {
    kind: 'skillmap.hosted-api-response',
    schemaVersion: 1,
    ok: false,
    requestId: REQUEST_ID,
    error: { code: 'INVALID_QUERY', message: 'The catalog query is invalid.', retryable: false }
  });

  const duplicate = hostedList();
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assertInvalid(IDS.list, duplicate, /duplicate|unique/i);

  const overPageLimit = hostedList();
  const second = structuredClone(overPageLimit.items[0]);
  second.skillId = OTHER_SKILL_ID;
  second.currentVersion.versionId = `skv_${'0'.repeat(31)}2`;
  overPageLimit.items.push(second);
  overPageLimit.query.limit = 1;
  assertInvalid(IDS.list, overPageLimit, /query.limit|pageLimit/);

  const inconsistentCursor = hostedList();
  inconsistentCursor.pagination.hasMore = true;
  assertInvalid(IDS.list, inconsistentCursor, /nextCursor|hasMore|cursorState/);
});

test('PostgREST row cap preserves the sentinel behind the public 50-item page limit', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const configured = config.match(/^max_rows\s*=\s*(\d+)$/m);
  assert.ok(configured, 'supabase/config.toml must declare max_rows');
  assert.ok(Number(configured[1]) >= 51, 'max_rows must admit limit=50 plus one pagination sentinel');
});
