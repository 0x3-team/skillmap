import { createHash, verify as verifySignature } from 'node:crypto';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson } from '../core/canonical-payload.js';
import { parseFrontmatter } from '../core/frontmatter.js';
import {
  computeGithubSnapshotManifestDigest,
  computeSnapshotContentRevision,
  validateGithubRepository,
  validateGithubSubtree,
  type GithubSourceSnapshot
} from '../network/github-source-fetcher.js';

export const HOSTED_AUDIT_VERSION = 'skillmap-static-audit/v2' as const;
export const HOSTED_GRADE_RUBRIC_VERSION = 'skillmap-rubric/v1' as const;

const MAX_ENTRYPOINT_BYTES = 256 * 1024;
const MAX_SNAPSHOT_FILE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 500;
const EXACT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SCRIPT_EXTENSION = /\.(?:bat|cmd|cjs|exe|js|mjs|ps1|py|rb|sh|ts)$/i;
const BROAD_TRIGGER = /\b(?:anything|everything|all tasks|general purpose|any coding|all coding|useful for all)\b/i;
const NETWORK_INDICATOR = /(?:https?:\/\/|\bcurl\b|\bwget\b|\bfetch\s*\(|\brequests\.(?:get|post)\s*\()/i;
const TOOL_INDICATOR = /\b(?:bash|exec_command|computer-use|mcp__[a-z0-9_-]+|powershell|terminal)\b/i;
const CRITICAL_INSTRUCTION = /(?:ignore (?:all |any )?(?:previous|prior|system) instructions|reveal (?:a |the )?(?:secret|token|credential|private key)|disable (?:safety|security)|exfiltrat(?:e|ion))/i;
const DESTRUCTIVE_COMMAND = /(?:rm\s+-rf\s+(?:\/|~)|mkfs\b|dd\s+if=.+\s+of=\/dev\/|curl\b[^\n|]*\|\s*(?:ba)?sh\b|wget\b[^\n|]*\|\s*(?:ba)?sh\b)/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/
];
// The public alpha confirms only common, unambiguous redistribution licenses.
// Compound SPDX expressions need a real license-expression parser and an
// operator policy decision, so they fail closed instead of being regex-blessed.
const ALLOWED_SPDX_IDENTIFIERS = new Set([
  '0BSD',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'Unlicense'
]);

export type HostedAuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type HostedAuditState = 'passed' | 'warnings' | 'blocked';
export type HostedGradeState = 'provisional' | 'current' | 'blocked';
export type HostedGradeBand = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HostedAuditFinding {
  code: string;
  severity: HostedAuditSeverity;
  message: string;
  path: string;
}

export interface HostedLicenseEvidence {
  repositoryUrl: string;
  sourceCommit: string;
  path: string;
  contentDigest: string;
}

export interface HostedAuditOptions {
  sourcePath: string;
  license: {
    state: 'confirmed' | 'noassertion' | 'restricted';
    spdxExpression?: string;
    evidence?: HostedLicenseEvidence[];
  };
}

export interface HostedAuditReceiptCore {
  kind: 'skillmap.hosted-static-audit';
  schemaVersion: 1;
  auditVersion: typeof HOSTED_AUDIT_VERSION;
  subject: {
    repository: string;
    commit: string;
    sourcePath: string;
    manifestDigest: string;
    contentRevision: string;
    normalizedEvaluationDigest: string;
    entrypointContentDigest: string;
  };
  state: HostedAuditState;
  findingCounts: Record<HostedAuditSeverity, number>;
  findings: HostedAuditFinding[];
  permissions: {
    scripts: boolean;
    executableFiles: string[];
    networkIndicators: boolean;
    toolIndicators: boolean;
  };
  compatibility: {
    host: 'codex';
    state: 'not-tested' | 'declared' | 'blocked';
    reasonCodes: string[];
  };
  license: {
    state: 'confirmed' | 'noassertion' | 'restricted';
    spdxExpression: string | null;
    evidenceFiles: string[];
    evidence: HostedLicenseEvidence[];
  };
  metrics: {
    entrypointBytes: number;
    bodyBytes: number;
    descriptionBytes: number;
    fileCount: number;
    totalBytes: number;
  };
}

export interface HostedAuditReceipt extends HostedAuditReceiptCore {
  receiptDigest: string;
}

export interface HostedCompatibilityEvidenceCore {
  kind: 'skillmap.hosted-compatibility-evidence';
  schemaVersion: 1;
  issuerKeyId: string;
  signature: string;
  subject: {
    normalizedPackageDigest: string;
    auditReceiptDigest: string;
    hostProfileVersion: string;
  };
  state: 'compatible' | 'blocked';
  reasonCodes: string[];
}

export interface HostedCompatibilityEvidence extends HostedCompatibilityEvidenceCore {
  receiptDigest: string;
}

export interface HostedBehavioralEvidence {
  kind: 'skillmap.hosted-behavioral-evidence';
  schemaVersion: 1;
  issuerKeyId: string;
  signature: string;
  receiptDigest: string;
  subject: {
    normalizedPackageDigest: string;
    auditReceiptDigest: string;
    compatibilityReceiptDigest: string;
    hostProfileVersion: string;
    rubricVersion: typeof HOSTED_GRADE_RUBRIC_VERSION;
  };
  suiteDigest: string;
  baselineDigest: string;
  evaluatorDigest: string;
  heldOutCases: number;
  trials: number;
  taskSuccessRate: number;
  baselineDelta: number;
  variance: number;
}

export interface HostedGradeInput {
  normalizedPackageDigest: string;
  auditReceipt: HostedAuditReceipt;
  compatibilityEvidence?: HostedCompatibilityEvidence;
  compatibilityReceiptDigest?: string;
  hostProfileVersion: string;
  behavioral?: HostedBehavioralEvidence;
  trustedEvidenceIssuers?: Readonly<Record<string, string>>;
}

export interface HostedGradeEvaluationCore {
  kind: 'skillmap.hosted-grade-evaluation';
  schemaVersion: 1;
  rubricVersion: typeof HOSTED_GRADE_RUBRIC_VERSION;
  hostProfileVersion: string;
  subject: {
    repository: string;
    commit: string;
    sourcePath: string;
    normalizedPackageDigest: string;
    auditReceiptDigest: string;
    compatibilityReceiptDigest: string | null;
  };
  state: HostedGradeState;
  band: HostedGradeBand | null;
  score: number | null;
  confidence: number;
  dimensionScores: {
    instructionQuality: number;
    safetyAndPermissions: number;
    routingQuality: number;
    reproducibility: number;
    maintenanceAndProvenance: number;
  };
  hardGateReasonCodes: string[];
  evidence: {
    suiteDigest: string | null;
    baselineDigest: string | null;
    evaluatorDigest: string | null;
    heldOutCases: number;
    trials: number;
    taskSuccessRate: number | null;
    baselineDelta: number | null;
    variance: number | null;
  };
}

export interface HostedGradeEvaluation extends HostedGradeEvaluationCore {
  receiptDigest: string;
}

export function createHostedDeclaredCompatibilityReceiptDigest(
  auditReceipt: HostedAuditReceipt,
  hostProfileVersion: string
): string {
  assertReceiptIntegrity(auditReceipt);
  assertBoundedLabel(hostProfileVersion, 'hostProfileVersion');
  if (auditReceipt.compatibility.state !== 'declared') {
    throw new Error('A declared compatibility reference requires a structurally compatible audit receipt.');
  }
  return digestCanonical({
    kind: 'skillmap.hosted-declared-compatibility-reference',
    schemaVersion: 1,
    normalizedPackageDigest: auditReceipt.subject.normalizedEvaluationDigest,
    auditReceiptDigest: auditReceipt.receiptDigest,
    hostProfileVersion,
    state: 'declared'
  });
}

export function auditHostedSkillSnapshot(
  snapshot: GithubSourceSnapshot,
  options: HostedAuditOptions
): HostedAuditReceipt {
  assertSnapshotIdentity(snapshot);
  const sourcePath = normalizeSourcePath(options.sourcePath);
  const entrypointPath = relativeSnapshotPath(snapshot.subtree, sourcePath);
  const entrypoint = snapshot.files.find((file) => file.path === entrypointPath);
  if (!entrypoint) throw new Error('The exact submitted SKILL.md path is absent from the immutable source snapshot.');
  if (entrypoint.size > MAX_ENTRYPOINT_BYTES) throw new Error(`The submitted SKILL.md exceeds ${MAX_ENTRYPOINT_BYTES} bytes.`);

  const text = decodeEntrypoint(entrypoint.bytes);
  const parsed = parseFrontmatter(text);
  const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
  const findings: HostedAuditFinding[] = [];
  const add = (code: string, severity: HostedAuditSeverity, message: string, path = sourcePath): void => {
    findings.push({ code, severity, message, path });
  };

  if (!parsed.valid) add('invalid-frontmatter', 'critical', 'Required YAML frontmatter is invalid.');
  if (!description) add('missing-description', 'high', 'A trigger-focused description is required.');
  if (description.length > 650) add('long-description', 'medium', 'The description exceeds the routing-quality target.');
  if (description && BROAD_TRIGGER.test(description)) add('broad-trigger', 'medium', 'The description uses overly broad routing language.');
  if (!parsed.body.trim()) add('empty-body', 'high', 'The skill body does not contain an actionable workflow.');
  if (Buffer.byteLength(parsed.body, 'utf8') > 12_000) add('large-body', 'low', 'The skill body should move branch-specific detail behind references.');
  const executableFiles = snapshot.files
    .filter((file) => file.mode === '100755' || SCRIPT_EXTENSION.test(file.path))
    .map((file) => qualifySnapshotPath(snapshot.subtree, file.path))
    .sort(compareText);
  if (executableFiles.length > 0) add('script-bearing', 'medium', 'The submitted tree contains scripts or executable files.');

  const decodedFiles: Array<{ path: string; text: string }> = [];
  for (const file of snapshot.files) {
    const fileText = tryDecodeText(file.bytes);
    if (fileText === null) {
      add('binary-file', 'critical', 'The submitted tree contains a binary or non-UTF-8 file that cannot be statically inspected.', qualifySnapshotPath(snapshot.subtree, file.path));
      continue;
    }
    const qualifiedPath = qualifySnapshotPath(snapshot.subtree, file.path);
    decodedFiles.push({ path: qualifiedPath, text: fileText });
    if (CRITICAL_INSTRUCTION.test(fileText)) {
      add('critical-instruction-confusion', 'critical', 'The submitted tree contains instruction-confusion or exfiltration language.', qualifiedPath);
    }
    if (DESTRUCTIVE_COMMAND.test(fileText)) {
      add('destructive-command', 'critical', 'The submitted tree contains an unbounded destructive or remote-shell command pattern.', qualifiedPath);
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(fileText))) {
      add('credential-material', 'critical', 'The submitted tree appears to contain credential or private-key material.', qualifiedPath);
    }
    if (/(?:^|["'(\s])\.\.\/(?:[^\s)]*)/m.test(fileText)) {
      add('parent-path-reference', 'high', 'The submitted tree contains a parent-directory path reference.', qualifiedPath);
    }
  }
  const networkIndicators = decodedFiles.some((file) => NETWORK_INDICATOR.test(file.text));
  const toolIndicators = decodedFiles.some((file) => TOOL_INDICATOR.test(file.text));

  const snapshotLicenseEvidence = snapshot.files
    .map((file) => ({
      repositoryUrl: `https://github.com/${snapshot.repository}`,
      sourceCommit: snapshot.resolvedCommit,
      path: qualifySnapshotPath(snapshot.subtree, file.path),
      contentDigest: file.contentDigest
    }))
    .filter((item) => /(?:^|\/)(?:licen[cs]e|copying)(?:\.[a-z0-9_-]+)?$/i.test(item.path))
    .filter((item) => isEnclosingLicensePath(item.path, sourcePath));
  const licenseEvidence = mergeLicenseEvidence(
    snapshotLicenseEvidence,
    options.license.evidence,
    snapshot,
    sourcePath,
    options.license.state
  );
  const licenseFiles = licenseEvidence.map((item) => item.path);
  const spdxExpression = normalizeSpdx(options.license.spdxExpression);
  if (options.license.state === 'restricted') add('restricted-license', 'critical', 'The reviewed license disposition blocks publication.');
  if (options.license.state !== 'confirmed') add('license-unresolved', 'high', 'A reviewed redistribution license has not been confirmed.');
  if (options.license.state === 'confirmed' && !spdxExpression) add('license-expression-missing', 'high', 'A confirmed license requires a bounded SPDX expression.');
  if (licenseFiles.length === 0) add('license-file-missing', 'medium', 'No license evidence file was found in the submitted tree.');

  findings.sort((left, right) => severityRank(left.severity) - severityRank(right.severity)
    || compareText(left.code, right.code) || compareText(left.path, right.path));
  const findingCounts = countFindings(findings);
  const blocked = findingCounts.critical > 0 || findings.some((finding) =>
    finding.code === 'invalid-frontmatter' || finding.code === 'license-unresolved' || finding.code === 'license-expression-missing'
  );
  const state: HostedAuditState = blocked ? 'blocked' : findings.length > 0 ? 'warnings' : 'passed';
  const compatibilityReasons = [
    ...(!parsed.valid ? ['invalid-frontmatter'] : []),
    ...(!parsed.body.trim() ? ['empty-body'] : []),
    ...(!sourcePath.endsWith('SKILL.md') ? ['invalid-entrypoint-name'] : [])
  ].sort(compareText);
  const core: HostedAuditReceiptCore = {
    kind: 'skillmap.hosted-static-audit',
    schemaVersion: 1,
    auditVersion: HOSTED_AUDIT_VERSION,
    subject: {
      repository: snapshot.repository,
      commit: snapshot.resolvedCommit,
      sourcePath,
      manifestDigest: snapshot.manifestDigest,
      contentRevision: computeSnapshotContentRevision(snapshot),
      normalizedEvaluationDigest: computeNormalizedEvaluationDigest(snapshot),
      entrypointContentDigest: entrypoint.contentDigest
    },
    state,
    findingCounts,
    findings,
    permissions: {
      scripts: executableFiles.length > 0,
      executableFiles,
      networkIndicators,
      toolIndicators
    },
    compatibility: {
      host: 'codex',
      state: compatibilityReasons.length > 0 ? 'blocked' : 'declared',
      reasonCodes: compatibilityReasons
    },
    license: {
      state: options.license.state,
      spdxExpression,
      evidenceFiles: licenseFiles,
      evidence: licenseEvidence
    },
    metrics: {
      entrypointBytes: entrypoint.size,
      bodyBytes: Buffer.byteLength(parsed.body, 'utf8'),
      descriptionBytes: Buffer.byteLength(description, 'utf8'),
      fileCount: snapshot.files.length,
      totalBytes: snapshot.totalBytes
    }
  };
  return { ...core, receiptDigest: digestCanonical(core) };
}

export function gradeHostedSkill(input: HostedGradeInput): HostedGradeEvaluation {
  assertDigest(input.normalizedPackageDigest, 'normalizedPackageDigest');
  assertDigest(input.auditReceipt.receiptDigest, 'auditReceipt.receiptDigest');
  assertBoundedLabel(input.hostProfileVersion, 'hostProfileVersion');
  if (input.compatibilityReceiptDigest) assertDigest(input.compatibilityReceiptDigest, 'compatibilityReceiptDigest');
  assertReceiptIntegrity(input.auditReceipt);
  if (input.normalizedPackageDigest !== input.auditReceipt.subject.normalizedEvaluationDigest) {
    throw new Error('normalizedPackageDigest must equal the audited normalized evaluation digest.');
  }
  const compatibilityReceiptDigest = validateCompatibilityEvidence(input);

  const dimensionScores = computeDimensions(input.auditReceipt);
  const hardGateReasonCodes = gradeHardGates(input, compatibilityReceiptDigest).sort(compareText);
  const completeBehavioral = Boolean(input.compatibilityEvidence?.state === 'compatible')
    && behavioralEvidenceComplete(input.behavioral, input, compatibilityReceiptDigest);
  const staticScore = weightedScore(dimensionScores);
  const behavioralAdjustment = completeBehavioral && input.behavioral
    ? clamp(Math.round((input.behavioral.taskSuccessRate * 70) + (Math.max(-0.2, Math.min(0.2, input.behavioral.baselineDelta)) + 0.2) * 75), 0, 100)
    : null;
  const score = hardGateReasonCodes.length > 0
    ? null
    : behavioralAdjustment !== null
      ? clamp(Math.round(staticScore * 0.7 + behavioralAdjustment * 0.3), 0, 100)
      : staticScore;
  const state: HostedGradeState = hardGateReasonCodes.length > 0
    ? 'blocked'
    : completeBehavioral
      ? 'current'
      : 'provisional';
  const band = state === 'current' && score !== null ? bandForScore(score) : null;
  const confidence = input.behavioral && completeBehavioral
    ? clamp(round4(0.95 - Math.min(input.behavioral.variance, 0.4)), 0.5, 0.95)
    : state === 'blocked' ? 0 : 0.35;
  const evidence = input.behavioral ? {
    suiteDigest: input.behavioral.suiteDigest,
    baselineDigest: input.behavioral.baselineDigest,
    evaluatorDigest: input.behavioral.evaluatorDigest,
    heldOutCases: input.behavioral.heldOutCases,
    trials: input.behavioral.trials,
    taskSuccessRate: round4(input.behavioral.taskSuccessRate),
    baselineDelta: round4(input.behavioral.baselineDelta),
    variance: round4(input.behavioral.variance)
  } : {
    suiteDigest: null,
    baselineDigest: null,
    evaluatorDigest: null,
    heldOutCases: 0,
    trials: 0,
    taskSuccessRate: null,
    baselineDelta: null,
    variance: null
  };
  const core: HostedGradeEvaluationCore = {
    kind: 'skillmap.hosted-grade-evaluation',
    schemaVersion: 1,
    rubricVersion: HOSTED_GRADE_RUBRIC_VERSION,
    hostProfileVersion: input.hostProfileVersion,
    subject: {
      repository: input.auditReceipt.subject.repository,
      commit: input.auditReceipt.subject.commit,
      sourcePath: input.auditReceipt.subject.sourcePath,
      normalizedPackageDigest: input.normalizedPackageDigest,
      auditReceiptDigest: input.auditReceipt.receiptDigest,
      compatibilityReceiptDigest
    },
    state,
    band,
    score,
    confidence,
    dimensionScores,
    hardGateReasonCodes,
    evidence
  };
  return { ...core, receiptDigest: digestCanonical(core) };
}

function computeDimensions(audit: HostedAuditReceipt): HostedGradeEvaluationCore['dimensionScores'] {
  const codes = new Set(audit.findings.map((finding) => finding.code));
  const highRisk = audit.findingCounts.critical * 50 + audit.findingCounts.high * 25
    + audit.findingCounts.medium * 10 + audit.findingCounts.low * 3;
  return {
    instructionQuality: clamp(100 - (codes.has('invalid-frontmatter') ? 70 : 0) - (codes.has('missing-description') ? 45 : 0)
      - (codes.has('empty-body') ? 50 : 0) - (codes.has('large-body') ? 8 : 0), 0, 100),
    safetyAndPermissions: clamp(100 - highRisk - (audit.permissions.scripts ? 10 : 0)
      - (audit.permissions.networkIndicators ? 5 : 0), 0, 100),
    routingQuality: clamp(100 - (codes.has('broad-trigger') ? 35 : 0) - (codes.has('long-description') ? 15 : 0)
      - (codes.has('missing-description') ? 60 : 0), 0, 100),
    reproducibility: clamp(100 - (codes.has('parent-path-reference') ? 40 : 0) - (codes.has('binary-file') ? 10 : 0), 0, 100),
    maintenanceAndProvenance: clamp(100 - (audit.license.state !== 'confirmed' ? 70 : 0)
      - (audit.license.evidenceFiles.length === 0 ? 20 : 0), 0, 100)
  };
}

function gradeHardGates(input: HostedGradeInput, compatibilityReceiptDigest: string | null): string[] {
  const reasons: string[] = [];
  if (input.auditReceipt.state === 'blocked') reasons.push('audit-blocked');
  if (input.auditReceipt.compatibility.state !== 'declared') reasons.push('compatibility-blocked');
  if (input.compatibilityEvidence?.state === 'blocked') reasons.push('compatibility-evidence-blocked');
  if (input.auditReceipt.license.state !== 'confirmed') reasons.push('license-unresolved');
  if (!input.auditReceipt.license.spdxExpression) reasons.push('license-expression-missing');
  if (!compatibilityReceiptDigest) reasons.push('compatibility-receipt-missing');
  return [...new Set(reasons)];
}

function validateCompatibilityEvidence(input: HostedGradeInput): string | null {
  const value = input.compatibilityEvidence;
  if (!value) return input.compatibilityReceiptDigest ?? null;
  assertExactKeys(value, [
    'kind', 'schemaVersion', 'issuerKeyId', 'signature', 'subject', 'state', 'reasonCodes', 'receiptDigest'
  ], 'compatibility evidence');
  if (value.kind !== 'skillmap.hosted-compatibility-evidence' || value.schemaVersion !== 1) {
    throw new Error('Compatibility evidence has an unsupported kind or schema version.');
  }
  assertExactKeys(value.subject, [
    'normalizedPackageDigest', 'auditReceiptDigest', 'hostProfileVersion'
  ], 'compatibility evidence subject');
  assertReasonCodes(value.reasonCodes, 'compatibility evidence');
  if (value.state !== 'compatible' && value.state !== 'blocked') {
    throw new Error('Compatibility evidence has an unsupported state.');
  }
  if ((value.state === 'compatible' && value.reasonCodes.length !== 0)
    || (value.state === 'blocked' && value.reasonCodes.length === 0)) {
    throw new Error('Compatibility evidence state and reason codes are inconsistent.');
  }
  assertTrustedStructuredReceipt(input, value, 'compatibility evidence');
  assertDigest(value.subject.normalizedPackageDigest, 'compatibility.subject.normalizedPackageDigest');
  assertDigest(value.subject.auditReceiptDigest, 'compatibility.subject.auditReceiptDigest');
  assertBoundedLabel(value.subject.hostProfileVersion, 'compatibility.subject.hostProfileVersion');
  if (value.subject.normalizedPackageDigest !== input.normalizedPackageDigest
    || value.subject.auditReceiptDigest !== input.auditReceipt.receiptDigest
    || value.subject.hostProfileVersion !== input.hostProfileVersion) {
    throw new Error('Compatibility evidence must be bound to the audited package, audit receipt, and host profile.');
  }
  if (input.compatibilityReceiptDigest && input.compatibilityReceiptDigest !== value.receiptDigest) {
    throw new Error('compatibilityReceiptDigest must match the structured compatibility evidence.');
  }
  return value.receiptDigest;
}

function behavioralEvidenceComplete(
  value: HostedBehavioralEvidence | undefined,
  input: HostedGradeInput,
  compatibilityReceiptDigest: string | null
): boolean {
  if (!value) return false;
  assertExactKeys(value, [
    'kind', 'schemaVersion', 'issuerKeyId', 'signature', 'receiptDigest', 'subject',
    'suiteDigest', 'baselineDigest', 'evaluatorDigest', 'heldOutCases', 'trials',
    'taskSuccessRate', 'baselineDelta', 'variance'
  ], 'behavioral evidence');
  if (value.kind !== 'skillmap.hosted-behavioral-evidence' || value.schemaVersion !== 1) {
    throw new Error('Behavioral evidence has an unsupported kind or schema version.');
  }
  assertExactKeys(value.subject, [
    'normalizedPackageDigest', 'auditReceiptDigest', 'compatibilityReceiptDigest',
    'hostProfileVersion', 'rubricVersion'
  ], 'behavioral evidence subject');
  assertTrustedStructuredReceipt(input, value, 'behavioral evidence');
  for (const [name, digest] of [
    ['subject.normalizedPackageDigest', value.subject.normalizedPackageDigest],
    ['subject.auditReceiptDigest', value.subject.auditReceiptDigest],
    ['subject.compatibilityReceiptDigest', value.subject.compatibilityReceiptDigest]
  ] as const) assertDigest(digest, name);
  assertBoundedLabel(value.subject.hostProfileVersion, 'behavioral.subject.hostProfileVersion');
  if (value.subject.normalizedPackageDigest !== input.normalizedPackageDigest
    || value.subject.auditReceiptDigest !== input.auditReceipt.receiptDigest
    || value.subject.compatibilityReceiptDigest !== compatibilityReceiptDigest
    || value.subject.hostProfileVersion !== input.hostProfileVersion
    || value.subject.rubricVersion !== HOSTED_GRADE_RUBRIC_VERSION) {
    throw new Error('Behavioral evidence must be bound to the audited package, audit, compatibility, host, and rubric.');
  }
  for (const [name, digest] of [
    ['suiteDigest', value.suiteDigest],
    ['baselineDigest', value.baselineDigest],
    ['evaluatorDigest', value.evaluatorDigest]
  ] as const) assertDigest(digest, name);
  for (const [name, number] of [
    ['taskSuccessRate', value.taskSuccessRate],
    ['variance', value.variance]
  ] as const) {
    if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be between 0 and 1.`);
  }
  if (!Number.isFinite(value.baselineDelta) || value.baselineDelta < -1 || value.baselineDelta > 1) {
    throw new Error('baselineDelta must be between -1 and 1.');
  }
  if (!Number.isInteger(value.heldOutCases) || value.heldOutCases < 0 || !Number.isInteger(value.trials) || value.trials < 0) {
    throw new Error('Behavioral case and trial counts must be non-negative integers.');
  }
  return value.heldOutCases >= 30 && value.trials >= 3;
}

function assertSnapshotIdentity(snapshot: GithubSourceSnapshot): void {
  if (snapshot.version !== 1 || snapshot.provider !== 'github') throw new Error('Hosted audits require a GitHub snapshot v1 envelope.');
  if (validateGithubRepository(snapshot.repository) !== snapshot.repository) throw new Error('Hosted audits require a canonical GitHub repository identity.');
  if (!EXACT_COMMIT.test(snapshot.resolvedCommit)) throw new Error('Hosted audits require an immutable lowercase GitHub commit.');
  if (snapshot.requestedRef !== snapshot.resolvedCommit) throw new Error('Hosted audits require the requested ref to equal the resolved immutable commit.');
  const normalizedSubtree = validateGithubSubtree(snapshot.subtree);
  if ((normalizedSubtree || '.') !== snapshot.subtree) throw new Error('Hosted audits require a canonical source subtree.');
  assertDigest(snapshot.manifestDigest, 'snapshot.manifestDigest');
  if (computeGithubSnapshotManifestDigest(snapshot) !== snapshot.manifestDigest) {
    throw new Error('Hosted audit snapshot manifest digest mismatch.');
  }
  if (snapshot.files.length === 0 || snapshot.totalBytes < 1) throw new Error('Hosted audits require a non-empty immutable source snapshot.');
  if (snapshot.files.length > MAX_SNAPSHOT_FILES) throw new Error(`Hosted audits accept at most ${MAX_SNAPSHOT_FILES} files.`);
  if (snapshot.totalBytes > MAX_SNAPSHOT_BYTES) throw new Error(`Hosted audits accept at most ${MAX_SNAPSHOT_BYTES} bytes.`);
  const entryPaths = new Set<string>();
  const fileEntries = new Map<string, GithubSourceSnapshot['entries'][number]>();
  for (const entry of snapshot.entries) {
    assertSnapshotPath(entry.path);
    if (entryPaths.has(entry.path)) throw new Error('Hosted audit snapshot manifests cannot contain duplicate paths.');
    entryPaths.add(entry.path);
    if (entry.type === 'file') fileEntries.set(entry.path, entry);
  }
  if (fileEntries.size !== snapshot.files.length) {
    throw new Error('Hosted audit snapshot manifest and file sets must have exact parity.');
  }
  const paths = new Set<string>();
  let observedBytes = 0;
  for (const file of snapshot.files) {
    assertSnapshotPath(file.path);
    if (paths.has(file.path)) throw new Error('Hosted audit snapshots cannot contain duplicate paths.');
    paths.add(file.path);
    if (file.bytes.length !== file.size || file.size < 0 || file.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error('Hosted audit snapshot file sizes must match bounded bytes.');
    }
    const observedDigest = `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`;
    if (file.contentDigest !== observedDigest) throw new Error('Hosted audit snapshot content digest mismatch.');
    const entry = fileEntries.get(file.path);
    if (!entry || entry.type !== 'file' || entry.mode !== file.mode || entry.size !== file.size
      || entry.blobDigest !== file.blobDigest || entry.contentDigest !== file.contentDigest) {
      throw new Error('Hosted audit snapshot manifest and file metadata must match exactly.');
    }
    observedBytes += file.size;
  }
  if (observedBytes !== snapshot.totalBytes) throw new Error('Hosted audit snapshot totalBytes mismatch.');
}

function relativeSnapshotPath(subtree: string, sourcePath: string): string {
  if (subtree === '.') return sourcePath;
  const prefix = `${subtree}/`;
  if (!sourcePath.startsWith(prefix) || sourcePath.length === prefix.length) {
    throw new Error('The submitted SKILL.md path is outside the fetched immutable subtree.');
  }
  return sourcePath.slice(prefix.length);
}

function qualifySnapshotPath(subtree: string, relativePath: string): string {
  return subtree === '.' ? relativePath : `${subtree}/${relativePath}`;
}

function assertSnapshotPath(value: string): void {
  if (!value || value.length > 4_096 || value !== value.normalize('NFC') || value.startsWith('/') || value.endsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)
    || value.split('/').some((component) => !component || component === '.' || component === '..')) {
    throw new Error('Hosted audit snapshots require normalized relative file paths.');
  }
}

function normalizeSourcePath(value: string): string {
  const components = typeof value === 'string' ? value.split('/') : [];
  if (typeof value !== 'string' || value !== value.trim() || value.length < 8 || value.length > 500
    || value !== value.normalize('NFC') || value.startsWith('/') || value.endsWith('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
    || components.some((component) => !component || component === '.' || component === '..')
    || !/(?:^|\/)SKILL\.md$/.test(value)) {
    throw new Error('sourcePath must be a safe relative path ending in SKILL.md.');
  }
  return value;
}

function mergeLicenseEvidence(
  snapshotEvidence: HostedLicenseEvidence[],
  additionalEvidence: HostedLicenseEvidence[] | undefined,
  snapshot: GithubSourceSnapshot,
  sourcePath: string,
  licenseState: HostedAuditOptions['license']['state']
): HostedLicenseEvidence[] {
  if (additionalEvidence !== undefined && licenseState !== 'confirmed') {
    throw new Error('Exact external license evidence is accepted only for a confirmed license review.');
  }
  if (additionalEvidence !== undefined && (!Array.isArray(additionalEvidence) || additionalEvidence.length > 20)) {
    throw new Error('Exact external license evidence must contain at most 20 files.');
  }
  const expectedRepositoryUrl = `https://github.com/${snapshot.repository}`;
  const byPath = new Map<string, HostedLicenseEvidence>();
  const addEvidence = (item: HostedLicenseEvidence, external: boolean): void => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Exact external license evidence must use the supported object schema.');
    }
    if (external) {
      assertExactKeys(item, ['repositoryUrl', 'sourceCommit', 'path', 'contentDigest'], 'external license evidence');
    }
    if (item.repositoryUrl !== expectedRepositoryUrl || item.sourceCommit !== snapshot.resolvedCommit) {
      throw new Error('Exact external license evidence must match the audited repository and immutable commit.');
    }
    if (typeof item.path !== 'string' || item.path.length > 500) {
      throw new Error('Exact external license evidence path is invalid.');
    }
    try {
      assertSnapshotPath(item.path);
    } catch {
      throw new Error('Exact external license evidence path is invalid.');
    }
    if (!/(?:^|\/)(?:licen[cs]e|copying)(?:\.[a-z0-9_-]+)?$/i.test(item.path)
      || !isEnclosingLicensePath(item.path, sourcePath)) {
      throw new Error('Exact external license evidence must be a root or enclosing license file for the submitted skill.');
    }
    if (typeof item.contentDigest !== 'string' || !DIGEST.test(item.contentDigest)) {
      throw new Error('Exact external license evidence contentDigest must be a lowercase sha256 digest.');
    }
    const existing = byPath.get(item.path);
    if (existing && existing.contentDigest !== item.contentDigest) {
      throw new Error('Exact external license evidence conflicts with the fetched skill snapshot.');
    }
    byPath.set(item.path, { ...item });
  };
  for (const item of snapshotEvidence) addEvidence(item, false);
  for (const item of additionalEvidence ?? []) addEvidence(item, true);
  if (byPath.size > 20) throw new Error('Confirmed license evidence must contain at most 20 exact files.');
  return [...byPath.values()].sort((left, right) => compareText(left.path, right.path));
}

function isEnclosingLicensePath(licensePath: string, sourcePath: string): boolean {
  const licenseDirectory = path.posix.dirname(licensePath);
  const sourceDirectory = path.posix.dirname(sourcePath);
  if (licenseDirectory === '.') return true;
  return sourceDirectory === licenseDirectory || sourceDirectory.startsWith(`${licenseDirectory}/`);
}

function decodeEntrypoint(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The submitted SKILL.md is not valid UTF-8 text.');
  }
}

