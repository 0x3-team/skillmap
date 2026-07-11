import { createHash } from 'node:crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SafeExportEnvelope {
  kind: 'skillmap.safe-export';
  schemaVersion: 2;
  generatedAt: string;
  workspaceId: string;
  workspaceRevision: string;
  inputDigests: Partial<Record<'config' | 'identity' | 'identityMigrations' | 'inventory' | 'doctor' | 'doctorPack' | 'doctorPackFull' | 'policy' | 'policyActivePointer' | 'policyRationale' | 'effective' | 'skillgraph' | 'sources' | 'sourceStatus' | 'sourceDecisions' | 'curationReceipt', string>>;
  producer: { name: 'skillmap'; version: string };
  compatibility: { minReaderSchemaVersion: 2; maxReaderSchemaVersion: 2 };
  redaction: {
    classification: 'shareable-redacted';
    rawPrompts: false;
    rawSkillBodies: false;
    absolutePaths: false;
    secrets: false;
    sensitiveReceipts: false;
  };
  redacted: true;
  cwd: '$PROJECT';
  payload: {
    status: { verdict: 'ok' | 'attention required' | 'blocked'; readinessPhase: string; blockerCodes: string[] };
    inventorySummary: { skillCount: number; rootCount: number; duplicateGroupCount: number; scriptBearingCount: number };
    skills: Array<{
      skillId: string;
      displayName: string;
      contentRevision: string;
      tier: 'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked';
      routeEligible: boolean;
      hasScripts: boolean;
      sourceState: 'clean' | 'modified' | 'stale' | 'risky' | 'unknown' | 'error' | 'local' | 'unclassified';
      reviewStatus: 'none' | 'reviewed' | 'held' | 'needs-review';
    }>;
    policySummary: {
      version: number;
      policyDigest: string | null;
      tierCounts: Partial<Record<'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked', number>>;
      canonicalDecisionCount: number;
      duplicateDecisionCount: number;
    };
    evalSummary: {
      present: boolean;
      evidenceLevel: string | null;
      releaseEvidenceEligible: boolean;
      count: number;
      top1Rate: number | null;
      top3Rate: number | null;
      avoidHits: number;
      effectiveRevisionDigest: string | null;
      composition: {
        total: number;
        explicit: number;
        implicitNatural: number;
        multiSkill: number;
        negativeNearMiss: number;
        untyped: number;
        releaseCounted: number;
        releaseScored: number;
      };
      holdout: { count: number; requiredCount: number; ratio: number; pass: boolean };
      leakage: { count: number; pass: boolean };
      baselinePass: boolean;
    };
    sourceSummary: {
      present: boolean;
      coverage: 'not-configured' | 'not-applicable' | 'partial' | 'covered' | null;
      inventorySkills: number;
      trackedSkills: number;
      external: number;
      localAuthored: number;
      unknown: number;
      modified: number;
      stale: number;
      riskyUpdates: number;
      errors: number;
      unreviewedNonClean: number;
    };
    curationSummary: {
      present: boolean;
      stale: boolean;
      modelVerification: 'provider-verified' | 'user-reported' | 'unverified-user-reported' | null;
    };
  };
  payloadDigest: string;
}

export interface PrivateExportArtifact {
  path: string;
  present: boolean;
  value?: unknown;
}

export interface PrivateExportEnvelope {
  kind: 'skillmap.local-private-export';
  schemaVersion: 2;
  generatedAt: string;
  workspacePath: string;
  redaction: { classification: 'local-sensitive'; shareable: false };
  artifacts: Record<string, PrivateExportArtifact>;
  payloadDigest: string;
}

