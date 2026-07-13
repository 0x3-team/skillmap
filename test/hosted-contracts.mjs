import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { canonicalJson } from '../dist/core/canonical-payload.js';
import { validateContract } from '../dist/contracts/validate.js';

const IDS = {
  grade: 'https://skillmap.dev/contracts/hosted-grade-summary/v1.schema.json',
  skill: 'https://skillmap.dev/contracts/hosted-skill/v1.schema.json',
  list: 'https://skillmap.dev/contracts/hosted-skill-list/v1.schema.json',
  api: 'https://skillmap.dev/contracts/hosted-api-response/v1.schema.json',
  review: 'https://skillmap.dev/contracts/hosted-review-state/v1.schema.json',
  auditSummary: 'https://skillmap.dev/contracts/hosted-audit-summary/v1.schema.json',
  auditReceipt: 'https://skillmap.dev/contracts/hosted-audit-receipt/v1.schema.json',
  gradeReceipt: 'https://skillmap.dev/contracts/hosted-grade-receipt/v1.schema.json',
  submission: 'https://skillmap.dev/contracts/hosted-submission/v1.schema.json'
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

test('hosted skill detail relationships are capped at one hundred entries', () => {
  const skill = hostedSkill();
  skill.relationships = Array.from({ length: 100 }, (_, index) => ({
    ...skill.relationships[0],
    reason: `Bounded relationship ${index + 1}.`
  }));
  assertValid(IDS.skill, skill);
  skill.relationships.push({ ...skill.relationships[0], reason: 'Relationship 101.' });
  assertInvalid(IDS.skill, skill, /relationships/);
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

  const validStale = structuredClone(staleBeforeEvaluation);
  validStale.invalidatedAt = '2026-07-11T21:00:00.000Z';
  assertValid(IDS.grade, validStale);

  const provisionalWithBand = structuredClone(validStale);
  provisionalWithBand.state = 'provisional';
  provisionalWithBand.invalidatedAt = null;
  assertInvalid(IDS.grade, provisionalWithBand, /must be null|oneOf/);

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

test('hosted submission, review, audit, and grade receipts accept bounded public projections', () => {
  const auditReceipt = {
    kind: 'skillmap.hosted-audit-receipt', schemaVersion: 1,
    receiptId: `aud_${'1'.repeat(32)}`, receiptDigest: SHA_A, projectionDigest: SHA_B,
    skillVersionId: VERSION_ID, sourceCommit: COMMIT,
    sourceContentDigest: SHA_A, normalizedContentDigest: SHA_B,
    state: 'warnings',
    findingCounts: { critical: 0, high: 0, medium: 1, low: 0, info: 2 },
    checks: [
      { code: 'frontmatter-valid', outcome: 'passed', severity: 'info', evidenceDigest: SHA_A },
      { code: 'broad-trigger-language', outcome: 'warning', severity: 'medium', evidenceDigest: SHA_B }
    ],
    reasonCodes: ['broad-trigger-language'], policyVersion: 'static-audit/v1',
    hostProfileVersion: 'codex/v1', workerVersion: 'skillmap-worker/0.1.0', auditedAt: NOW
  };
  const gradeReceipt = {
    kind: 'skillmap.hosted-grade-receipt', schemaVersion: 1,
    receiptId: `grd_${'2'.repeat(32)}`, receiptDigest: SHA_B, projectionDigest: SHA_A,
    skillVersionId: VERSION_ID, normalizedContentDigest: SHA_B,
    auditReceiptId: auditReceipt.receiptId, auditReceiptDigest: SHA_A,
    compatibilityEvidenceDigest: SHA_A, evaluationSuiteDigest: null,
    rubricVersion: 'skillmap-rubric/v1', hostProfileVersion: 'codex/v1',
    evaluatorVersion: 'skillmap-grader/0.1.0', state: 'provisional', band: null,
    totalScore: 78, confidence: 0.62,
    hardGates: [
      { code: 'source-identity', passed: true, evidenceDigest: SHA_A },
      { code: 'audit-acceptable', passed: true, evidenceDigest: SHA_A },
      { code: 'license-confirmed', passed: true, evidenceDigest: SHA_A },
      { code: 'compatibility-evidence-bound', passed: true, evidenceDigest: SHA_A },
      { code: 'behavioral-evidence-bound', passed: false, evidenceDigest: null }
    ],
    dimensions: [
      { code: 'instruction-quality', weight: 0.25, score: 78, evidenceDigest: SHA_B },
      { code: 'safety-and-permissions', weight: 0.25, score: 78, evidenceDigest: SHA_B },
      { code: 'routing-quality', weight: 0.20, score: 78, evidenceDigest: SHA_B },
      { code: 'reproducibility', weight: 0.15, score: 78, evidenceDigest: SHA_B },
      { code: 'maintenance-and-provenance', weight: 0.15, score: 78, evidenceDigest: SHA_B }
    ],
    reasonCodes: ['behavioral-evidence-incomplete'], gradedAt: NOW
  };
  auditReceipt.projectionDigest = canonicalProjectionDigest(auditReceipt);
  gradeReceipt.auditReceiptDigest = auditReceipt.receiptDigest;
  gradeReceipt.projectionDigest = canonicalProjectionDigest(gradeReceipt);
  const review = {
    kind: 'skillmap.hosted-review-state', schemaVersion: 1,
    state: 'approved', reviewCaseId: `rev_${'3'.repeat(32)}`,
    reasonCodes: [], message: null, reviewedAt: NOW
  };
  const submission = {
    kind: 'skillmap.hosted-submission', schemaVersion: 1,
    submissionId: `sub_${'4'.repeat(32)}`,
    source: { repositoryUrl: 'https://github.com/0x3-team/skillmap', commit: COMMIT, path: 'catalog/first-party/skill-audit/SKILL.md' },
    versionLabel: '1.0.0', licenseClaim: 'MIT', state: 'accepted',
    audit: {
      kind: 'skillmap.hosted-audit-summary', schemaVersion: 1, state: 'warnings',
      receipt: { receiptId: auditReceipt.receiptId, receiptDigest: SHA_A, auditedAt: NOW, policyVersion: 'static-audit/v1', hostProfileVersion: 'codex/v1' },
      findingCounts: auditReceipt.findingCounts, reasonCodes: auditReceipt.reasonCodes
    },
    grade: {
      kind: 'skillmap.hosted-grade-summary', schemaVersion: 1, state: 'provisional', band: null,
      confidence: 0.62,
      receipt: { receiptId: gradeReceipt.receiptId, receiptDigest: SHA_B, gradedAt: NOW, rubricVersion: 'skillmap-rubric/v1', hostProfileVersion: 'codex/v1' },
      invalidatedAt: null, reasonCodes: gradeReceipt.reasonCodes
    },
    review, publicResult: null, remediation: null,
    createdAt: '2026-07-11T18:00:00.000Z', updatedAt: NOW,
    claimedAt: '2026-07-11T18:30:00.000Z', completedAt: NOW
  };

  assertValid(IDS.auditReceipt, auditReceipt);
  assertValid(IDS.gradeReceipt, gradeReceipt);
  assertValid(IDS.review, review);
  assertValid(IDS.auditSummary, submission.audit);
  assertValid(IDS.submission, submission);

  const passedWithBlockedCheck = structuredClone(auditReceipt);
  passedWithBlockedCheck.state = 'passed';
  passedWithBlockedCheck.reasonCodes = [];
  passedWithBlockedCheck.checks = [{ code: 'secret-material', outcome: 'blocked', severity: 'critical', evidenceDigest: SHA_A }];
  assertInvalid(IDS.auditReceipt, passedWithBlockedCheck, /oneOf|allowed values/);

  const publishedProvisional = structuredClone(submission);
  publishedProvisional.state = 'published';
  publishedProvisional.review.state = 'published';
  publishedProvisional.publicResult = { skillId: SKILL_ID, versionId: VERSION_ID };
  assertValid(IDS.submission, publishedProvisional);

  const fabricatedCurrentPublished = structuredClone(publishedProvisional);
  fabricatedCurrentPublished.grade.state = 'current';
  fabricatedCurrentPublished.grade.band = 'B';
  assertInvalid(IDS.submission, fabricatedCurrentPublished, /must be equal to constant|allowed values/);

  const forgedBand = structuredClone(gradeReceipt);
  forgedBand.state = 'current';
  forgedBand.band = 'A';
  forgedBand.reasonCodes = [];
  assertInvalid(IDS.gradeReceipt, forgedBand, /oneOf|must be >= 90/);

  const forgedArithmetic = structuredClone(gradeReceipt);
  forgedArithmetic.totalScore = 99;
  assertInvalid(IDS.gradeReceipt, forgedArithmetic, /weighted dimension score/);

  const forgedRubric = structuredClone(gradeReceipt);
  forgedRubric.dimensions[0].weight = 0.01;
  forgedRubric.dimensions[1].weight = 0.49;
  forgedRubric.projectionDigest = canonicalProjectionDigest(forgedRubric);
  assertInvalid(IDS.gradeReceipt, forgedRubric, /must equal 0.25|rubricWeight/);

  const missingGate = structuredClone(gradeReceipt);
  missingGate.hardGates.pop();
  missingGate.projectionDigest = canonicalProjectionDigest(missingGate);
  assertInvalid(IDS.gradeReceipt, missingGate, /exactly five hard gates|missing skillmap-rubric/);

  const falsePassedSummary = structuredClone(submission.audit);
  falsePassedSummary.state = 'passed';
  falsePassedSummary.reasonCodes = [];
  assertInvalid(IDS.auditSummary, falsePassedSummary, /must be equal to constant|passed audit summaries|oneOf/);
});

test('hosted authority contracts reject private transport fields and fabricated state combinations', () => {
  const notRun = {
    kind: 'skillmap.hosted-audit-summary', schemaVersion: 1, state: 'not-run', receipt: null,
    findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    reasonCodes: ['audit-not-run']
  };
  assertValid(IDS.auditSummary, notRun);

  const fabricated = structuredClone(notRun);
  fabricated.findingCounts.high = 1;
  assertInvalid(IDS.auditSummary, fabricated, /must be equal to constant|oneOf/);

  const privateReview = {
    kind: 'skillmap.hosted-review-state', schemaVersion: 1,
    state: 'approved', reviewCaseId: `rev_${'3'.repeat(32)}`,
    reasonCodes: [], message: null, reviewedAt: NOW,
    operatorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  };
  assertInvalid(IDS.review, privateReview, /additional properties|must NOT have/);

  const queuedWithClaim = {
    kind: 'skillmap.hosted-submission', schemaVersion: 1,
    submissionId: `sub_${'4'.repeat(32)}`,
    source: { repositoryUrl: 'https://github.com/0x3-team/skillmap', commit: COMMIT, path: 'SKILL.md' },
    versionLabel: '1.0.0', licenseClaim: null, state: 'queued', audit: notRun, grade: ungraded(),
    review: { kind: 'skillmap.hosted-review-state', schemaVersion: 1, state: 'not-started', reviewCaseId: null, reasonCodes: [], message: null, reviewedAt: null },
    publicResult: null, remediation: null, createdAt: NOW, updatedAt: NOW,
    claimedAt: NOW, completedAt: null
  };
  assertInvalid(IDS.submission, queuedWithClaim, /must be null/);
});

function canonicalProjectionDigest(receipt) {
  const { projectionDigest: _projectionDigest, ...core } = receipt;
  return `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`;
}
