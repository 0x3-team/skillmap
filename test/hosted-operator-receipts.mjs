import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOperatorReceiptPayloads, canonicalDigest } from '../apps/worker/src/operator-receipts.mjs';

const SHA = letter => `sha256:${letter.repeat(64)}`;

test('operator projection emits an exact provisional rubric without fabricating behavioral evidence', () => {
  const auditReceipt = audit('warnings');
  const gradeEvaluation = grade('provisional');
  const payloads = buildOperatorReceiptPayloads({
    auditReceipt,
    gradeEvaluation,
    compatibilityReceiptDigest: SHA('8'),
    workerVersion: 'skillmap-worker/0.1.0'
  });
  assert.equal(payloads.grade.state, 'provisional');
  assert.equal(payloads.grade.totalScore, 82);
  assert.equal(payloads.grade.evaluationSuiteDigest, null);
  assert.equal(payloads.audit.licenseState, 'confirmed');
  assert.equal(payloads.audit.spdxExpression, 'MIT');
  assert.equal(payloads.audit.permissionScripts, false);
  assert.equal(payloads.audit.networkIndicators, false);
  assert.equal(payloads.audit.toolIndicators, false);
  assert.deepEqual(payloads.grade.dimensions.map(dimension => [dimension.code, dimension.weight]), [
    ['instruction-quality', 0.25],
    ['safety-and-permissions', 0.25],
    ['routing-quality', 0.20],
    ['reproducibility', 0.15],
    ['maintenance-and-provenance', 0.15]
  ]);
  assert.deepEqual(payloads.grade.hardGates.map(gate => [gate.code, gate.passed]), [
    ['source-identity', true],
    ['audit-acceptable', true],
    ['license-confirmed', true],
    ['compatibility-evidence-bound', true],
    ['behavioral-evidence-bound', false]
  ]);
  assert.deepEqual(payloads.grade.reasonCodes, ['behavioral-evidence-incomplete']);
  assert.match(canonicalDigest(payloads), /^sha256:[0-9a-f]{64}$/);
});

test('operator projection keeps blocked audit and grade evidence fail-closed', () => {
  const auditReceipt = audit('blocked');
  auditReceipt.findings = [{ code: 'credential-material', severity: 'critical', message: 'blocked', path: 'SKILL.md' }];
  auditReceipt.findingCounts = { critical: 1, high: 0, medium: 0, low: 0, info: 0 };
  auditReceipt.license = { state: 'noassertion', spdxExpression: null, evidenceFiles: [] };
  const payloads = buildOperatorReceiptPayloads({
    auditReceipt,
    gradeEvaluation: grade('blocked'),
    compatibilityReceiptDigest: null,
    workerVersion: 'skillmap-worker/0.1.0'
  });
  assert.equal(payloads.audit.publicChecks[0].outcome, 'blocked');
  assert.equal(payloads.grade.state, 'blocked');
  assert.equal(payloads.grade.totalScore, null);
  assert.equal(payloads.grade.confidence, null);
  assert.equal(payloads.grade.hardGates.find(gate => gate.code === 'license-confirmed').passed, false);
});

test('operator projection aggregates repeated finding codes into one deterministic public check', () => {
  const auditReceipt = audit('blocked');
  auditReceipt.findings = [
    { code: 'credential-material', severity: 'high', message: 'first', path: 'one.txt' },
    { code: 'binary-file', severity: 'low', message: 'binary', path: 'asset.bin' },
    { code: 'credential-material', severity: 'critical', message: 'second', path: 'two.txt' },
    { code: 'binary-file', severity: 'medium', message: 'binary again', path: 'nested/asset.bin' }
  ];
  auditReceipt.findingCounts = { critical: 1, high: 1, medium: 1, low: 1, info: 0 };
  const payloads = buildOperatorReceiptPayloads({
    auditReceipt,
    gradeEvaluation: grade('blocked'),
    compatibilityReceiptDigest: null,
    workerVersion: 'skillmap-worker/0.1.0'
  });
  assert.deepEqual(payloads.audit.publicChecks, [
    { code: 'binary-file', outcome: 'warning', severity: 'medium', evidenceDigest: null },
    { code: 'credential-material', outcome: 'blocked', severity: 'critical', evidenceDigest: null }
  ]);
  assert.deepEqual(payloads.audit.reasonCodes, ['binary-file', 'credential-material']);
});

function audit(state) {
  return {
    auditVersion: 'skillmap-static-audit/v1',
    receiptDigest: SHA('a'),
    state,
    subject: {
      manifestDigest: SHA('b'), entrypointContentDigest: SHA('c'),
      normalizedEvaluationDigest: SHA('d'), contentRevision: SHA('e')
    },
    findings: state === 'warnings'
      ? [{ code: 'script-bearing', severity: 'medium', message: 'warning', path: 'scripts/check.sh' }]
      : [],
    findingCounts: state === 'warnings'
      ? { critical: 0, high: 0, medium: 1, low: 0, info: 0 }
      : { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    license: { state: 'confirmed', spdxExpression: 'MIT', evidenceFiles: ['LICENSE'] },
    permissions: { scripts: false, networkIndicators: false, toolIndicators: false }
  };
}

function grade(state) {
  return {
    state,
    receiptDigest: SHA('f'), rubricVersion: 'skillmap-rubric/v1', hostProfileVersion: 'codex-host/v1',
    score: state === 'provisional' ? 82 : null, confidence: state === 'provisional' ? 0.35 : 0,
    hardGateReasonCodes: state === 'blocked' ? ['audit-blocked', 'license-unresolved'] : [],
    dimensionScores: {
      instructionQuality: 90, safetyAndPermissions: 75, routingQuality: 85,
      reproducibility: 80, maintenanceAndProvenance: 78
    }
  };
}