const PAYLOAD_EXCLUDED_TOP_LEVEL_KEYS = new Set(['payloadDigest', 'transportDigest', 'transportMetadata']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKILL_ID_PATTERN = /^sk_[A-Za-z0-9_-]{43}$/;
const SAFE_INPUT_DIGEST_KEYS = ['config', 'identity', 'identityMigrations', 'inventory', 'doctor', 'doctorPack', 'doctorPackFull', 'policy', 'policyActivePointer', 'policyRationale', 'effective', 'skillgraph', 'sources', 'sourceStatus', 'sourceDecisions', 'curationReceipt'];
const SAFE_PAYLOAD_KEYS = ['status', 'inventorySummary', 'skills', 'policySummary', 'evalSummary', 'sourceSummary', 'curationSummary'];
const TIERS = ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'];
const SOURCE_STATES = ['clean', 'modified', 'stale', 'risky', 'unknown', 'error', 'local', 'unclassified'];
const REVIEW_STATES = ['none', 'reviewed', 'held', 'needs-review'];
const COVERAGE_STATES = ['not-configured', 'not-applicable', 'partial', 'covered'];
const MODEL_VERIFICATION_STATES = ['provider-verified', 'user-reported', 'unverified-user-reported'];
const PRIVATE_ARTIFACT_KEYS = ['config', 'identity', 'identityMigrations', 'inventory', 'policy', 'policyState', 'effective', 'skillgraph', 'sources', 'sourceStatus', 'sourceDecisions', 'evalReport', 'curationReceipt'];
const FORBIDDEN_SHARE_KEYS = new Set([
  'prompt', 'rawprompt', 'prompttext', 'rawskillbody', 'skillbody', 'skillbodytext', 'body',
  'path', 'localpath', 'root', 'roots', 'scriptpath', 'scriptpaths', 'diff', 'reason',
  'receipt', 'receipts', 'hooktoken', 'secret', 'evalfile'
]);
const SECRET_PATTERNS = [
  /CANARY_/i,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i
];

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set<object>()));
}

export function canonicalPayloadProjection(envelope: unknown): JsonValue {
  const record = asRecord(envelope, 'digest envelope');
  const projection = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (!PAYLOAD_EXCLUDED_TOP_LEVEL_KEYS.has(key)) projection[key] = value;
  }
  return canonicalValue(projection, new Set<object>());
}

export function computePayloadDigest(envelope: unknown): string {
  return hashBytes(canonicalJson(canonicalPayloadProjection(envelope)));
}

export function withPayloadDigest<T extends Record<string, unknown>>(envelope: T): T & { payloadDigest: string } {
  const withoutDigest = { ...envelope };
  delete withoutDigest.payloadDigest;
  return { ...withoutDigest, payloadDigest: computePayloadDigest(withoutDigest) } as T & { payloadDigest: string };
}

export function verifyPayloadDigest(envelope: unknown): string {
  const record = asRecord(envelope, 'digest envelope');
  const declared = record.payloadDigest;
  if (typeof declared !== 'string' || !DIGEST_PATTERN.test(declared)) {
    throw new Error('payloadDigest must be a lowercase sha256 digest.');
  }
  const computed = computePayloadDigest(record);
  if (declared !== computed) throw new Error(`payloadDigest mismatch: declared ${declared}, computed ${computed}.`);
  return computed;
}

export function computeTransportDigest(bytes: string | Uint8Array): string {
  return hashBytes(bytes);
}

export function serializeEnvelope(envelope: unknown): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function assertSafeExportEnvelope(value: unknown): asserts value is SafeExportEnvelope {
  const envelope = asRecord(value, 'safe export');
  exactKeys(envelope, ['kind', 'schemaVersion', 'generatedAt', 'workspaceId', 'workspaceRevision', 'inputDigests', 'producer', 'compatibility', 'redaction', 'redacted', 'cwd', 'payload', 'payloadDigest'], [], 'safe export');
  equals(envelope.kind, 'skillmap.safe-export', 'safe export kind');
  equals(envelope.schemaVersion, 2, 'safe export schemaVersion');
  timestamp(envelope.generatedAt, 'safe export generatedAt');
  nonEmptyString(envelope.workspaceId, 'safe export workspaceId');
  if (!UUID_PATTERN.test(envelope.workspaceId as string)) throw new Error('safe export workspaceId must be an opaque UUID.');
  digest(envelope.workspaceRevision, 'safe export workspaceRevision');
  equals(envelope.redacted, true, 'safe export redacted');
  equals(envelope.cwd, '$PROJECT', 'safe export cwd');
  digest(envelope.payloadDigest, 'safe export payloadDigest');

  const inputDigests = asRecord(envelope.inputDigests, 'safe export inputDigests');
  exactKeys(inputDigests, [], SAFE_INPUT_DIGEST_KEYS, 'safe export inputDigests');
  if (Object.keys(inputDigests).length === 0) throw new Error('safe export inputDigests must contain at least one artifact digest.');
  for (const [key, item] of Object.entries(inputDigests)) digest(item, `safe export inputDigests.${key}`);

  const producer = asRecord(envelope.producer, 'safe export producer');
  exactKeys(producer, ['name', 'version'], [], 'safe export producer');
  equals(producer.name, 'skillmap', 'safe export producer.name');
  nonEmptyString(producer.version, 'safe export producer.version');

  const compatibility = asRecord(envelope.compatibility, 'safe export compatibility');
  exactKeys(compatibility, ['minReaderSchemaVersion', 'maxReaderSchemaVersion'], [], 'safe export compatibility');
  equals(compatibility.minReaderSchemaVersion, 2, 'safe export compatibility.minReaderSchemaVersion');
  equals(compatibility.maxReaderSchemaVersion, 2, 'safe export compatibility.maxReaderSchemaVersion');

  const redaction = asRecord(envelope.redaction, 'safe export redaction');
  exactKeys(redaction, ['classification', 'rawPrompts', 'rawSkillBodies', 'absolutePaths', 'secrets', 'sensitiveReceipts'], [], 'safe export redaction');
  equals(redaction.classification, 'shareable-redacted', 'safe export redaction.classification');
  for (const key of ['rawPrompts', 'rawSkillBodies', 'absolutePaths', 'secrets', 'sensitiveReceipts']) equals(redaction[key], false, `safe export redaction.${key}`);

  assertSafePayload(envelope.payload);
  assertShareablePayloadPrivacy(envelope);
}

