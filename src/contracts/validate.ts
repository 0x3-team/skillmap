import { createHash } from 'node:crypto';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import {
  compareEvalBaseline,
  evalEvidenceLevel,
  evalHoldoutResult,
  evalReleaseEvidenceEligible,
  evalThresholdPass
} from './eval-semantics.js';
import { effectiveRegistryUsesFixtureState } from './fixture-path.js';
import { rankRoutePrompt, validateRoutePrompt, type RouteRankingSkill } from './route-ranking.js';
import { CONTRACT_SCHEMAS, type ContractSchemaId } from './generated/schema-bundle.js';
import { CONTRACT_STANDALONE_VALIDATORS } from './generated/standalone-validators.js';
import type { ContractBySchemaId, EvalRunV3, KnownContractSchemaId, RevisionRef, Sha256Digest } from './generated/types.js';

export interface ContractIssue {
  path: string;
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface ContractValidationResult {
  ok: boolean;
  issues: ContractIssue[];
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const REVISION_ID_PATTERN = /^r[0-9]{20}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const SKILL_ID_PATTERN = /^sk_[A-Za-z0-9_-]{43}$/;
const MAX_EFFECTIVE_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const EVAL_RELEASE_CASE_LIMIT = 10_000;
export const EVAL_RELEASE_SKILL_LIMIT = 10_000;
// Byte-weighted replay budget: large enough for two reviewed ~100 KiB,
// 150-skill registries across the 150-case release floor, while still
// rejecting adversarial megabyte-scale aliases and oversized prompt corpora.
// Calibrated to admit a reviewed 150-case, 150-skill current+baseline replay
// while rejecting both large-text and high-count phrase amplification.
export const EVAL_RELEASE_ROUTE_WORK_LIMIT = 72_000_000;
const EVAL_SUITE_V3_SCHEMA_ID = 'https://skillmap.dev/contracts/eval-suite/v3.schema.json';
const EVAL_RUN_V3_SCHEMA_ID = 'https://skillmap.dev/contracts/eval-run/v3.schema.json';
const HOSTED_GRADE_SUMMARY_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-grade-summary/v1.schema.json';
const HOSTED_AUDIT_SUMMARY_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-audit-summary/v1.schema.json';
const HOSTED_AUDIT_RECEIPT_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-audit-receipt/v1.schema.json';
const HOSTED_GRADE_RECEIPT_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-grade-receipt/v1.schema.json';
const HOSTED_SKILL_LIST_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-skill-list/v1.schema.json';
const HOSTED_API_RESPONSE_V1_SCHEMA_ID = 'https://skillmap.dev/contracts/hosted-api-response/v1.schema.json';
const PAYLOAD_EXCLUDED_KEYS = new Set(['payloadDigest', 'transportDigest', 'transportMetadata']);
const FORBIDDEN_REDACTED_KEYS = new Set([
  'prompt',
  'rawprompt',
  'prompttext',
  'promptpreview',
  'rawskillbody',
  'skillbody',
  'skillbodytext',
  'body',
  'path',
  'configuredpath',
  'realpath',
  'localpath',
  'workspacepath',
  'root',
  'roots',
  'scriptpath',
  'scriptpaths',
  'secret',
  'hooktoken'
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

const cloudflareStaticValidation = process.env.SKILLMAP_CONTRACT_VALIDATION_MODE === 'cloudflare-static'
  || process.env.NEXT_PUBLIC_SKILLMAP_CONTRACT_VALIDATION_MODE === 'cloudflare-static';
const ajv = cloudflareStaticValidation
  ? null
  : new Ajv2020({
      allErrors: true,
      strictSchema: true,
      strictRequired: true,
      strictTypes: false,
      strictTuples: false,
      validateFormats: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false
    });

if (ajv) {
  ajv.addFormat('date-time', {
    type: 'string',
    validate: isRealUtcTimestamp
  });

  // Ajv normalizes some numeric subschemas in place while compiling them. Keep
  // the exported generated bundle immutable so callers and convergence tests see
  // the exact checked-in JSON Schema bytes rather than Ajv's internal form.
  for (const schema of CONTRACT_SCHEMAS) {
    ajv.addSchema(JSON.parse(JSON.stringify(schema)) as object);
  }
}

const validators = new Map<string, ValidateFunction>();

export function contractSchemaIds(): readonly ContractSchemaId[] {
  return CONTRACT_SCHEMAS.map((schema) => schema.$id) as ContractSchemaId[];
}

export function validateContract(schemaId: string, value: unknown): ContractValidationResult {
  return validateContractInternal(schemaId, value);
}

export interface EvalRunV3ReleaseContext {
  /** Local-sensitive suite whose reviewed, frozen cases own the run labels. */
  companionSuite: unknown;
  /** RevisionRef read from the trusted current/LKG state-store pointer. */
  approvedRevision: unknown;
  /** Exact UTF-8 bytes of that revision's immutable effective.json artifact. */
  effectiveArtifact: unknown;
  /** Exact historical effective.json bytes for an approved baseline, else null. */
  baselineEffectiveArtifact: unknown;
  /** RevisionRef independently resolved from immutable state history, else null. */
  approvedBaselineRevision: unknown;
}

/**
 * Authoritatively validates eval-run/v3 release evidence against its reviewed
 * suite and the exact approved effective registry. Standalone contract
 * validation remains candidate-only and cannot grant release eligibility.
 */
export function validateEvalRunV3WithContext(value: unknown, context: EvalRunV3ReleaseContext): ContractValidationResult {
  const contextRecord = isRecord(context) ? context : null;
  const companionSuite = contextRecord?.companionSuite;
  const suiteResult = validateContract(EVAL_SUITE_V3_SCHEMA_ID, companionSuite);
  const contextIssues: ContractIssue[] = [];
  const effective = prepareEvalRunV3EffectiveContext(contextRecord, contextIssues);
  const runResult = validateContractInternal(EVAL_RUN_V3_SCHEMA_ID, value, {
    evalSuiteV3: {
      value: isRecord(companionSuite) ? companionSuite : null,
      valid: suiteResult.ok
    },
    evalEffective: effective
  });
  const suiteIssues = suiteResult.issues.map((entry) => ({
    ...entry,
    path: entry.path === '/' ? '/context/companionSuite' : `/context/companionSuite${entry.path}`,
    keyword: `companionSuite.${entry.keyword}`,
    message: `companion suite ${entry.message}`
  }));
  const issues = [...contextIssues, ...suiteIssues, ...runResult.issues];
  return { ok: issues.length === 0, issues };
}

export function assertEvalRunV3WithContext(value: unknown, context: EvalRunV3ReleaseContext): asserts value is EvalRunV3 {
  const result = validateEvalRunV3WithContext(value, context);
  if (!result.ok) {
    const summary = result.issues.slice(0, 20).map((entry) => `${entry.path || '/'} ${entry.message}`).join('; ');
    throw new Error(`Contextual eval-run/v3 validation failed: ${summary}`);
  }
}

interface SemanticValidationContext {
  evalSuiteV3?: {
    value: Record<string, unknown> | null;
    valid: boolean;
  };
  evalEffective?: PreparedEvalEffectiveContext;
}

interface PreparedEvalEffectiveContext {
  valid: boolean;
  approvedRevision: Record<string, unknown> | null;
  registry: Record<string, unknown> | null;
  skills: RouteRankingSkill[];
  fixture: boolean;
  routeWorkUnits: number;
  baselineEffectiveArtifact: string | null;
  approvedBaselineRevision: Record<string, unknown> | null;
}

function prepareEvalRunV3EffectiveContext(
  context: Record<string, unknown> | null,
  issues: ContractIssue[]
): PreparedEvalEffectiveContext {
  const issueCount = issues.length;
  const invalid = (approvedRevision: Record<string, unknown> | null = null, registry: Record<string, unknown> | null = null, skills: RouteRankingSkill[] = []): PreparedEvalEffectiveContext => ({
    valid: false,
    approvedRevision,
    registry,
    skills,
    fixture: false,
    routeWorkUnits: 0,
    baselineEffectiveArtifact: null,
    approvedBaselineRevision: null
  });
  if (!context) {
    issue(issues, '/context', 'releaseContext', 'must be a plain context object');
    return invalid();
  }
  exactObjectKeys(context, ['companionSuite', 'approvedRevision', 'effectiveArtifact', 'baselineEffectiveArtifact', 'approvedBaselineRevision'], '/context', issues);
  const baselineEffectiveArtifact = context.baselineEffectiveArtifact;
  if (baselineEffectiveArtifact !== null && typeof baselineEffectiveArtifact !== 'string') {
    issue(issues, '/context/baselineEffectiveArtifact', 'baselineEffectiveArtifact', 'must be exact historical effective.json text or null');
  }
  const approvedBaselineRevision = context.approvedBaselineRevision === null
    ? null
    : recordValue(context.approvedBaselineRevision) ?? null;
  if (context.approvedBaselineRevision !== null && !approvedBaselineRevision) {
    issue(issues, '/context/approvedBaselineRevision', 'approvedBaselineRevision', 'must be a trusted historical RevisionRef or null');
  } else if (approvedBaselineRevision) {
    validateApprovedEvalRevision(approvedBaselineRevision, issues, '/context/approvedBaselineRevision');
  }
  const approvedRevision = recordValue(context.approvedRevision) ?? null;
  if (!approvedRevision) {
    issue(issues, '/context/approvedRevision', 'approvedRevision', 'must be the trusted state-store RevisionRef');
  } else {
    validateApprovedEvalRevision(approvedRevision, issues, '/context/approvedRevision');
  }

  const artifact = context.effectiveArtifact;
  if (typeof artifact !== 'string') {
    issue(issues, '/context/effectiveArtifact', 'effectiveArtifact', 'must be the exact UTF-8 effective.json artifact text');
    return invalid(approvedRevision);
  }
  const artifactBytes = utf8ByteLength(artifact);
  if (artifactBytes < 2 || artifactBytes > MAX_EFFECTIVE_ARTIFACT_BYTES) {
    issue(issues, '/context/effectiveArtifact', 'effectiveArtifact', `must be between 2 and ${MAX_EFFECTIVE_ARTIFACT_BYTES} UTF-8 bytes`);
    return invalid(approvedRevision);
  }

  let registry: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(artifact) as unknown;
    registry = isRecord(parsed) ? parsed : null;
  } catch {
    issue(issues, '/context/effectiveArtifact', 'effectiveArtifact', 'must contain one valid JSON object');
  }
  if (!registry) {
    if (!issues.some((entry) => entry.path === '/context/effectiveArtifact')) {
      issue(issues, '/context/effectiveArtifact', 'effectiveArtifact', 'must contain one plain JSON object');
    }
    return invalid(approvedRevision);
  }

  const skills = validateEvalEffectiveRegistry(registry, approvedRevision, issues);
  const fixture = effectiveRegistryUsesFixtureState(registry);
  // Count bytes that ranking repeatedly scans, not merely collection entries.
  // A single schema-valid alias may be 4 KiB, so treating it as one unit would
  // let a small case set trigger disproportionate replay work.
  const routeWorkUnits = computeEvalRouteRegistryWorkUnits(skills);
  if (approvedRevision && typeof approvedRevision.effectiveDigest === 'string') {
    const artifactDigest = sha256(artifact);
    if (approvedRevision.effectiveDigest !== artifactDigest) {
      issue(issues, '/context/effectiveArtifact', 'effectiveDigest', `bytes must match approvedRevision.effectiveDigest; computed ${artifactDigest}`);
    }
  }
  if (approvedRevision && typeof approvedRevision.effectiveRevisionDigest === 'string') {
    try {
      const semanticDigest = computeEvalEffectiveRevisionDigest(registry);
      if (approvedRevision.effectiveRevisionDigest !== semanticDigest) {
        issue(issues, '/context/effectiveArtifact', 'effectiveRevisionDigest', `routing semantics must match approvedRevision.effectiveRevisionDigest; computed ${semanticDigest}`);
      }
    } catch {
      issue(issues, '/context/effectiveArtifact', 'effectiveRevisionDigest', 'routing semantics could not be recomputed');
    }
  }
  return {
    valid: issues.length === issueCount,
    approvedRevision,
    registry,
    skills,
    fixture,
    routeWorkUnits,
    baselineEffectiveArtifact: typeof baselineEffectiveArtifact === 'string' ? baselineEffectiveArtifact : null,
    approvedBaselineRevision
  };
}

function validateApprovedEvalRevision(value: Record<string, unknown>, issues: ContractIssue[], basePath: string): void {
  exactObjectKeys(value, ['workspaceId', 'revisionId', 'workspaceRevision', 'effectiveDigest', 'effectiveRevisionDigest'], basePath, issues);
  if (typeof value.workspaceId !== 'string' || !UUID_PATTERN.test(value.workspaceId)) {
    issue(issues, `${basePath}/workspaceId`, 'approvedRevision', 'must be a valid workspace UUID');
  }
  if (typeof value.revisionId !== 'string' || !REVISION_ID_PATTERN.test(value.revisionId)) {
    issue(issues, `${basePath}/revisionId`, 'approvedRevision', 'must be a valid workspace revision ID');
  }
  for (const key of ['workspaceRevision', 'effectiveDigest', 'effectiveRevisionDigest'] as const) {
    if (typeof value[key] !== 'string' || !DIGEST_PATTERN.test(value[key])) {
      issue(issues, `${basePath}/${key}`, 'approvedRevision', 'must be a non-null sha256 digest');
    }
  }
}

function revisionSequence(value: Record<string, unknown>): string | null {
  const match = typeof value.revisionId === 'string' ? /^r([0-9]{20})-/.exec(value.revisionId) : null;
  return match?.[1] ?? null;
}

function validateEvalEffectiveRegistry(
  registry: Record<string, unknown>,
  approvedRevision: Record<string, unknown> | null,
  issues: ContractIssue[]
): RouteRankingSkill[] {
  const inventory = recordValue(registry.inventory);
  const policy = recordValue(registry.policy);
  const graph = recordValue(registry.graph);
  if (registry.version !== 1 && registry.version !== 2) issue(issues, '/context/effectiveArtifact/version', 'effectiveRegistry', 'version must be 1 or 2');
  if (!inventory) issue(issues, '/context/effectiveArtifact/inventory', 'effectiveRegistry', 'qualified inventory is required');
  if (!policy) issue(issues, '/context/effectiveArtifact/policy', 'effectiveRegistry', 'reviewed policy is required');
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || (graph.version !== 1) || graph.mode !== 'effective') {
    issue(issues, '/context/effectiveArtifact/graph', 'effectiveRegistry', 'effective graph v1 with bounded nodes and edges is required');
  }
  if (inventory) {
    if (inventory.version !== 2 || inventory.identityVersion !== 1) {
      issue(issues, '/context/effectiveArtifact/inventory', 'qualifiedInventory', 'inventory must be qualified v2 identity v1');
    }
    if (!Array.isArray(inventory.identityIssues) || inventory.identityIssues.length !== 0) {
      issue(issues, '/context/effectiveArtifact/inventory/identityIssues', 'qualifiedInventory', 'inventory must have zero identity issues');
    }
    if (!Array.isArray(inventory.roots) || inventory.roots.length > 10_000 || !inventory.roots.every((entry) => typeof entry === 'string')) {
      issue(issues, '/context/effectiveArtifact/inventory/roots', 'qualifiedInventory', 'inventory roots must be a bounded string list');
    }
    if (approvedRevision && inventory.workspaceId !== approvedRevision.workspaceId) {
      issue(issues, '/context/effectiveArtifact/inventory/workspaceId', 'approvedRevision', 'must match approvedRevision.workspaceId');
    }
  }

  const inventorySkills = inventory && Array.isArray(inventory.skills) ? arrayRecords(inventory.skills) : [];
  if (!inventory || !Array.isArray(inventory.skills) || inventorySkills.length !== inventory.skills.length || inventorySkills.length > 100_000) {
    issue(issues, '/context/effectiveArtifact/inventory/skills', 'qualifiedInventory', 'must contain at most 100000 object-shaped skills');
  }
  const inventoryById = new Map<string, Record<string, unknown>>();
  for (const [index, skill] of inventorySkills.entries()) {
    const skillId = skill.skillId;
    if (typeof skillId !== 'string' || !SKILL_ID_PATTERN.test(skillId)) {
      issue(issues, `/context/effectiveArtifact/inventory/skills/${index}/skillId`, 'qualifiedInventory', 'must be a qualified skill ID');
      continue;
    }
    if (inventoryById.has(skillId)) issue(issues, '/context/effectiveArtifact/inventory/skills', 'qualifiedInventory', `duplicate skillId ${skillId}`);
    inventoryById.set(skillId, skill);
    if (typeof skill.name !== 'string' || skill.name.trim().length === 0 || typeof skill.contentRevision !== 'string' || !DIGEST_PATTERN.test(skill.contentRevision)) {
      issue(issues, `/context/effectiveArtifact/inventory/skills/${index}`, 'qualifiedInventory', 'must bind a non-empty name and contentRevision');
    }
  }

  const rawSkills = Array.isArray(registry.skills) ? arrayRecords(registry.skills) : [];
  if (!Array.isArray(registry.skills) || rawSkills.length !== registry.skills.length || rawSkills.length > 100_000) {
    issue(issues, '/context/effectiveArtifact/skills', 'effectiveRegistry', 'must contain at most 100000 object-shaped effective skills');
  }
  const effectiveIds = new Set<string>();
  const skills: RouteRankingSkill[] = [];
  const tiers = new Set(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
  const variants = new Set(['unique', 'canonical', 'shadowed-duplicate', 'unresolved-duplicate']);
  for (const [index, raw] of rawSkills.entries()) {
    const path = `/context/effectiveArtifact/skills/${index}`;
    const skillId = raw.skillId;
    const inventorySkill = typeof skillId === 'string' ? inventoryById.get(skillId) : undefined;
    if (typeof skillId !== 'string' || !SKILL_ID_PATTERN.test(skillId) || effectiveIds.has(skillId)) {
      issue(issues, `${path}/skillId`, 'effectiveRegistry', 'must be a unique qualified skill ID');
      continue;
    }
    effectiveIds.add(skillId);
    if (!inventorySkill || inventorySkill.name !== raw.name || inventorySkill.contentRevision !== raw.contentRevision) {
      issue(issues, path, 'effectiveRegistry', 'must match the qualified inventory name and contentRevision');
    }
    const lists = ['aliases', 'preferredFor', 'avoidFor', 'supersedes'] as const;
    let listsValid = true;
    for (const key of lists) {
      const list = raw[key];
      if (!Array.isArray(list) || list.length > 1000 || !list.every((entry) => typeof entry === 'string' && entry.length <= 4000)) {
        issue(issues, `${path}/${key}`, 'effectiveRegistry', 'must be a bounded string list');
        listsValid = false;
      }
    }
    const scalarValid = typeof raw.name === 'string' && raw.name.trim().length > 0 && raw.name.length <= 200
      && typeof raw.description === 'string' && raw.description.trim().length > 0 && raw.description.length <= 32768
      && typeof raw.path === 'string' && raw.path.length > 0
      && tiers.has(String(raw.tier))
      && variants.has(String(raw.variantState))
      && typeof raw.routeEligible === 'boolean'
      && typeof raw.qualifiedExplicitAllowed === 'boolean'
      && typeof raw.hasScripts === 'boolean'
      && (raw.family === undefined || typeof raw.family === 'string');
    if (!scalarValid) issue(issues, path, 'effectiveRegistry', 'contains invalid routing fields');
    if (!scalarValid || !listsValid) continue;
    skills.push(raw as unknown as RouteRankingSkill);
  }
  if (effectiveIds.size !== inventoryById.size) {
    issue(issues, '/context/effectiveArtifact/skills', 'effectiveRegistry', 'must cover the exact qualified inventory skill set');
  }
  return skills;
}

function computeEvalEffectiveRevisionDigest(registry: Record<string, unknown>): Sha256Digest {
  const inventory = asRecord(registry.inventory, 'effective inventory');
  const graph = asRecord(registry.graph, 'effective graph');
  return sha256(canonicalJson({
    version: registry.version,
    inventoryWorkspaceId: inventory.workspaceId,
    policy: registry.policy,
    skills: registry.skills,
    graph: { version: graph.version, mode: graph.mode, nodes: graph.nodes, edges: graph.edges }
  }));
}

function validateContractInternal(schemaId: string, value: unknown, context?: SemanticValidationContext): ContractValidationResult {
  const validator = getValidator(schemaId);
  const valid = validator(value);
  const issues = valid ? [] : formatAjvIssues(validator.errors);
  if (valid) {
    try {
      canonicalJson(value);
    } catch {
      issue(issues, '/', 'jsonDataModel', 'contract value must be a finite, acyclic plain JSON value');
    }
  }
  // Semantic checks are safe on object-shaped partial values and provide
  // machine-specific diagnostics even when a conditional schema also fails.
  if (isRecord(value)) {
    try {
      issues.push(...semanticIssues(schemaId, value, context));
    } catch {
      issue(issues, '/', 'semanticValidation', 'semantic validation could not be completed');
    }
  }
  return { ok: issues.length === 0, issues };
}

export function assertContract<K extends KnownContractSchemaId>(
  schemaId: K,
  value: unknown
): asserts value is ContractBySchemaId[K];
export function assertContract(schemaId: string, value: unknown): void;
export function assertContract(schemaId: string, value: unknown): void {
  const result = validateContract(schemaId, value);
  if (!result.ok) {
    const summary = result.issues.slice(0, 20).map((issue) => `${issue.path || '/'} ${issue.message}`).join('; ');
    throw new Error(`Contract validation failed for ${schemaId}: ${summary}`);
  }
}

export function parseContract<K extends KnownContractSchemaId>(schemaId: K, value: unknown): ContractBySchemaId[K] {
  assertContract(schemaId, value);
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set<object>()));
}

export function canonicalPayloadJson(value: unknown): string {
  const record = asRecord(value, 'payload envelope');
  const projection = Object.create(null) as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (!PAYLOAD_EXCLUDED_KEYS.has(key)) projection[key] = nested;
  }
  return canonicalJson(projection);
}