function normalizeSpdx(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!ALLOWED_SPDX_IDENTIFIERS.has(normalized)) {
    throw new Error('spdxExpression is not an approved public-alpha SPDX identifier.');
  }
  return normalized;
}

function countFindings(findings: HostedAuditFinding[]): Record<HostedAuditSeverity, number> {
  const counts: Record<HostedAuditSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function weightedScore(scores: HostedGradeEvaluationCore['dimensionScores']): number {
  return Math.round(scores.instructionQuality * 0.25 + scores.safetyAndPermissions * 0.25
    + scores.routingQuality * 0.2 + scores.reproducibility * 0.15 + scores.maintenanceAndProvenance * 0.15);
}

function bandForScore(score: number): HostedGradeBand {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function assertReceiptIntegrity(receipt: HostedAuditReceipt): void {
  const { receiptDigest, ...core } = receipt;
  if (digestCanonical(core) !== receiptDigest) throw new Error('The audit receipt digest does not match its canonical content.');
}

function assertStructuredReceiptIntegrity(receipt: { receiptDigest: string }, label: string): void {
  assertDigest(receipt.receiptDigest, `${label}.receiptDigest`);
  const { receiptDigest, ...core } = receipt;
  if (digestCanonical(core) !== receiptDigest) throw new Error(`The ${label} digest does not match its canonical content.`);
}

function assertTrustedStructuredReceipt(
  input: HostedGradeInput,
  receipt: { receiptDigest: string; issuerKeyId: string; signature: string },
  label: string
): void {
  assertStructuredReceiptIntegrity(receipt, label);
  assertBoundedLabel(receipt.issuerKeyId, `${label}.issuerKeyId`);
  if (!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) throw new Error(`The ${label} signature is invalid.`);
  const publicKey = input.trustedEvidenceIssuers?.[receipt.issuerKeyId];
  if (!publicKey) throw new Error(`The ${label} issuer is not trusted for current-grade authority.`);
  const { receiptDigest: _receiptDigest, signature: _signature, ...signedCore } = receipt;
  let valid = false;
  try {
    valid = verifySignature(
      null,
      Buffer.from(canonicalJson(signedCore)),
      publicKey,
      Buffer.from(receipt.signature, 'base64url')
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error(`The ${label} signature is not valid for its canonical content.`);
}

function assertExactKeys(value: object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
    throw new Error(`The ${label} fields do not match the supported schema.`);
  }
}

function assertReasonCodes(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length
    || value.some((code) => typeof code !== 'string' || code.length > 64
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code))) {
    throw new Error(`The ${label} reason codes are invalid.`);
  }
}

function assertDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`${field} must be a lowercase sha256 digest.`);
}

function assertBoundedLabel(value: string, field: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must be a bounded label.`);
  }
}

function digestCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function computeNormalizedEvaluationDigest(snapshot: GithubSourceSnapshot): string {
  return digestCanonical({
    kind: 'skillmap.normalized-evaluation-package',
    schemaVersion: 1,
    files: [...snapshot.files]
      .sort((left, right) => compareText(left.path, right.path))
      .map((file) => ({
        path: file.path,
        mode: file.mode,
        size: file.size,
        contentDigest: file.contentDigest
      }))
  });
}

function tryDecodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function severityRank(value: HostedAuditSeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[value];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