export function assertPrivateExportEnvelope(value: unknown): asserts value is PrivateExportEnvelope {
  const envelope = asRecord(value, 'local private export');
  exactKeys(envelope, ['kind', 'schemaVersion', 'generatedAt', 'workspacePath', 'redaction', 'artifacts', 'payloadDigest'], [], 'local private export');
  equals(envelope.kind, 'skillmap.local-private-export', 'local private export kind');
  equals(envelope.schemaVersion, 2, 'local private export schemaVersion');
  timestamp(envelope.generatedAt, 'local private export generatedAt');
  nonEmptyString(envelope.workspacePath, 'local private export workspacePath');
  digest(envelope.payloadDigest, 'local private export payloadDigest');
  const redaction = asRecord(envelope.redaction, 'local private export redaction');
  exactKeys(redaction, ['classification', 'shareable'], [], 'local private export redaction');
  equals(redaction.classification, 'local-sensitive', 'local private export redaction.classification');
  equals(redaction.shareable, false, 'local private export redaction.shareable');
  const artifacts = asRecord(envelope.artifacts, 'local private export artifacts');
  exactKeys(artifacts, [], PRIVATE_ARTIFACT_KEYS, 'local private export artifacts');
  for (const [name, rawArtifact] of Object.entries(artifacts)) {
    const artifact = asRecord(rawArtifact, `local private export artifact ${name}`);
    exactKeys(artifact, ['path', 'present'], ['value'], `local private export artifact ${name}`);
    nonEmptyString(artifact.path, `local private export artifact ${name}.path`);
    booleanValue(artifact.present, `local private export artifact ${name}.present`);
    if (artifact.present && !Object.hasOwn(artifact, 'value')) throw new Error(`local private export artifact ${name} is present but has no value.`);
  }
}

export function assertShareablePayloadPrivacy(value: unknown): void {
  inspectShareValue(value, '$');
}

