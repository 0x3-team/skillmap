import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../dist/core/canonical-payload.js';

const DIMENSIONS = [
  ['instruction-quality', 'instructionQuality', 0.25],
  ['safety-and-permissions', 'safetyAndPermissions', 0.25],
  ['routing-quality', 'routingQuality', 0.20],
  ['reproducibility', 'reproducibility', 0.15],
  ['maintenance-and-provenance', 'maintenanceAndProvenance', 0.15]
];
const AUDIT_BLOCKING_CODES = new Set([
  'binary-file',
  'critical-instruction-confusion',
  'credential-material',
  'destructive-command',
  'invalid-frontmatter',
  'license-expression-missing',
  'license-unresolved',
  'restricted-license'
]);
const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });

export function buildOperatorReceiptPayloads({
  auditReceipt,
  gradeEvaluation,
  compatibilityReceiptDigest,
  workerVersion,
  licenseReviewReference,
  licenseReviewEvidenceDigest
}) {
  assertDigest(auditReceipt?.receiptDigest, 'audit receipt');
  assertDigest(auditReceipt?.subject?.entrypointContentDigest, 'entrypoint content');
  assertDigest(auditReceipt?.subject?.normalizedEvaluationDigest, 'normalized content');
  assertDigest(auditReceipt?.subject?.contentRevision, 'private evidence');
  assertDigest(gradeEvaluation?.receiptDigest, 'grade receipt');
  if (typeof workerVersion !== 'string' || workerVersion.length < 1 || workerVersion.length > 128) {
    throw new Error('workerVersion is invalid.');
  }

  const auditReasonCodes = [...new Set(auditReceipt.findings.map(finding => finding.code))].sort();
  const publicChecks = aggregatePublicChecks(auditReceipt);

  const sourceGate = gate('source-identity', true, auditReceipt.subject.manifestDigest);
  const auditGate = gate('audit-acceptable', auditReceipt.state !== 'blocked', auditReceipt.receiptDigest);
  const licenseGate = gate(
    'license-confirmed',
    auditReceipt.license.state === 'confirmed' && Boolean(auditReceipt.license.spdxExpression),
    auditReceipt.receiptDigest
  );
  const compatibilityGate = gate(
    'compatibility-evidence-bound',
    Boolean(compatibilityReceiptDigest),
    compatibilityReceiptDigest ?? null
  );
  const behavioralGate = gate('behavioral-evidence-bound', false, null);
  const hardGates = [sourceGate, auditGate, licenseGate, compatibilityGate, behavioralGate];

  const dimensions = DIMENSIONS.map(([code, key, weight]) => ({
    code,
    weight,
    score: gradeEvaluation.dimensionScores[key],
    evidenceDigest: auditReceipt.receiptDigest
  }));
  const provisional = gradeEvaluation.state === 'provisional';
  if (provisional && (typeof gradeEvaluation.score !== 'number' || !compatibilityReceiptDigest)) {
    throw new Error('A provisional operator grade requires a declared compatibility reference and numeric score.');
  }
  const gradeReasonCodes = provisional
    ? ['behavioral-evidence-incomplete']
    : [...new Set([...gradeEvaluation.hardGateReasonCodes, 'grade-blocked'])].sort();

  let license = null;
  if (auditReceipt.license.state === 'confirmed') {
    if (!/^licref_[0-9a-f]{32}$/.test(licenseReviewReference ?? '')) {
      throw new Error('A confirmed license requires an opaque license review reference.');
    }
    assertDigest(licenseReviewEvidenceDigest, 'license review evidence');
    if (!Array.isArray(auditReceipt.license.evidence)
      || auditReceipt.license.evidence.length < 1
      || auditReceipt.license.evidence.length > 20) {
      throw new Error('A confirmed license requires bounded exact-file evidence.');
    }
    license = {
      auditReceiptDigest: auditReceipt.receiptDigest,
      spdxExpression: auditReceipt.license.spdxExpression,
      reviewReference: licenseReviewReference,
      reviewEvidenceDigest: licenseReviewEvidenceDigest,
      evidence: auditReceipt.license.evidence.map((item) => ({ ...item }))
    };
  }

  return {
    audit: {
      state: auditReceipt.state,
      receiptDigest: auditReceipt.receiptDigest,
      sourceContentDigest: auditReceipt.subject.entrypointContentDigest,
      normalizedContentDigest: auditReceipt.subject.normalizedEvaluationDigest,
      policyVersion: auditReceipt.auditVersion,
      hostProfileVersion: gradeEvaluation.hostProfileVersion,
      workerVersion,
      licenseState: auditReceipt.license.state,
      spdxExpression: auditReceipt.license.spdxExpression,
      permissionScripts: auditReceipt.permissions.scripts,
      networkIndicators: auditReceipt.permissions.networkIndicators,
      toolIndicators: auditReceipt.permissions.toolIndicators,
      findingCounts: auditReceipt.findingCounts,
      publicChecks,
      reasonCodes: auditReasonCodes,
      privateEvidenceDigest: auditReceipt.subject.contentRevision
    },
    grade: {
      state: provisional ? 'provisional' : 'blocked',
      receiptDigest: gradeEvaluation.receiptDigest,
      totalScore: provisional ? gradeEvaluation.score : null,
      confidence: provisional ? gradeEvaluation.confidence : null,
      normalizedContentDigest: auditReceipt.subject.normalizedEvaluationDigest,
      auditReceiptDigest: auditReceipt.receiptDigest,
      compatibilityEvidenceDigest: compatibilityReceiptDigest ?? null,
      evaluationSuiteDigest: null,
      rubricVersion: gradeEvaluation.rubricVersion,
      hostProfileVersion: gradeEvaluation.hostProfileVersion,
      evaluatorVersion: 'skillmap-grader/0.1.0',
      hardGates,
      dimensions,
      reasonCodes: gradeReasonCodes
    },
    license
  };
}

function aggregatePublicChecks(auditReceipt) {
  if (auditReceipt.findings.length === 0) {
    return [{ code: 'static-audit-complete', outcome: 'passed', severity: 'info', evidenceDigest: null }];
  }
  const checks = new Map();
  for (const finding of auditReceipt.findings) {
    const blocked = auditReceipt.state === 'blocked'
      && (finding.severity === 'critical' || AUDIT_BLOCKING_CODES.has(finding.code));
    const current = checks.get(finding.code);
    checks.set(finding.code, {
      code: finding.code,
      outcome: blocked || current?.outcome === 'blocked' ? 'blocked' : 'warning',
      severity: !current || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity]
        ? finding.severity
        : current.severity,
      evidenceDigest: null
    });
  }
  return [...checks.values()].sort((left, right) => left.code.localeCompare(right.code));
}

export function canonicalDigest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function gate(code, passed, evidenceDigest) {
  return { code, passed, evidenceDigest: passed ? evidenceDigest : evidenceDigest ?? null };
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} digest is invalid.`);
  }
}