export function computePayloadDigest(value: unknown): Sha256Digest {
  return sha256(canonicalPayloadJson(value));
}

export function computeRouteDecisionDigest(decision: unknown): Sha256Digest {
  return sha256(canonicalJson(decision));
}

export function computeEvalSuiteV3DatasetDigest(value: unknown): Sha256Digest {
  const suite = asRecord(value, 'eval suite v3');
  return sha256(canonicalJson({
    schemaVersion: suite.schemaVersion,
    suiteId: suite.suiteId,
    name: suite.name,
    provenance: suite.provenance,
    baseline: suite.baseline,
    cases: suite.cases
  }));
}

export function computeEvalSuiteV3CaseSetDigest(value: unknown): Sha256Digest {
  const suite = asRecord(value, 'eval suite v3');
  return sha256(canonicalJson({
    schemaVersion: suite.schemaVersion,
    cases: arrayRecords(suite.cases).map((item) => ({
      caseId: item.caseId,
      prompt: item.prompt,
      expectedSkillIds: item.expectedSkillIds,
      avoidSkillIds: item.avoidSkillIds,
      qualifiedSkillId: item.qualifiedSkillId ?? null,
      primaryCaseType: item.primaryCaseType,
      membership: item.membership
    }))
  }));
}

function getValidator(schemaId: string): ValidateFunction {
  const cached = validators.get(schemaId);
  if (cached) return cached;
  // Cloudflare Workers disallows Ajv's runtime code generation.
  if (cloudflareStaticValidation) {
    const validator = CONTRACT_STANDALONE_VALIDATORS[schemaId as keyof typeof CONTRACT_STANDALONE_VALIDATORS] as ValidateFunction | undefined;
    if (!validator) throw new Error(`Unknown SkillMap contract schema: ${schemaId}`);
    validators.set(schemaId, validator);
    return validator;
  }
  const validator = ajv?.getSchema(schemaId);
  if (!validator) throw new Error(`Unknown SkillMap contract schema: ${schemaId}`);
  validators.set(schemaId, validator);
  return validator;
}

function formatAjvIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed'
  }));
}

function semanticIssues(schemaId: string, value: unknown, context?: SemanticValidationContext): ContractIssue[] {
  if (!isRecord(value)) return [];
  const issues: ContractIssue[] = [];
  verifyPayloadDigestIfPresent(value, issues);

  if (schemaId.endsWith('/workspace-revision/v1.schema.json')) validateWorkspaceRevisionFamily(value, issues);
  if (schemaId.endsWith('/skill-identity/v1.schema.json')) validateSkillIdentityFamily(value, issues);
  if (schemaId.endsWith('/route-result/v2.schema.json')) validateRouteResult(value, issues);
  if (schemaId.endsWith('/dashboard/v3.schema.json')) validateDashboardV3(value, issues);
  if (schemaId.endsWith('/job/v1.schema.json')) validateJob(value, issues);
  if (schemaId.endsWith('/route-feedback/v1.schema.json')) validateFeedback(value, issues);
  if (schemaId.endsWith('/eval-suite/v2.schema.json')) validateEvalSuiteV2(value, issues);
  if (schemaId.endsWith('/eval-suite/v3.schema.json')) validateEvalSuiteV3(value, issues);
  if (schemaId.endsWith('/eval-run/v3.schema.json')) validateEvalRunV3(value, issues, context);
  if (schemaId.endsWith('/sync-envelope/v1.schema.json')) validateSync(value, issues);
  if (schemaId.endsWith('/api-envelope/v1.schema.json')) validateApiEnvelope(value, issues);
  if (schemaId === HOSTED_GRADE_SUMMARY_V1_SCHEMA_ID) validateHostedGradeSummary(value, issues);
  if (schemaId === HOSTED_AUDIT_SUMMARY_V1_SCHEMA_ID) validateHostedAuditSummary(value, issues);
  if (schemaId === HOSTED_AUDIT_RECEIPT_V1_SCHEMA_ID) verifyReceiptDigest(value, 'projectionDigest', issues);
  if (schemaId === HOSTED_GRADE_RECEIPT_V1_SCHEMA_ID) validateHostedGradeReceipt(value, issues);
  if (schemaId === HOSTED_SKILL_LIST_V1_SCHEMA_ID) validateHostedSkillList(value, issues);
  if (schemaId === HOSTED_API_RESPONSE_V1_SCHEMA_ID) validateHostedApiResponse(value, issues);

  if (schemaId.endsWith('/route-result/v2.schema.json')
    || (schemaId.endsWith('/event/v1.schema.json') && value.kind === 'skillmap.route-event')
    || schemaId.endsWith('/route-feedback/v1.schema.json')) {
    inspectRedactedValue(value, '$', issues);
  }

  if (value.redactionClassification === 'shareable-redacted' || value.redactionClassification === 'metadata-only') {
    inspectRedactedValue(value, '$', issues);
  }
  return issues;
}

function verifyPayloadDigestIfPresent(value: Record<string, unknown>, issues: ContractIssue[]): void {
  if (!Object.hasOwn(value, 'payloadDigest')) return;
  const declared = value.payloadDigest;
  if (typeof declared !== 'string' || !DIGEST_PATTERN.test(declared)) return;
  const computed = computePayloadDigest(value);
  if (declared !== computed) issue(issues, '/payloadDigest', 'payloadDigest', `must match canonical payload bytes; computed ${computed}`);
}

function validateWorkspaceRevisionFamily(value: Record<string, unknown>, issues: ContractIssue[]): void {
  if (value.kind === 'skillmap.workspace-revision') {
    sortedUniqueRecords(value.artifacts, 'path', '/artifacts', issues);
    validateRevisionSequence(value.revisionId, value.sequence, '/sequence', issues);
    if (value.sequence !== value.fencingToken) issue(issues, '/fencingToken', 'fencingToken', 'must equal manifest sequence');
    return;
  }
  if (value.kind === 'skillmap.workspace-current' || value.kind === 'skillmap.workspace-last-known-good') {
    validateRevisionSequence(value.revisionId, value.sequence, '/sequence', issues);
    if (value.sequence !== value.fencingToken) issue(issues, '/fencingToken', 'fencingToken', 'must equal pointer sequence');
    if (value.kind === 'skillmap.workspace-last-known-good') {
      const approval = recordValue(value.routingApproval);
      if (approval && approval.revisionId !== value.revisionId) issue(issues, '/routingApproval/revisionId', 'routingApproval', 'must match pointer revisionId');
      if (approval && approval.routingSafetyDigest !== value.routingSafetyDigest) issue(issues, '/routingApproval/routingSafetyDigest', 'routingApproval', 'must match pointer routingSafetyDigest');
      if (approval) verifyReceiptDigest(approval, 'receiptDigest', issues);
    }
  }
}

function validateSkillIdentityFamily(value: Record<string, unknown>, issues: ContractIssue[]): void {
  if (value.kind === 'skillmap.qualified-skill-identity') {
    if (typeof value.relativePath === 'string' && value.relativePath.normalize('NFC') !== value.relativePath) {
      issue(issues, '/relativePath', 'normalization', 'must be NFC-normalized');
    }
    sortedUniqueRecords(value.treeEntries, 'path', '/treeEntries', issues);
    if (!arrayRecords(value.treeEntries).some((entry) => entry.path === 'SKILL.md')) {
      issue(issues, '/treeEntries', 'requiredTreeEntry', 'must contain SKILL.md');
    }
  }
  if (value.kind === 'skillmap.identity-move-receipt' && value.fromSkillId === value.toSkillId) {
    issue(issues, '/toSkillId', 'identityMove', 'must differ from fromSkillId');
  }
  if (value.kind === 'skillmap.identity-move-receipt' || value.kind === 'skillmap.approved-new-identity-receipt') {
    verifyReceiptDigest(value, 'receiptDigest', issues);
  }
}

function validateRouteResult(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const decision = recordValue(value.decision);
  if (!decision) return;
  const revision = recordValue(decision.revision);
  if (typeof value.decisionDigest === 'string') {
    const computed = computeRouteDecisionDigest(decision);
    if (value.decisionDigest !== computed) issue(issues, '/decisionDigest', 'decisionDigest', `must match deterministic route decision; computed ${computed}`);
  }
  uniqueRecordField(decision.recommendations, 'skillId', '/decision/recommendations', issues);
  uniqueRecordField(decision.exclusions, 'skillId', '/decision/exclusions', issues, true);
  if (decision.warningState === 'blocked' && Array.isArray(decision.recommendations) && decision.recommendations.length > 0) {
    issue(issues, '/decision/recommendations', 'blockedDecision', 'must be empty when warningState is blocked');
  }
  if (revision && Array.isArray(decision.recommendations) && decision.recommendations.length > 0
    && (revision.effectiveDigest === null || revision.effectiveRevisionDigest === null)) {
    issue(issues, '/decision/revision', 'routingApproval', 'recommended routes require both effectiveDigest and effectiveRevisionDigest');
  }
}

function validateDashboardV3(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const revision = recordValue(value.revision);
  const status = recordValue(value.status);
  for (const [index, event] of arrayRecords(value.recentRouteEvents).entries()) {
    const eventRevision = recordValue(event.revision);
    if (eventRevision?.workspaceId !== value.workspaceId) issue(issues, `/recentRouteEvents/${index}/revision/workspaceId`, 'revisionParity', 'must match dashboard workspaceId');
    if (revision && canonicalJson(event.revision) !== canonicalJson(revision)) issue(issues, `/recentRouteEvents/${index}/revision`, 'revisionParity', 'must match dashboard revision');
  }
  uniqueRecordField(value.skills, 'skillId', '/skills', issues);
  if (revision && (value.mode === 'release-ready' || status?.verdict === 'ok')
    && (revision.effectiveDigest === null || revision.effectiveRevisionDigest === null)) {
    issue(issues, '/revision', 'routingApproval', 'ready dashboard state requires both effectiveDigest and effectiveRevisionDigest');
  }
}