function assertSafePayload(raw: unknown): void {
  const payload = asRecord(raw, 'safe export payload');
  exactKeys(payload, SAFE_PAYLOAD_KEYS, [], 'safe export payload');

  const status = asRecord(payload.status, 'safe export payload.status');
  exactKeys(status, ['verdict', 'readinessPhase', 'blockerCodes'], [], 'safe export payload.status');
  oneOf(status.verdict, ['ok', 'attention required', 'blocked'], 'safe export payload.status.verdict');
  nonEmptyString(status.readinessPhase, 'safe export payload.status.readinessPhase');
  stringArray(status.blockerCodes, 'safe export payload.status.blockerCodes');

  const inventory = asRecord(payload.inventorySummary, 'safe export payload.inventorySummary');
  exactKeys(inventory, ['skillCount', 'rootCount', 'duplicateGroupCount', 'scriptBearingCount'], [], 'safe export payload.inventorySummary');
  for (const key of ['skillCount', 'rootCount', 'duplicateGroupCount', 'scriptBearingCount']) nonNegativeNumber(inventory[key], `safe export payload.inventorySummary.${key}`);

  if (!Array.isArray(payload.skills)) throw new Error('safe export payload.skills must be an array.');
  for (const [index, rawSkill] of payload.skills.entries()) {
    const skill = asRecord(rawSkill, `safe export payload.skills[${index}]`);
    exactKeys(skill, ['skillId', 'displayName', 'contentRevision', 'tier', 'routeEligible', 'hasScripts', 'sourceState', 'reviewStatus'], [], `safe export payload.skills[${index}]`);
    nonEmptyString(skill.skillId, `safe export payload.skills[${index}].skillId`);
    if (!SKILL_ID_PATTERN.test(skill.skillId as string)) throw new Error(`safe export payload.skills[${index}].skillId must be a qualified skillId.`);
    nonEmptyString(skill.displayName, `safe export payload.skills[${index}].displayName`);
    digest(skill.contentRevision, `safe export payload.skills[${index}].contentRevision`);
    oneOf(skill.tier, TIERS, `safe export payload.skills[${index}].tier`);
    booleanValue(skill.routeEligible, `safe export payload.skills[${index}].routeEligible`);
    booleanValue(skill.hasScripts, `safe export payload.skills[${index}].hasScripts`);
    oneOf(skill.sourceState, SOURCE_STATES, `safe export payload.skills[${index}].sourceState`);
    oneOf(skill.reviewStatus, REVIEW_STATES, `safe export payload.skills[${index}].reviewStatus`);
  }

  const policy = asRecord(payload.policySummary, 'safe export payload.policySummary');
  exactKeys(policy, ['version', 'policyDigest', 'tierCounts', 'canonicalDecisionCount', 'duplicateDecisionCount'], [], 'safe export payload.policySummary');
  nonNegativeNumber(policy.version, 'safe export payload.policySummary.version');
  nullableDigest(policy.policyDigest, 'safe export payload.policySummary.policyDigest');
  const tierCounts = asRecord(policy.tierCounts, 'safe export payload.policySummary.tierCounts');
  exactKeys(tierCounts, [], TIERS, 'safe export payload.policySummary.tierCounts');
  for (const [tier, count] of Object.entries(tierCounts)) nonNegativeNumber(count, `safe export payload.policySummary.tierCounts.${tier}`);
  nonNegativeNumber(policy.canonicalDecisionCount, 'safe export payload.policySummary.canonicalDecisionCount');
  nonNegativeNumber(policy.duplicateDecisionCount, 'safe export payload.policySummary.duplicateDecisionCount');

  assertEvalSummary(payload.evalSummary);
  assertSourceSummary(payload.sourceSummary);
  assertCurationSummary(payload.curationSummary);
}

function assertEvalSummary(raw: unknown): void {
  const evalSummary = asRecord(raw, 'safe export payload.evalSummary');
  exactKeys(evalSummary, ['present', 'evidenceLevel', 'releaseEvidenceEligible', 'count', 'top1Rate', 'top3Rate', 'avoidHits', 'effectiveRevisionDigest', 'composition', 'holdout', 'leakage', 'baselinePass'], [], 'safe export payload.evalSummary');
  booleanValue(evalSummary.present, 'safe export payload.evalSummary.present');
  if (evalSummary.evidenceLevel !== null) oneOf(evalSummary.evidenceLevel, ['demo', 'smoke', 'candidate', 'release'], 'safe export payload.evalSummary.evidenceLevel');
  booleanValue(evalSummary.releaseEvidenceEligible, 'safe export payload.evalSummary.releaseEvidenceEligible');
  for (const key of ['count', 'avoidHits']) nonNegativeNumber(evalSummary[key], `safe export payload.evalSummary.${key}`);
  nullableNumber(evalSummary.top1Rate, 'safe export payload.evalSummary.top1Rate');
  nullableNumber(evalSummary.top3Rate, 'safe export payload.evalSummary.top3Rate');
  nullableDigest(evalSummary.effectiveRevisionDigest, 'safe export payload.evalSummary.effectiveRevisionDigest');
  booleanValue(evalSummary.baselinePass, 'safe export payload.evalSummary.baselinePass');
  const composition = asRecord(evalSummary.composition, 'safe export payload.evalSummary.composition');
  const compositionKeys = ['total', 'explicit', 'implicitNatural', 'multiSkill', 'negativeNearMiss', 'untyped', 'releaseCounted', 'releaseScored'];
  exactKeys(composition, compositionKeys, [], 'safe export payload.evalSummary.composition');
  for (const key of compositionKeys) nonNegativeNumber(composition[key], `safe export payload.evalSummary.composition.${key}`);
  const holdout = asRecord(evalSummary.holdout, 'safe export payload.evalSummary.holdout');
  exactKeys(holdout, ['count', 'requiredCount', 'ratio', 'pass'], [], 'safe export payload.evalSummary.holdout');
  nonNegativeNumber(holdout.count, 'safe export payload.evalSummary.holdout.count');
  nonNegativeNumber(holdout.requiredCount, 'safe export payload.evalSummary.holdout.requiredCount');
  nonNegativeNumber(holdout.ratio, 'safe export payload.evalSummary.holdout.ratio');
  booleanValue(holdout.pass, 'safe export payload.evalSummary.holdout.pass');
  const leakage = asRecord(evalSummary.leakage, 'safe export payload.evalSummary.leakage');
  exactKeys(leakage, ['count', 'pass'], [], 'safe export payload.evalSummary.leakage');
  nonNegativeNumber(leakage.count, 'safe export payload.evalSummary.leakage.count');
  booleanValue(leakage.pass, 'safe export payload.evalSummary.leakage.pass');
}