function validateJob(value: Record<string, unknown>, issues: ContractIssue[]): void {
  timestampOrder(value.createdAt, value.startedAt, '/startedAt', issues);
  timestampOrder(value.startedAt ?? value.createdAt, value.completedAt, '/completedAt', issues);
  const receipt = recordValue(value.resultReceipt);
  if (receipt) {
    const forbidden = /prompt|body|path|secret|token|password|command|stdout|stderr|diff/i;
    for (const key of Object.keys(receipt)) {
      if (forbidden.test(key)) issue(issues, `/resultReceipt/${key}`, 'privacy', `contains forbidden receipt field ${key}`);
    }
  }
}

function validateFeedback(value: Record<string, unknown>, issues: ContractIssue[]): void {
  disjointArrays(value.expectedSkillIds, value.unsafeSkillIds, '/', issues);
}

function validateHostedGradeSummary(value: Record<string, unknown>, issues: ContractIssue[], basePath = ''): void {
  const receipt = recordValue(value.receipt);
  const invalidatedAt = value.invalidatedAt;
  if (receipt && typeof invalidatedAt === 'string') {
    timestampOrder(receipt.gradedAt, invalidatedAt, `${basePath}/invalidatedAt`, issues);
  }
}

function validateHostedAuditSummary(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const counts = recordValue(value.findingCounts);
  if (!counts) return;
  const critical = typeof counts.critical === 'number' ? counts.critical : 0;
  const high = typeof counts.high === 'number' ? counts.high : 0;
  const medium = typeof counts.medium === 'number' ? counts.medium : 0;
  const low = typeof counts.low === 'number' ? counts.low : 0;
  const info = typeof counts.info === 'number' ? counts.info : 0;
  const total = critical + high + medium + low + info;
  if (value.state === 'passed' && total !== 0) {
    issue(issues, '/findingCounts', 'auditState', 'passed audit summaries must have zero findings');
  }
  if (value.state === 'warnings' && critical !== 0) {
    issue(issues, '/findingCounts/critical', 'auditState', 'warning audit summaries cannot contain critical findings');
  }
}

function validateHostedGradeReceipt(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const dimensions = arrayRecords(value.dimensions);
  const hardGates = arrayRecords(value.hardGates);
  uniqueRecordField(value.dimensions, 'code', '/dimensions', issues);
  uniqueRecordField(value.hardGates, 'code', '/hardGates', issues);
  verifyReceiptDigest(value, 'projectionDigest', issues);

  const failedHardGates = hardGates.filter((entry) => entry.passed === false);
  if (value.state === 'blocked' && failedHardGates.length === 0) {
    issue(issues, '/hardGates', 'hardGateState', 'blocked grades require at least one failed hard gate');
  }
  if (value.state === 'current' && failedHardGates.length > 0) {
    issue(issues, '/hardGates', 'hardGateState', 'current grades require every hard gate to pass');
  }
  if (value.state === 'provisional'
    && failedHardGates.some((entry) => entry.code !== 'behavioral-evidence-bound')) {
    issue(issues, '/hardGates', 'hardGateState', 'provisional grades may fail only the behavioral-evidence-bound gate');
  }
  for (const [index, gate] of hardGates.entries()) {
    if (gate.passed === true && (typeof gate.evidenceDigest !== 'string' || !DIGEST_PATTERN.test(gate.evidenceDigest))) {
      issue(issues, `/hardGates/${index}/evidenceDigest`, 'hardGateEvidence', 'passed hard gates require a lowercase sha256 evidence digest');
    }
  }

  if (value.rubricVersion === 'skillmap-rubric/v1') {
    const expected = new Map<string, number>([
      ['instruction-quality', 0.25],
      ['safety-and-permissions', 0.25],
      ['routing-quality', 0.20],
      ['reproducibility', 0.15],
      ['maintenance-and-provenance', 0.15]
    ]);
    if (dimensions.length !== expected.size) {
      issue(issues, '/dimensions', 'rubricDimensions', 'skillmap-rubric/v1 requires exactly five dimensions');
    }
    for (const [index, entry] of dimensions.entries()) {
      const code = typeof entry.code === 'string' ? entry.code : '';
      const requiredWeight = expected.get(code);
      if (requiredWeight === undefined) {
        issue(issues, `/dimensions/${index}/code`, 'rubricDimensions', `unexpected skillmap-rubric/v1 dimension ${code}`);
      } else if (entry.weight !== requiredWeight) {
        issue(issues, `/dimensions/${index}/weight`, 'rubricWeight', `must equal ${requiredWeight} for ${code}`);
      }
    }
    for (const code of expected.keys()) {
      if (!dimensions.some((entry) => entry.code === code)) {
        issue(issues, '/dimensions', 'rubricDimensions', `missing skillmap-rubric/v1 dimension ${code}`);
      }
    }
    const requiredHardGates = new Set([
      'source-identity',
      'audit-acceptable',
      'license-confirmed',
      'compatibility-evidence-bound',
      'behavioral-evidence-bound'
    ]);
    if (hardGates.length !== requiredHardGates.size) {
      issue(issues, '/hardGates', 'rubricHardGates', 'skillmap-rubric/v1 requires exactly five hard gates');
    }
    for (const [index, entry] of hardGates.entries()) {
      const code = typeof entry.code === 'string' ? entry.code : '';
      if (!requiredHardGates.has(code)) {
        issue(issues, `/hardGates/${index}/code`, 'rubricHardGates', `unexpected skillmap-rubric/v1 hard gate ${code}`);
      }
    }
    for (const code of requiredHardGates) {
      if (!hardGates.some((entry) => entry.code === code)) {
        issue(issues, '/hardGates', 'rubricHardGates', `missing skillmap-rubric/v1 hard gate ${code}`);
      }
    }
  }

  const weights = dimensions.map((entry) => typeof entry.weight === 'number' ? entry.weight : Number.NaN);
  const scores = dimensions.map((entry) => typeof entry.score === 'number' ? entry.score : Number.NaN);
  if (weights.some((entry) => !Number.isFinite(entry)) || scores.some((entry) => !Number.isFinite(entry))) return;
  const weightTotal = weights.reduce((sum, entry) => sum + entry, 0);
  if (Math.abs(weightTotal - 1) > 1e-9) {
    issue(issues, '/dimensions', 'weightTotal', `dimension weights must sum to 1; computed ${weightTotal}`);
  }
  const computedScore = dimensions.reduce((sum, entry) => sum + Number(entry.weight) * Number(entry.score), 0);
  const roundedScore = Math.round(computedScore);
  if (typeof value.totalScore === 'number' && roundedScore !== value.totalScore) {
    issue(issues, '/totalScore', 'scoreArithmetic', `must equal the rounded weighted dimension score; computed ${roundedScore}`);
  }
}

function validateHostedSkillList(value: Record<string, unknown>, issues: ContractIssue[], basePath = ''): void {
  const query = recordValue(value.query);
  const pagination = recordValue(value.pagination);
  const rawItems = value.items;
  const items = arrayRecords(rawItems);
  if (Array.isArray(rawItems) && rawItems.length === items.length) {
    uniqueRecordField(rawItems, 'skillId', `${basePath}/items`, issues);
    if (query && typeof query.limit === 'number' && rawItems.length > query.limit) {
      issue(issues, `${basePath}/items`, 'pageLimit', 'must not contain more items than query.limit');
    }
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      const previousVersion = recordValue(previous.currentVersion);
      const currentVersion = recordValue(current.currentVersion);
      const previousPublishedAt = previousVersion?.publishedAt;
      const currentPublishedAt = currentVersion?.publishedAt;
      if (typeof previousPublishedAt !== 'string' || typeof currentPublishedAt !== 'string') continue;
      if (currentPublishedAt > previousPublishedAt
        || (currentPublishedAt === previousPublishedAt
          && typeof previous.skillId === 'string'
          && typeof current.skillId === 'string'
          && current.skillId.localeCompare(previous.skillId) < 0)) {
        issue(issues, `${basePath}/items/${index}`, 'stableSort', 'must follow published_at descending then skill_id ascending');
      }
    }
  }
  if (pagination) {
    const cursorPresent = typeof pagination.nextCursor === 'string';
    if (pagination.hasMore !== cursorPresent) {
      issue(issues, `${basePath}/pagination`, 'cursorState', 'hasMore must be true exactly when nextCursor is present');
    }
  }
}

function validateHostedApiResponse(value: Record<string, unknown>, issues: ContractIssue[]): void {
  if (value.ok !== true) return;
  const data = recordValue(value.data);
  if (!data) return;
  if (data.kind === 'skillmap.hosted-skill-list') validateHostedSkillList(data, issues, '/data');
  if (data.kind === 'skillmap.hosted-skill') {
    const grade = recordValue(recordValue(data.currentVersion)?.grade);
    if (grade) validateHostedGradeSummary(grade, issues, '/data/currentVersion/grade');
  }
}

function validateEvalSuiteV2(value: Record<string, unknown>, issues: ContractIssue[]): void {
  uniqueRecordField(value.evals, 'id', '/evals', issues, true);
  for (const [index, item] of arrayRecords(value.evals).entries()) disjointArrays(item.expected, item.avoid, `/evals/${index}`, issues);
}

function validateEvalSuiteV3(value: Record<string, unknown>, issues: ContractIssue[]): void {
  uniqueRecordField(value.cases, 'caseId', '/cases', issues);
  timestampOrder(value.createdAt, value.updatedAt, '/updatedAt', issues);
  const datasetProvenance = recordValue(value.provenance);
  const baseline = recordValue(value.baseline);
  const baselineProvenance = recordValue(baseline?.provenance);
  const baselineSourceRevision = recordValue(baselineProvenance?.sourceRevision);
  if (datasetProvenance) {
    timestampOrder(datasetProvenance.createdAt, datasetProvenance.holdoutFrozenAt, '/provenance/holdoutFrozenAt', issues);
    timestampOrder(datasetProvenance.holdoutFrozenAt, baselineProvenance?.completedAt, '/baseline/provenance/completedAt', issues);
    timestampOrder(baselineProvenance?.completedAt, datasetProvenance.reviewedAt, '/provenance/reviewedAt', issues);
    timestampOrder(datasetProvenance.reviewedAt, value.updatedAt, '/updatedAt', issues);
    for (const key of ['labelAuthor', 'reviewedBy'] as const) {
      if (typeof datasetProvenance[key] !== 'string' || datasetProvenance[key].trim().length === 0) {
        issue(issues, `/provenance/${key}`, 'datasetProvenance', `${key} must contain non-whitespace text`);
      }
    }
  }
  const caseSetDigest = computeEvalSuiteV3CaseSetDigest(value);
  if (datasetProvenance?.frozenCaseSetDigest !== caseSetDigest) {
    issue(issues, '/provenance/frozenCaseSetDigest', 'caseSetDigest', `must match the frozen ordered case projection; computed ${caseSetDigest}`);
  }
  if (baselineProvenance?.caseSetDigest !== caseSetDigest) {
    issue(issues, '/baseline/provenance/caseSetDigest', 'caseSetDigest', `must match the frozen ordered case projection; computed ${caseSetDigest}`);
  }
  if (baselineProvenance?.sourceKind === 'approved-effective-revision'
    && (!baselineSourceRevision
      || typeof baselineSourceRevision.effectiveDigest !== 'string'
      || typeof baselineSourceRevision.effectiveRevisionDigest !== 'string')) {
    issue(issues, '/baseline/provenance/sourceRevision', 'baselineProvenance', 'approved baseline source must bind non-null effective digests');
  }
  const normalizedPrompts = new Map<string, number>();
  for (const [index, item] of arrayRecords(value.cases).entries()) {
    disjointArrays(item.expectedSkillIds, item.avoidSkillIds, `/cases/${index}`, issues);
    if (item.qualifiedSkillId !== undefined
      && (item.primaryCaseType !== 'explicit' || !stringArray(item.expectedSkillIds).includes(String(item.qualifiedSkillId)))) {
      issue(issues, `/cases/${index}/qualifiedSkillId`, 'qualifiedSkillId', 'is allowed only for an explicit case whose expected labels include that skill');
    }
    const provenance = recordValue(item.labelProvenance);
    if (provenance) {
      timestampOrder(provenance.createdAt, provenance.reviewedAt, `/cases/${index}/labelProvenance/reviewedAt`, issues);
      timestampOrder(provenance.reviewedAt, datasetProvenance?.holdoutFrozenAt, `/cases/${index}/labelProvenance/reviewedAt`, issues);
      if (typeof provenance.author !== 'string' || provenance.author.trim().length === 0) {
        issue(issues, `/cases/${index}/labelProvenance/author`, 'labelProvenance', 'author must contain non-whitespace text');
      }
    }
    if (typeof item.prompt === 'string') {
      try {
        validateRoutePrompt(item.prompt, typeof item.qualifiedSkillId === 'string');
      } catch {
        issue(issues, `/cases/${index}/prompt`, 'routePrompt', 'must satisfy the exact runtime route prompt boundary');
      }
      const qualifiedSkillId = typeof item.qualifiedSkillId === 'string' ? item.qualifiedSkillId : null;
      const normalized = normalizeEvalPrompt(item.prompt);
      if (normalized.length === 0 && !qualifiedSkillId) {
        issue(issues, `/cases/${index}/prompt`, 'prompt', 'must contain text after normalization');
        continue;
      }
      const deduplicationKey = normalized.length > 0 ? normalized : `qualified:${qualifiedSkillId}`;
      const duplicateOf = normalizedPrompts.get(deduplicationKey);
      if (duplicateOf !== undefined) {
        issue(issues, `/cases/${index}/prompt`, 'deduplication', `duplicates normalized prompt from case index ${duplicateOf}`);
      } else {
        normalizedPrompts.set(deduplicationKey, index);
      }
    }
  }
  if (typeof value.datasetDigest === 'string') {
    const computed = computeEvalSuiteV3DatasetDigest(value);
    if (value.datasetDigest !== computed) issue(issues, '/datasetDigest', 'datasetDigest', `must match canonical eval dataset projection; computed ${computed}`);
  }
}

function validateEvalRunV3(
  value: Record<string, unknown>,
  issues: ContractIssue[],
  context?: SemanticValidationContext
): void {
  uniqueRecordField(value.caseResults, 'caseId', '/caseResults', issues);
  timestampOrder(value.startedAt, value.finishedAt, '/finishedAt', issues);
  const revision = recordValue(value.revision);
  const revisionBound = Boolean(revision
    && value.workspaceId === revision.workspaceId
    && typeof revision.effectiveDigest === 'string'
    && typeof revision.effectiveRevisionDigest === 'string');
  if (revision && value.workspaceId !== revision.workspaceId) {
    issue(issues, '/workspaceId', 'workspaceId', 'must equal revision.workspaceId');
  }
  if (revision && typeof revision.effectiveDigest !== 'string') {
    issue(issues, '/revision/effectiveDigest', 'effectiveDigest', 'must bind an eval run to an approved effective artifact');
  }
  if (revision && typeof revision.effectiveRevisionDigest !== 'string') {
    issue(issues, '/revision/effectiveRevisionDigest', 'effectiveRevisionDigest', 'must bind an eval run to approved routing semantics');
  }

  const caseResults = arrayRecords(value.caseResults);
  if (!Array.isArray(value.caseResults) || caseResults.length !== value.caseResults.length) return;
  const derivedCases = caseResults.map((item, index) => deriveEvalRunCase(item, index, issues));
  const derivedComposition = {
    total: derivedCases.length,
    explicit: derivedCases.filter((item) => item.primaryCaseType === 'explicit').length,
    implicitNatural: derivedCases.filter((item) => item.primaryCaseType === 'implicit-natural').length,
    multiSkill: derivedCases.filter((item) => item.primaryCaseType === 'multi-skill').length,
    negativeNearMiss: derivedCases.filter((item) => item.primaryCaseType === 'negative-near-miss').length,
    untyped: derivedCases.filter((item) => item.primaryCaseType === undefined).length,
    releaseCounted: derivedCases.filter((item) => item.releaseCounted).length,
    releaseScored: derivedCases.filter((item) => item.releaseScored).length
  };
  const provenanceComplete = validateEvalRunV3CompanionBinding(value, derivedCases, derivedComposition, context, issues);
  const composition = recordValue(value.composition);
  const metrics = recordValue(value.metrics);
  const holdout = recordValue(value.holdout);
  const leakage = recordValue(value.leakage);
  const baseline = recordValue(value.baseline);
  const baselineComparison = recordValue(value.baselineComparison);
  const thresholds = recordValue(value.thresholds);
  if (!composition || !metrics || !holdout || !leakage || !baseline || !baselineComparison || !thresholds) return;

  for (const [key, expected] of Object.entries(derivedComposition)) {
    expectEvalNumber(composition, key, expected, `/composition/${key}`, 'composition', issues);
  }

  const releaseScored = derivedCases.filter((item) => item.releaseScored);
  const releaseCounted = derivedCases.filter((item) => item.releaseCounted);
  const top1 = releaseScored.filter((item) => item.top1Hit).length;
  const top3 = releaseScored.filter((item) => item.top3Hit).length;
  const avoidHits = releaseCounted.reduce((sum, item) => sum + item.avoidedButRecommendedSkillIds.length, 0);
  const negativeCases = releaseCounted.filter((item) => item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0);
  const negativeAbstentions = negativeCases.filter((item) => item.abstained).length;
  const advisoryBytes = releaseCounted.reduce((sum, item) => sum + item.advisoryBytes, 0);
  const derivedMetrics = {
    count: derivedCases.length,
    top1,
    top3,
    avoidHits,
    top1Rate: releaseScored.length === 0 ? 0 : top1 / releaseScored.length,
    top3Rate: releaseScored.length === 0 ? 0 : top3 / releaseScored.length,
    abstentionRate: negativeCases.length === 0 ? 0 : negativeAbstentions / negativeCases.length,
    meanAdvisoryBytes: releaseCounted.length === 0 ? 0 : advisoryBytes / releaseCounted.length
  };
  for (const [key, expected] of Object.entries(derivedMetrics)) {
    expectEvalNumber(metrics, key, expected, `/metrics/${key}`, 'metrics', issues);
  }

  const holdoutCount = releaseCounted.filter((item) => item.membership === 'holdout').length;
  const derivedHoldout = evalHoldoutResult(releaseCounted.length, holdoutCount);
  for (const key of ['count', 'requiredCount', 'ratio'] as const) {
    expectEvalNumber(holdout, key, derivedHoldout[key], `/holdout/${key}`, 'holdout', issues);
  }
  expectEvalBoolean(holdout, 'pass', derivedHoldout.pass, '/holdout/pass', 'holdout', issues);

  const leakageCaseIds = derivedCases.filter((item) => item.leakageCodes.length > 0).map((item) => item.caseId);
  expectEvalNumber(leakage, 'count', leakageCaseIds.length, '/leakage/count', 'leakage', issues);
  expectEvalBoolean(leakage, 'pass', leakageCaseIds.length === 0, '/leakage/pass', 'leakage', issues);
  expectEvalStringList(leakage, 'caseIds', leakageCaseIds, '/leakage/caseIds', 'leakage', issues);

  const metricInput = {
    top1Rate: derivedMetrics.top1Rate,
    top3Rate: derivedMetrics.top3Rate,
    avoidHits: derivedMetrics.avoidHits,
    abstentionRate: derivedMetrics.abstentionRate,
    meanAdvisoryBytes: derivedMetrics.meanAdvisoryBytes
  };
  const baselineInput = {
    top1Rate: numericValue(baseline.top1Rate),
    top3Rate: numericValue(baseline.top3Rate),
    avoidHits: numericValue(baseline.avoidHits),
    abstentionRate: numericValue(baseline.abstentionRate),
    meanAdvisoryBytes: numericValue(baseline.meanAdvisoryBytes)
  };
  const derivedBaseline = compareEvalBaseline(baselineInput, metricInput);
  for (const key of ['provided', 'nonRegression', 'improvement', 'perfectBaseline', 'pass'] as const) {
    expectEvalBoolean(baselineComparison, key, derivedBaseline[key], `/baselineComparison/${key}`, 'baselineComparison', issues);
  }
  expectEvalStringList(baselineComparison, 'improvements', derivedBaseline.improvements, '/baselineComparison/improvements', 'baselineComparison', issues);
  expectEvalStringList(baselineComparison, 'regressions', derivedBaseline.regressions, '/baselineComparison/regressions', 'baselineComparison', issues);

  const derivedValidationErrors = derivedCases.flatMap((item) => item.validationCodes.map((code) => `${item.caseId}:${code}`));
  const invalidCaseCount = derivedCases.filter((item) => item.validationCodes.length > 0).length;
  if (value.invalidCaseCount !== invalidCaseCount) {
    issue(issues, '/invalidCaseCount', 'invalidCaseCount', `must equal the ${invalidCaseCount} cases with validation codes`);
  }
  if (!sameStringArray(value.validationErrors, derivedValidationErrors)) {
    issue(issues, '/validationErrors', 'validationErrors', 'must equal the case-order caseId:validationCode projection');
  }

  const thresholdInput = {
    minCount: numericValue(thresholds.minCount),
    minTop1: numericValue(thresholds.minTop1),
    minTop3: numericValue(thresholds.minTop3),
    maxAvoidHits: numericValue(thresholds.maxAvoidHits)
  };
  const derivedThresholdPass = evalThresholdPass(derivedComposition.releaseCounted, metricInput, thresholdInput);
  expectEvalBoolean(value, 'thresholdPass', derivedThresholdPass, '/thresholdPass', 'thresholdPass', issues);
  const derivedReleaseEligibility = evalReleaseEvidenceEligible({
    qualified: value.schemaVersion === 3,
    fixture: value.fixture === true,
    composition: derivedComposition,
    holdoutPass: derivedHoldout.pass,
    leakagePass: leakageCaseIds.length === 0,
    provenanceComplete,
    baselinePass: derivedBaseline.pass,
    invalidCaseCount,
    validationErrorCount: derivedValidationErrors.length,
    metrics: metricInput,
    revisionBound
  });
  expectEvalBoolean(value, 'releaseEvidenceEligible', derivedReleaseEligibility, '/releaseEvidenceEligible', 'releaseEvidenceEligible', issues);
  const derivedPass = derivedReleaseEligibility && derivedThresholdPass;
  expectEvalBoolean(value, 'pass', derivedPass, '/pass', 'pass', issues);
  const derivedEvidenceLevel = evalEvidenceLevel(3, derivedComposition.untyped, derivedPass);
  if (value.evidenceLevel !== derivedEvidenceLevel) {
    issue(issues, '/evidenceLevel', 'evidenceLevel', `must equal ${derivedEvidenceLevel} for the recomputed run evidence`);
  }
}