function assertSourceSummary(raw: unknown): void {
  const source = asRecord(raw, 'safe export payload.sourceSummary');
  const keys = ['present', 'coverage', 'inventorySkills', 'trackedSkills', 'external', 'localAuthored', 'unknown', 'modified', 'stale', 'riskyUpdates', 'errors', 'unreviewedNonClean'];
  exactKeys(source, keys, [], 'safe export payload.sourceSummary');
  booleanValue(source.present, 'safe export payload.sourceSummary.present');
  if (source.coverage !== null) oneOf(source.coverage, COVERAGE_STATES, 'safe export payload.sourceSummary.coverage');
  for (const key of keys.slice(2)) nonNegativeNumber(source[key], `safe export payload.sourceSummary.${key}`);
}

function assertCurationSummary(raw: unknown): void {
  const curation = asRecord(raw, 'safe export payload.curationSummary');
  exactKeys(curation, ['present', 'stale', 'modelVerification'], [], 'safe export payload.curationSummary');
  booleanValue(curation.present, 'safe export payload.curationSummary.present');
  booleanValue(curation.stale, 'safe export payload.curationSummary.stale');
  if (curation.modelVerification !== null) oneOf(curation.modelVerification, MODEL_VERIFICATION_STATES, 'safe export payload.curationSummary.modelVerification');
}

function canonicalValue(value: unknown, seen: Set<object>): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Canonical JSON does not support cyclic values.');
    seen.add(value);
    const result = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value !== 'object' || value === undefined) throw new Error(`Canonical JSON does not support ${typeof value} values.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Canonical JSON supports plain objects only.');
  if (seen.has(value)) throw new Error('Canonical JSON does not support cyclic values.');
  seen.add(value);
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    result[key] = canonicalValue((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
  return result;
}

function inspectShareValue(value: unknown, location: string): void {
  if (typeof value === 'string') {
    if (isAbsolutePathLike(value)) throw new Error(`Safe export contains an absolute path at ${location}.`);
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Safe export contains a secret or privacy canary at ${location}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectShareValue(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SHARE_KEYS.has(key.toLowerCase())) throw new Error(`Safe export contains forbidden sensitive field ${key} at ${location}.`);
    inspectShareValue(child, `${location}.${key}`);
  }
}

function isAbsolutePathLike(value: string): boolean {
  if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)) return true;
  if (/\bfile:\/\//i.test(value)) return true;
  return /(?:^|[\s"'(=:])(?:\/(?!\/)[^\s"'<>),;]+|[A-Za-z]:[\\/][^\s"'<>),;]+|\\\\[^\s"'<>),;]+)/.test(value);
}

function hashBytes(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}.`);
  for (const key of required) if (!Object.hasOwn(record, key)) throw new Error(`${label} is missing required field ${key}.`);
}

function equals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} must be ${JSON.stringify(expected)}.`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function nullableString(value: unknown, label: string): void {
  if (value !== null) nonEmptyString(value, label);
}

function timestamp(value: unknown, label: string): void {
  nonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a lowercase sha256 digest.`);
}

function nullableDigest(value: unknown, label: string): void {
  if (value !== null) digest(value, label);
}

function nonNegativeNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
}

function nullableNumber(value: unknown, label: string): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${label} must be a finite number or null.`);
}

function booleanValue(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
}

function stringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${label} must be an array of strings.`);
}

function oneOf(value: unknown, choices: string[], label: string): void {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`${label} has an unsupported value.`);
}