function validateEvalRunV3CompanionBinding(
  value: Record<string, unknown>,
  derivedCases: DerivedEvalRunCase[],
  derivedComposition: Record<string, number>,
  context: SemanticValidationContext | undefined,
  issues: ContractIssue[]
): boolean {
  const releaseClaimed = value.releaseEvidenceEligible === true || value.pass === true || value.evidenceLevel === 'release';
  const companion = context?.evalSuiteV3;
  const effective = context?.evalEffective;
  if (!companion || !effective) {
    if (releaseClaimed) {
      issue(issues, '/releaseEvidenceEligible', 'releaseContext', 'release evidence requires the reviewed suite, approved revision, and exact effective registry');
    }
    return false;
  }
  if (!companion.valid || !companion.value || !effective.valid || !effective.approvedRevision || !effective.registry) {
    if (releaseClaimed) {
      issue(issues, '/releaseEvidenceEligible', 'releaseContext', 'release evidence requires a valid reviewed suite and approved effective registry context');
    }
    return false;
  }

  const suite = companion.value;
  const approvedRevision = effective.approvedRevision;
  let bound = true;
  const reject = (path: string, message: string): void => {
    bound = false;
    issue(issues, path, 'releaseContext', message);
  };

  if (canonicalJson(value.revision) !== canonicalJson(approvedRevision)) reject('/revision', 'must exactly equal the trusted approved state-store revision');
  if (value.workspaceId !== approvedRevision.workspaceId) reject('/workspaceId', 'must equal the approved revision workspaceId');
  if (value.fixture !== effective.fixture) reject('/fixture', `must equal the approved effective registry fixture state ${effective.fixture}`);
  if (value.suiteId !== suite.suiteId) reject('/suiteId', 'must equal companion suite suiteId');
  const computedDatasetDigest = computeEvalSuiteV3DatasetDigest(suite);
  if (suite.datasetDigest !== computedDatasetDigest) reject('/datasetDigest', 'companion suite datasetDigest must match its canonical dataset projection');
  if (value.datasetDigest !== computedDatasetDigest) reject('/datasetDigest', 'must equal the recomputed companion suite datasetDigest');

  const provenance = recordValue(suite.provenance);
  const baseline = recordValue(suite.baseline);
  const baselineProvenance = recordValue(baseline?.provenance);
  const provenanceComplete = Boolean(provenance
    && typeof provenance.labelAuthor === 'string'
    && provenance.labelAuthor.trim().length > 0
    && typeof provenance.reviewedBy === 'string'
    && provenance.reviewedBy.trim().length > 0
    && provenance.sourceClass !== 'synthetic'
    && typeof provenance.createdAt === 'string'
    && isRealUtcTimestamp(provenance.createdAt)
    && typeof provenance.holdoutFrozenAt === 'string'
    && isRealUtcTimestamp(provenance.holdoutFrozenAt)
    && typeof provenance.reviewedAt === 'string'
    && isRealUtcTimestamp(provenance.reviewedAt)
    && provenance.deduplicationResult === 'passed'
    && provenance.holdoutFrozen === true
    && provenance.frozenCaseSetDigest === computeEvalSuiteV3CaseSetDigest(suite)
    && baselineProvenance?.caseSetDigest === provenance.frozenCaseSetDigest);
  if (!provenanceComplete) reject('/releaseEvidenceEligible', 'companion suite provenance must be complete, reviewed, non-synthetic, deduplicated, case-bound, and holdout-frozen');
  const baselineSourceRevision = recordValue(baselineProvenance?.sourceRevision);
  const trustedBaselineRevision = effective.approvedBaselineRevision;
  let baselineEffective: PreparedEvalEffectiveContext | null = null;
  if (baselineProvenance?.sourceKind === 'approved-effective-revision') {
    if (baselineSourceRevision?.workspaceId !== approvedRevision.workspaceId) {
      reject('/baseline/provenance/sourceRevision', 'approved baseline source must belong to the same workspace');
    }
    if (!trustedBaselineRevision) {
      reject('/context/approvedBaselineRevision', 'approved baseline source requires a RevisionRef independently resolved from immutable history');
    } else if (!baselineSourceRevision || canonicalJson(baselineSourceRevision) !== canonicalJson(trustedBaselineRevision)) {
      reject('/baseline/provenance/sourceRevision', 'must equal the independently resolved historical RevisionRef');
    } else {
      const baselineSequence = revisionSequence(trustedBaselineRevision);
      const currentSequence = revisionSequence(approvedRevision);
      if (!baselineSequence || !currentSequence || baselineSequence >= currentSequence) {
        reject('/context/approvedBaselineRevision/revisionId', 'historical baseline revision must predate the current approved revision');
      }
    }
    if (!baselineSourceRevision || !trustedBaselineRevision || !effective.baselineEffectiveArtifact) {
      reject('/context/baselineEffectiveArtifact', 'approved baseline source requires its exact historical effective artifact');
    } else {
      const baselineIssues: ContractIssue[] = [];
      baselineEffective = prepareEvalRunV3EffectiveContext({
        companionSuite: suite,
        approvedRevision: trustedBaselineRevision,
        effectiveArtifact: effective.baselineEffectiveArtifact,
        baselineEffectiveArtifact: null,
        approvedBaselineRevision: null
      }, baselineIssues);
      for (const entry of baselineIssues) {
        bound = false;
        issues.push({
          ...entry,
          path: entry.path
            .replace('/context/approvedRevision', '/baseline/provenance/sourceRevision')
            .replace('/context/effectiveArtifact', '/context/baselineEffectiveArtifact')
        });
      }
      if (baselineEffective.fixture) reject('/context/baselineEffectiveArtifact', 'baseline effective registry must not contain fixture state');
    }
  } else {
    reject('/baseline/provenance/sourceKind', 'operator-declared baseline is reviewable candidate evidence but cannot independently satisfy the release baseline gate');
  }
  if (typeof suite.updatedAt === 'string' && typeof value.startedAt === 'string') {
    if (!isRealUtcTimestamp(suite.updatedAt) || !isRealUtcTimestamp(value.startedAt) || Date.parse(suite.updatedAt) > Date.parse(value.startedAt)) {
      reject('/startedAt', 'run must start after the reviewed frozen suite was finalized');
    }
  }

  const suiteCases = arrayRecords(suite.cases);
  if (!Array.isArray(suite.cases) || suiteCases.length !== derivedCases.length || suiteCases.length !== suite.cases.length) {
    reject('/caseResults', 'must contain the same ordered case set as the companion suite');
  }
  const routeWork = computeEvalRouteReplayWorkUnits(
    suiteCases,
    effective.skills,
    baselineEffective?.skills ?? []
  );
  if (suiteCases.length > EVAL_RELEASE_CASE_LIMIT
    || effective.skills.length > EVAL_RELEASE_SKILL_LIMIT
    || (baselineEffective?.skills.length ?? 0) > EVAL_RELEASE_SKILL_LIMIT
    || routeWork > EVAL_RELEASE_ROUTE_WORK_LIMIT) {
    reject('/caseResults', `release-context replay exceeds its ${EVAL_RELEASE_ROUTE_WORK_LIMIT}-byte work budget`);
    return false;
  }
  if (baselineEffective?.valid && baseline) {
    const recomputedBaseline = computeEvalSuiteV3RoutingMetrics(suiteCases, baselineEffective.skills);
    for (const key of ['top1Rate', 'top3Rate', 'avoidHits', 'abstentionRate', 'meanAdvisoryBytes'] as const) {
      if (!numbersEqual(numericValue(baseline[key]), recomputedBaseline[key])) {
        reject(`/baseline/${key}`, `must equal historical approved-registry replay value ${recomputedBaseline[key]}`);
      }
    }
  }
  const pairedCount = Math.min(suiteCases.length, derivedCases.length);
  const effectiveById = new Map(effective.skills.map((skill) => [skill.skillId, skill]));
  for (let index = 0; index < pairedCount; index += 1) {
    const suiteCase = suiteCases[index];
    const runCase = derivedCases[index];
    const path = `/caseResults/${index}`;
    if (runCase.caseId !== suiteCase.caseId) reject(`${path}/caseId`, 'must equal the ordered companion suite caseId');
    if (runCase.primaryCaseType !== suiteCase.primaryCaseType) reject(`${path}/primaryCaseType`, 'must equal the companion suite primaryCaseType');
    if (runCase.membership !== suiteCase.membership) reject(`${path}/membership`, 'must equal the companion suite holdout membership');
    if (!sameStringArray(suiteCase.expectedSkillIds, runCase.expectedSkillIds)) reject(`${path}/expectedSkillIds`, 'must equal the ordered companion suite expectedSkillIds');
    if (!sameStringArray(suiteCase.avoidSkillIds, runCase.avoidSkillIds)) reject(`${path}/avoidSkillIds`, 'must equal the ordered companion suite avoidSkillIds');
    const suiteQualifiedSkillId = typeof suiteCase.qualifiedSkillId === 'string' ? suiteCase.qualifiedSkillId : undefined;
    if (runCase.qualifiedSkillId !== suiteQualifiedSkillId) reject(`${path}/qualifiedSkillId`, 'must equal the companion suite qualifiedSkillId');
    const caseProvenance = recordValue(suiteCase.labelProvenance);
    if (caseProvenance?.sourceClass === 'synthetic') reject(`${path}/labelProvenance`, 'release-counted labels must not use synthetic provenance');
    for (const skillId of stringArray(suiteCase.expectedSkillIds)) {
      const skill = effectiveById.get(skillId);
      if (!skill) reject(`${path}/expectedSkillIds`, `unknown expected skillId ${skillId}`);
      else if (skillId === suiteQualifiedSkillId) {
        if (!skill.qualifiedExplicitAllowed) reject(`${path}/qualifiedSkillId`, `qualified skillId ${skillId} is not approved for explicit routing`);
      } else if (!skill.routeEligible || !skill.qualifiedExplicitAllowed) {
        reject(`${path}/expectedSkillIds`, `expected skillId ${skillId} is not approved for routing`);
      }
    }
    for (const skillId of stringArray(suiteCase.avoidSkillIds)) {
      if (!effectiveById.has(skillId)) reject(`${path}/avoidSkillIds`, `unknown avoid skillId ${skillId}`);
    }
    if (typeof suiteCase.prompt === 'string') {
      const prompt = validateRoutePrompt(suiteCase.prompt, Boolean(suiteQualifiedSkillId));
      const ranked = rankRoutePrompt(effective.skills, prompt || 'qualified skill selection', 3, suiteQualifiedSkillId);
      const expectedRecommendations = ranked.recommendations.map((entry) => entry.skillId);
      if (!sameStringArray(runCase.recommendedSkillIds, expectedRecommendations)) {
        reject(`${path}/recommendedSkillIds`, 'must equal the deterministic approved-registry route result');
      }
      const expectedAdvisoryBytes = utf8ByteLength(ranked.hookText);
      if (runCase.advisoryBytes !== expectedAdvisoryBytes) {
        reject(`${path}/advisoryBytes`, `must equal deterministic hook text size ${expectedAdvisoryBytes}`);
      }
      const expectedLeakageCodes = detectEvalSuiteV3LeakageCodes(suiteCase, effectiveById);
      if (!sameStringArray(runCase.leakageCodes, expectedLeakageCodes)) {
        reject(`${path}/leakageCodes`, `must equal recomputed registry leakage codes ${expectedLeakageCodes.join(',') || '(empty)'}`);
      }
    }
  }

  const suiteComposition = deriveEvalSuiteV3Composition(suiteCases);
  for (const [key, expected] of Object.entries(suiteComposition)) {
    if (derivedComposition[key] !== expected) reject(`/composition/${key}`, `must equal companion suite composition value ${expected}`);
  }
  if (canonicalJson(value.baseline) !== canonicalJson(suite.baseline)) reject('/baseline', 'must equal the companion suite baseline and its operator-reviewed provenance');
  return bound;
}

function deriveEvalSuiteV3Composition(cases: Record<string, unknown>[]): Record<string, number> {
  const typed = cases.map((item) => ({
    primaryCaseType: item.primaryCaseType,
    expectedSkillIds: stringArray(item.expectedSkillIds)
  }));
  return {
    total: typed.length,
    explicit: typed.filter((item) => item.primaryCaseType === 'explicit').length,
    implicitNatural: typed.filter((item) => item.primaryCaseType === 'implicit-natural').length,
    multiSkill: typed.filter((item) => item.primaryCaseType === 'multi-skill').length,
    negativeNearMiss: typed.filter((item) => item.primaryCaseType === 'negative-near-miss').length,
    untyped: typed.filter((item) => !['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'].includes(String(item.primaryCaseType))).length,
    releaseCounted: typed.filter((item) => item.primaryCaseType !== 'explicit').length,
    releaseScored: typed.filter((item) => item.primaryCaseType !== 'explicit' && item.expectedSkillIds.length > 0).length
  };
}

function computeEvalSuiteV3RoutingMetrics(cases: Record<string, unknown>[], skills: RouteRankingSkill[]): {
  top1Rate: number;
  top3Rate: number;
  avoidHits: number;
  abstentionRate: number;
  meanAdvisoryBytes: number;
} {
  let releaseScored = 0;
  let releaseCounted = 0;
  let top1 = 0;
  let top3 = 0;
  let avoidHits = 0;
  let negativeCases = 0;
  let negativeAbstentions = 0;
  let advisoryBytes = 0;
  for (const item of cases) {
    if (item.primaryCaseType === 'explicit') continue;
    const prompt = validateRoutePrompt(item.prompt, false);
    const ranked = rankRoutePrompt(skills, prompt, 3);
    const recommended = ranked.recommendations.map((entry) => entry.skillId);
    const expected = stringArray(item.expectedSkillIds);
    const avoid = stringArray(item.avoidSkillIds);
    releaseCounted += 1;
    advisoryBytes += utf8ByteLength(ranked.hookText);
    avoidHits += avoid.filter((skillId) => recommended.includes(skillId)).length;
    if (expected.length > 0) {
      releaseScored += 1;
      if (expected.includes(recommended[0])) top1 += 1;
      if (item.primaryCaseType === 'multi-skill'
        ? expected.every((skillId) => recommended.slice(0, 3).includes(skillId))
        : expected.some((skillId) => recommended.slice(0, 3).includes(skillId))) top3 += 1;
    }
    if (item.primaryCaseType === 'negative-near-miss' && expected.length === 0) {
      negativeCases += 1;
      if (recommended.length === 0) negativeAbstentions += 1;
    }
  }
  return {
    top1Rate: releaseScored === 0 ? 0 : top1 / releaseScored,
    top3Rate: releaseScored === 0 ? 0 : top3 / releaseScored,
    avoidHits,
    abstentionRate: negativeCases === 0 ? 0 : negativeAbstentions / negativeCases,
    meanAdvisoryBytes: releaseCounted === 0 ? 0 : advisoryBytes / releaseCounted
  };
}

export function computeEvalRouteRegistryWorkUnits(skills: readonly RouteRankingSkill[]): number {
  return skills.reduce((total, skill) => {
    const scalarBytes = [skill.name, skill.description, skill.family ?? '', skill.path]
      .reduce((sum, entry) => sum + utf8ByteLength(entry), 0);
    let listBytes = 0;
    for (const list of [skill.aliases, skill.preferredFor, skill.avoidFor, skill.supersedes]) {
      for (const entry of list) listBytes += Math.max(1, utf8ByteLength(entry));
    }
    return total + 64 + scalarBytes + listBytes;
  }, 0);
}

export function computeEvalRouteReplayWorkUnits(
  cases: readonly Record<string, unknown>[],
  currentSkills: readonly RouteRankingSkill[],
  baselineSkills: readonly RouteRankingSkill[]
): number {
  const replayPhraseScans = routePhraseScanCount(currentSkills) + routePhraseScanCount(baselineSkills);
  const promptWork = cases.reduce((total, item) => total
    + Math.max(1, utf8ByteLength(typeof item.prompt === 'string' ? item.prompt : '')) * Math.max(1, replayPhraseScans), 0);
  return cases.length * (
    Math.max(1, computeEvalRouteRegistryWorkUnits(currentSkills))
    + Math.max(0, computeEvalRouteRegistryWorkUnits(baselineSkills))
  ) + promptWork;
}

function routePhraseScanCount(skills: readonly RouteRankingSkill[]): number {
  return skills.reduce((total, skill) => total
    + 1
    + skill.aliases.length
    + skill.preferredFor.length
    + skill.avoidFor.length, 0);
}

interface DerivedEvalRunCase {
  caseId: string;
  primaryCaseType: 'explicit' | 'implicit-natural' | 'multi-skill' | 'negative-near-miss' | undefined;
  membership: 'train' | 'holdout' | undefined;
  expectedSkillIds: string[];
  avoidSkillIds: string[];
  qualifiedSkillId: string | undefined;
  recommendedSkillIds: string[];
  avoidedButRecommendedSkillIds: string[];
  validationCodes: string[];
  leakageCodes: string[];
  releaseCounted: boolean;
  releaseScored: boolean;
  top1Hit: boolean;
  top3Hit: boolean;
  abstained: boolean;
  advisoryBytes: number;
}

function deriveEvalRunCase(value: Record<string, unknown>, index: number, issues: ContractIssue[]): DerivedEvalRunCase {
  const path = `/caseResults/${index}`;
  const caseId = typeof value.caseId === 'string' ? value.caseId : `case-${index}`;
  const primaryCaseType = typeof value.primaryCaseType === 'string'
    && ['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'].includes(value.primaryCaseType)
    ? value.primaryCaseType as DerivedEvalRunCase['primaryCaseType']
    : undefined;
  const membership = value.membership === 'train' || value.membership === 'holdout' ? value.membership : undefined;
  const expectedSkillIds = stringArray(value.expectedSkillIds);
  const avoidSkillIds = stringArray(value.avoidSkillIds);
  const qualifiedSkillId = typeof value.qualifiedSkillId === 'string' ? value.qualifiedSkillId : undefined;
  const recommendedSkillIds = stringArray(value.recommendedSkillIds);
  const topThreeRecommendedSkillIds = recommendedSkillIds.slice(0, 3);
  const claimedAvoided = stringArray(value.avoidedButRecommendedSkillIds);
  const reasonCodes = stringArray(value.reasonCodes);
  const directValidationCodes = stringArray(value.validationCodes);
  const bindingCodes = reasonCodes.filter((code) => /_(?:INVALID|UNRESOLVED|AMBIGUOUS)$/.test(code));
  const validationCodes = [...new Set([...directValidationCodes, ...bindingCodes])];
  const leakageCodes = stringArray(value.leakageCodes);
  const avoidedButRecommendedSkillIds = avoidSkillIds.filter((skillId) => recommendedSkillIds.includes(skillId));
  if (!sameStringArray(claimedAvoided, avoidedButRecommendedSkillIds)) {
    issue(issues, `${path}/avoidedButRecommendedSkillIds`, 'avoidedButRecommendedSkillIds', 'must equal the ordered intersection of avoidSkillIds and recommendedSkillIds');
  }
  disjointArrays(expectedSkillIds, avoidSkillIds, path, issues);
  if ((primaryCaseType === 'explicit' || primaryCaseType === 'implicit-natural') && expectedSkillIds.length < 1) {
    issue(issues, `${path}/expectedSkillIds`, 'caseLabels', `${primaryCaseType} cases require at least one expected skill`);
  }
  if (primaryCaseType === 'multi-skill' && (expectedSkillIds.length < 2 || expectedSkillIds.length > 3)) {
    issue(issues, `${path}/expectedSkillIds`, 'caseLabels', 'multi-skill cases require two or three expected skills');
  }
  if (primaryCaseType === 'negative-near-miss' && avoidSkillIds.length < 1) {
    issue(issues, `${path}/avoidSkillIds`, 'caseLabels', 'negative-near-miss cases require at least one avoid target');
  }
  const top1Hit = expectedSkillIds.length > 0 && expectedSkillIds.includes(recommendedSkillIds[0]);
  const top3Hit = expectedSkillIds.length > 0 && (primaryCaseType === 'multi-skill'
    ? expectedSkillIds.every((skillId) => topThreeRecommendedSkillIds.includes(skillId))
    : expectedSkillIds.some((skillId) => topThreeRecommendedSkillIds.includes(skillId)));
  const abstained = recommendedSkillIds.length === 0;
  const releaseCounted = primaryCaseType !== undefined && primaryCaseType !== 'explicit' && validationCodes.length === 0;
  const releaseScored = releaseCounted && expectedSkillIds.length > 0;
  expectEvalBoolean(value, 'top1Hit', top1Hit, `${path}/top1Hit`, 'top1Hit', issues);
  expectEvalBoolean(value, 'top3Hit', top3Hit, `${path}/top3Hit`, 'top3Hit', issues);
  expectEvalBoolean(value, 'abstained', abstained, `${path}/abstained`, 'abstained', issues);
  expectEvalBoolean(value, 'releaseCounted', releaseCounted, `${path}/releaseCounted`, 'releaseCounted', issues);
  expectEvalBoolean(value, 'releaseScored', releaseScored, `${path}/releaseScored`, 'releaseScored', issues);
  const invalid = validationCodes.length > 0 || leakageCodes.length > 0;
  const outcome = invalid
    ? 'invalid'
    : avoidedButRecommendedSkillIds.length > 0
      ? 'unsafe'
      : primaryCaseType === 'negative-near-miss' && expectedSkillIds.length === 0 && abstained
        ? 'correct-abstention'
        : top1Hit
          ? 'top1-hit'
          : top3Hit
            ? 'top3-hit'
            : 'miss';
  if (value.outcome !== outcome) issue(issues, `${path}/outcome`, 'outcome', `must equal recomputed outcome ${outcome}`);
  const outcomeCode = {
    'top1-hit': 'EXPECTED_TOP1',
    'top3-hit': 'EXPECTED_TOP3',
    'correct-abstention': 'CORRECT_ABSTENTION',
    miss: abstained ? 'EXPECTED_SKILL_ABSTAINED' : 'EXPECTED_SKILL_MISSED',
    unsafe: 'AVOID_TARGET_RECOMMENDED',
    invalid: 'CASE_INVALID'
  }[outcome];
  for (const code of [outcomeCode, ...validationCodes, ...leakageCodes]) {
    if (!reasonCodes.includes(code)) issue(issues, `${path}/reasonCodes`, 'reasonCodes', `must include recomputed code ${code}`);
  }
  return {
    caseId,
    primaryCaseType,
    membership,
    expectedSkillIds,
    avoidSkillIds,
    qualifiedSkillId,
    recommendedSkillIds,
    avoidedButRecommendedSkillIds,
    validationCodes,
    leakageCodes,
    releaseCounted,
    releaseScored,
    top1Hit,
    top3Hit,
    abstained,
    advisoryBytes: numericValue(value.advisoryBytes)
  };
}

function expectEvalNumber(record: Record<string, unknown>, key: string, expected: number, path: string, keyword: string, issues: ContractIssue[]): void {
  const actual = record[key];
  if (typeof actual !== 'number' || !Number.isFinite(actual) || !numbersEqual(actual, expected)) {
    issue(issues, path, keyword, `must equal recomputed value ${expected}`);
  }
}

function expectEvalBoolean(record: Record<string, unknown>, key: string, expected: boolean, path: string, keyword: string, issues: ContractIssue[]): void {
  if (record[key] !== expected) issue(issues, path, keyword, `must equal recomputed value ${expected}`);
}

function expectEvalStringList(record: Record<string, unknown>, key: string, expected: string[], path: string, keyword: string, issues: ContractIssue[]): void {
  if (!sameStringArray(record[key], expected)) issue(issues, path, keyword, `must equal recomputed values ${expected.join(',') || '(empty)'}`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function normalizeEvalPrompt(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function detectEvalSuiteV3LeakageCodes(
  suiteCase: Record<string, unknown>,
  effectiveById: Map<string, RouteRankingSkill>
): string[] {
  if (suiteCase.primaryCaseType === 'explicit' || typeof suiteCase.prompt !== 'string') return [];
  let displayName = false;
  let alias = false;
  let description = false;
  for (const skillId of stringArray(suiteCase.expectedSkillIds)) {
    const skill = effectiveById.get(skillId);
    if (!skill) continue;
    if (containsEvalPhrase(suiteCase.prompt, skill.name)) displayName = true;
    if (skill.aliases.some((entry) => containsEvalPhrase(suiteCase.prompt as string, entry))) alias = true;
    if (copiesEvalDescription(suiteCase.prompt, skill.description)) description = true;
  }
  return [
    ...(displayName ? ['EXPECTED_DISPLAY_NAME_LEAKAGE'] : []),
    ...(alias ? ['EXPECTED_ALIAS_LEAKAGE'] : []),
    ...(description ? ['EXPECTED_DESCRIPTION_LEAKAGE'] : [])
  ];
}

function containsEvalPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalizeEvalPrompt(text)} `;
  const normalizedPhrase = normalizeEvalPrompt(phrase);
  return normalizedPhrase.length > 0 && normalizedText.includes(` ${normalizedPhrase} `);
}

function copiesEvalDescription(prompt: string, description: string): boolean {
  const promptTokens = normalizeEvalPrompt(prompt).split(' ').filter(Boolean);
  const descriptionTokens = normalizeEvalPrompt(description).split(' ').filter(Boolean);
  if (descriptionTokens.length === 0) return false;
  if (descriptionTokens.length < 4) return containsEvalPhrase(promptTokens.join(' '), descriptionTokens.join(' '));
  const windowSize = Math.min(8, descriptionTokens.length);
  const promptText = ` ${promptTokens.join(' ')} `;
  for (let index = 0; index <= descriptionTokens.length - windowSize; index += 1) {
    const window = descriptionTokens.slice(index, index + windowSize).join(' ');
    if (promptText.includes(` ${window} `)) return true;
  }
  return false;
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  const actual = stringArray(value);
  return Array.isArray(value) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactObjectKeys(value: Record<string, unknown>, required: string[], path: string, issues: ContractIssue[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (!sameStringArray(actual, expected)) {
    issue(issues, path, 'additionalProperties', `must contain exactly: ${expected.join(', ')}`);
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numbersEqual(left: number, right: number): boolean {
  return Object.is(left, right) || Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}

function validateSync(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const payload = recordValue(value.payload);
  if (payload && payload.type !== value.payloadType) issue(issues, '/payload/type', 'payloadType', 'must equal payloadType');
  if (value.direction === 'cloud-to-local' && value.payloadType !== 'policy-proposal') {
    issue(issues, '/payloadType', 'syncDirection', 'cloud-to-local sync is limited to signed policy-proposal payloads');
  }
}

function validateApiEnvelope(value: Record<string, unknown>, issues: ContractIssue[]): void {
  const error = recordValue(value.error);
  if (!error) return;
  if (error.code === 'REVISION_CONFLICT' && error.details !== undefined && !recordValue(error.details)) {
    issue(issues, '/error/details', 'revisionConflict', 'must be a structured details object when provided');
  }
}

function validateRevisionSequence(revisionId: unknown, sequence: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof revisionId !== 'string' || typeof sequence !== 'number') return;
  const match = /^r([0-9]{20})-/.exec(revisionId);
  if (match && Number(match[1]) !== sequence) issue(issues, path, 'revisionSequence', 'must equal the sequence encoded in revisionId');
}

function inspectRedactedValue(value: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof value === 'string') {
    if (containsAbsolutePath(value)) issue(issues, path, 'privacy', 'contains an absolute local path');
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) issue(issues, path, 'privacy', 'contains a secret or privacy canary');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectRedactedValue(item, `${path}/${index}`, issues));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_REDACTED_KEYS.has(key.toLowerCase())) issue(issues, `${path}/${key}`, 'privacy', `contains forbidden redacted field ${key}`);
    inspectRedactedValue(nested, `${path}/${key}`, issues);
  }
}

function verifyReceiptDigest(value: Record<string, unknown>, field: string, issues: ContractIssue[]): void {
  const declared = value[field];
  if (typeof declared !== 'string' || !DIGEST_PATTERN.test(declared)) return;
  const projection = Object.create(null) as Record<string, unknown>;
  for (const [key, nested] of Object.entries(value)) if (key !== field) projection[key] = nested;
  const computed = sha256(canonicalJson(projection));
  if (declared !== computed) issue(issues, `/${field}`, field, `must match canonical receipt bytes; computed ${computed}`);
}

function sortedUniqueRecords(raw: unknown, field: string, path: string, issues: ContractIssue[]): void {
  const records = arrayRecords(raw);
  const values = records.map((record) => record[field]).filter((value): value is string => typeof value === 'string');
  if (new Set(values).size !== values.length) issue(issues, path, 'unique', `${field} values must be unique`);
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) issue(issues, path, 'sorted', `must be lexicographically sorted by ${field}`);
}

function uniqueRecordField(raw: unknown, field: string, path: string, issues: ContractIssue[], ignoreMissing = false): void {
  const values = arrayRecords(raw).map((record) => record[field]);
  const compared = ignoreMissing ? values.filter((value) => value !== undefined) : values;
  if (new Set(compared).size !== compared.length) issue(issues, path, 'unique', `${field} values must be unique`);
}

function disjointArrays(left: unknown, right: unknown, path: string, issues: ContractIssue[]): void {
  if (!Array.isArray(left) || !Array.isArray(right)) return;
  const overlap = left.filter((item) => right.includes(item));
  if (overlap.length > 0) issue(issues, path, 'disjoint', 'expected and avoid sets must be disjoint');
}

function timestampOrder(before: unknown, after: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof before !== 'string' || typeof after !== 'string') return;
  if (!isRealUtcTimestamp(before) || !isRealUtcTimestamp(after)) {
    issue(issues, path, 'timestampOrder', 'timestamps must be real UTC dates');
    return;
  }
  const beforeMillis = Date.parse(before);
  const afterMillis = Date.parse(after);
  if (afterMillis < beforeMillis) issue(issues, path, 'timestampOrder', 'must not precede the prior timestamp');
}

function isRealUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

function canonicalValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Canonical JSON does not support cyclic arrays.');
    seen.add(value);
    const result = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) throw new Error('Canonical JSON contains a non-JSON value.');
  if (seen.has(value)) throw new Error('Canonical JSON does not support cyclic objects.');
  seen.add(value);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested === undefined || typeof nested === 'function' || typeof nested === 'symbol' || typeof nested === 'bigint') {
      throw new Error(`Canonical JSON contains an unsupported value at ${key}.`);
    }
    result[key] = canonicalValue(nested, seen);
  }
  seen.delete(value);
  return result;
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function containsAbsolutePath(value: string): boolean {
  return /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value)
    || /\bfile:\/\//i.test(value);
}

function issue(issues: ContractIssue[], path: string, keyword: string, message: string): void {
  issues.push({ path, schemaPath: '#/semantic', keyword, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a plain object.`);
  return value;
}

export function revisionRefsEqual(left: RevisionRef, right: RevisionRef): boolean {
  return left.workspaceId === right.workspaceId
    && left.revisionId === right.revisionId
    && left.workspaceRevision === right.workspaceRevision
    && left.effectiveDigest === right.effectiveDigest
    && left.effectiveRevisionDigest === right.effectiveRevisionDigest;
}
