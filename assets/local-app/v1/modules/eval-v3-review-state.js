export const EVAL_V3_REVIEW_PAGE_SIZE = 8;
export const EVAL_V3_CASE_TYPES = Object.freeze(['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss']);
export const EVAL_V3_MEMBERSHIPS = Object.freeze(['train', 'holdout']);
export const EVAL_V3_SOURCE_CLASSES = Object.freeze(['operator-authored', 'observed-redacted', 'imported', 'synthetic']);

const MAX_FILE_BYTES = 500 * 1024;
const MAX_PROMPT_BYTES = 32768;
const MAX_SKILL_IDS = 100;
const SKILL_ID = /^sk_[A-Za-z0-9_-]{43}$/;
const SUITE_ID = /^evalsuite_[A-Za-z0-9_-]{8,80}$/;
const CASE_ID = /^evalcase_[A-Za-z0-9_-]{8,100}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PAYLOAD_EXCLUDED_KEYS = new Set(['payloadDigest', 'transportDigest', 'transportMetadata']);
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

export function parseEvalSuiteV3(text) {
  if (typeof text !== 'string' || utf8Length(text) > MAX_FILE_BYTES) throw new Error('The suite exceeds the 500 KiB eval-suite/v3 browser review limit. Use the local CLI for a larger reviewed suite.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
  if (!isRecord(value) || value.kind !== 'skillmap.eval-suite' || value.schemaVersion !== 3 || !Array.isArray(value.cases)) {
    throw new Error('Select a SkillMap eval-suite/v3 JSON object with a cases array.');
  }
  exactKeys(value, ['kind', 'schemaVersion', 'suiteId', 'name', 'createdAt', 'updatedAt', 'datasetDigest', 'provenance', 'baseline', 'cases', 'redactionClassification', 'payloadDigest'], 'eval-suite/v3');
  const provenance = cloneRecord(value.provenance, 'dataset provenance');
  const baseline = cloneRecord(value.baseline, 'baseline');
  const baselineProvenance = cloneRecord(baseline.provenance, 'baseline provenance');
  exactKeys(provenance, ['labelAuthor', 'reviewedBy', 'sourceClass', 'createdAt', 'holdoutFrozenAt', 'reviewedAt', 'deduplicationResult', 'holdoutFrozen', 'frozenCaseSetDigest'], 'dataset provenance');
  exactKeys(baseline, ['top1Rate', 'top3Rate', 'avoidHits', 'abstentionRate', 'meanAdvisoryBytes', 'provenance'], 'baseline');
  exactKeys(baselineProvenance, ['sourceKind', 'completedAt', 'caseSetDigest', 'sourceRevision'], 'baseline provenance');
  if (baselineProvenance.sourceRevision !== null) {
    const sourceRevision = cloneRecord(baselineProvenance.sourceRevision, 'baseline source revision');
    exactKeys(sourceRevision, ['workspaceId', 'revisionId', 'workspaceRevision', 'effectiveDigest', 'effectiveRevisionDigest'], 'baseline source revision');
  }
  const cases = value.cases.map((item, index) => parseV3Case(item, index));
  return {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: scalar(value.suiteId),
    name: scalar(value.name),
    createdAt: scalar(value.createdAt),
    updatedAt: scalar(value.updatedAt),
    datasetDigest: scalar(value.datasetDigest),
    provenance: {
      labelAuthor: scalar(provenance.labelAuthor),
      reviewedBy: scalar(provenance.reviewedBy),
      sourceClass: scalar(provenance.sourceClass),
      createdAt: scalar(provenance.createdAt),
      holdoutFrozenAt: scalar(provenance.holdoutFrozenAt),
      reviewedAt: scalar(provenance.reviewedAt),
      deduplicationResult: provenance.deduplicationResult,
      holdoutFrozen: provenance.holdoutFrozen,
      frozenCaseSetDigest: scalar(provenance.frozenCaseSetDigest)
    },
    baseline: {
      top1Rate: baseline.top1Rate,
      top3Rate: baseline.top3Rate,
      avoidHits: baseline.avoidHits,
      abstentionRate: baseline.abstentionRate,
      meanAdvisoryBytes: baseline.meanAdvisoryBytes,
      provenance: {
        sourceKind: baselineProvenance.sourceKind,
        completedAt: scalar(baselineProvenance.completedAt),
        caseSetDigest: scalar(baselineProvenance.caseSetDigest),
        sourceRevision: baselineProvenance.sourceRevision === null ? null : cloneRecord(baselineProvenance.sourceRevision, 'baseline source revision')
      }
    },
    cases,
    redactionClassification: value.redactionClassification,
    payloadDigest: scalar(value.payloadDigest)
  };
}

export function createEvalV3ReviewState(suite, options = {}) {
  if (!isRecord(suite) || suite.kind !== 'skillmap.eval-suite' || suite.schemaVersion !== 3 || !Array.isArray(suite.cases)) throw new Error('A parsed eval-suite/v3 document is required.');
  return {
    suite,
    page: 0,
    pageSize: boundedInteger(options.pageSize, 1, 25, EVAL_V3_REVIEW_PAGE_SIZE),
    digestVersion: 0
  };
}

export function evalV3ReviewPage(state) {
  const pageCount = Math.max(1, Math.ceil(state.suite.cases.length / state.pageSize));
  state.page = Math.min(Math.max(0, state.page), pageCount - 1);
  const start = state.page * state.pageSize;
  return { items: state.suite.cases.slice(start, start + state.pageSize), start, page: state.page, pageCount, total: state.suite.cases.length };
}

export function setEvalV3ReviewPage(state, page) {
  state.page = boundedInteger(page, 0, Math.max(0, Math.ceil(state.suite.cases.length / state.pageSize) - 1), 0);
  return evalV3ReviewPage(state);
}

export function touchEvalV3ReviewState(state, timestamp = new Date().toISOString()) {
  if (!state?.suite) return;
  state.suite.updatedAt = timestamp;
  state.digestVersion += 1;
}

export function updateEvalV3SuiteField(state, path, value, revisions = []) {
  const suite = state.suite;
  if (path === 'suiteId' || path === 'name' || path === 'createdAt') suite[path] = String(value ?? '');
  else if (path.startsWith('provenance.')) suite.provenance[path.slice('provenance.'.length)] = value;
  else if (path.startsWith('baseline.') && !path.startsWith('baseline.provenance.')) suite.baseline[path.slice('baseline.'.length)] = numericInput(value);
  else if (path === 'baseline.provenance.completedAt') suite.baseline.provenance.completedAt = String(value ?? '');
  else if (path === 'baseline.provenance.sourceRevision') {
    const match = revisions.find((item) => item?.revision?.revisionId === value);
    suite.baseline.provenance.sourceKind = match ? 'approved-effective-revision' : 'operator-declared-no-skillmap';
    suite.baseline.provenance.sourceRevision = match ? cloneJson(match.revision) : null;
  } else throw new Error(`Unsupported eval-suite/v3 editor field ${path}.`);
  touchEvalV3ReviewState(state);
}

export function updateEvalV3Case(state, index, field, value) {
  const item = state.suite.cases[index];
  if (!item) throw new Error('The selected eval case is outside the current suite.');
  if (['caseId', 'prompt', 'primaryCaseType', 'membership'].includes(field)) item[field] = String(value ?? '');
  else if (field === 'expectedSkillIds' || field === 'avoidSkillIds') item[field] = parseSkillIdInput(value);
  else if (field === 'qualifiedSkillId') {
    const normalized = String(value ?? '').trim();
    if (normalized) item.qualifiedSkillId = normalized;
    else delete item.qualifiedSkillId;
  } else if (field.startsWith('labelProvenance.')) item.labelProvenance[field.slice('labelProvenance.'.length)] = String(value ?? '');
  else throw new Error(`Unsupported eval case editor field ${field}.`);
  if (field === 'primaryCaseType' && item.primaryCaseType !== 'explicit') delete item.qualifiedSkillId;
  touchEvalV3ReviewState(state);
}

export function parseSkillIdInput(value) {
  return [...new Set(String(value ?? '').split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

export function skillIdsToInput(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

export function legacyV2MigrationPreview(suite, skills) {
  const byName = new Map();
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill || typeof skill.displayName !== 'string' || !SKILL_ID.test(String(skill.skillId))) continue;
    const entries = byName.get(skill.displayName) || [];
    entries.push(skill);
    byName.set(skill.displayName, entries);
  }
  const labels = [...new Set((suite?.evals || []).flatMap((item) => [...(item.expected || []), ...(item.avoid || [])]))].sort();
  const mappings = labels.map((name) => {
    const matches = byName.get(name) || [];
    return {
      name,
      status: matches.length === 1 ? 'mapped' : matches.length > 1 ? 'ambiguous' : 'missing',
      skillId: matches.length === 1 ? matches[0].skillId : null,
      matches
    };
  });
  return { mappings, canConvert: mappings.every((item) => item.status === 'mapped'), unresolved: mappings.filter((item) => item.status !== 'mapped') };
}

export function migrateEvalSuiteV2ToV3(suite, skills, options = {}) {
  const preview = legacyV2MigrationPreview(suite, skills);
  if (!preview.canConvert) throw new Error('Every legacy display-name label must map to exactly one current qualified skill ID before creating a v3 draft.');
  const byName = new Map(preview.mappings.map((item) => [item.name, item.skillId]));
  const now = options.now || new Date().toISOString();
  const createdAt = isRealUtcTimestamp(suite?.provenance?.createdAt) ? suite.provenance.createdAt : now;
  const reviewedAt = isRealUtcTimestamp(suite?.provenance?.reviewedAt) && Date.parse(suite.provenance.reviewedAt) >= Date.parse(createdAt) ? suite.provenance.reviewedAt : now;
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : randomToken;
  const author = String(suite?.provenance?.labelAuthor || '').trim();
  const sourceClass = EVAL_V3_SOURCE_CLASSES.includes(suite?.provenance?.sourceClass) ? suite.provenance.sourceClass : 'imported';
  return {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: `evalsuite_${idFactory(18)}`,
    name: 'Migrated reviewed eval suite',
    createdAt,
    updatedAt: reviewedAt,
    datasetDigest: ZERO_DIGEST,
    provenance: {
      labelAuthor: author,
      reviewedBy: '',
      sourceClass,
      createdAt,
      holdoutFrozenAt: reviewedAt,
      reviewedAt,
      deduplicationResult: 'passed',
      holdoutFrozen: true,
      frozenCaseSetDigest: ZERO_DIGEST
    },
    baseline: {
      top1Rate: finiteOrZero(suite?.baseline?.top1Rate),
      top3Rate: finiteOrZero(suite?.baseline?.top3Rate),
      avoidHits: Number.isInteger(suite?.baseline?.avoidHits) ? suite.baseline.avoidHits : 0,
      abstentionRate: finiteOrZero(suite?.baseline?.abstentionRate),
      meanAdvisoryBytes: finiteOrZero(suite?.baseline?.meanAdvisoryBytes),
      provenance: {
        sourceKind: 'operator-declared-no-skillmap',
        completedAt: reviewedAt,
        caseSetDigest: ZERO_DIGEST,
        sourceRevision: null
      }
    },
    cases: suite.evals.map((item) => ({
      caseId: `evalcase_${idFactory(20)}`,
      prompt: item.prompt,
      expectedSkillIds: item.expected.map((name) => byName.get(name)),
      avoidSkillIds: (item.avoid || []).map((name) => byName.get(name)),
      primaryCaseType: item.primaryCaseType,
      membership: item.membership,
      labelProvenance: { author, sourceClass, createdAt, reviewedAt }
    })),
    redactionClassification: 'local-sensitive',
    payloadDigest: ZERO_DIGEST
  };
}

export function summarizeEvalV3Review(state, catalogs = {}) {
  const suite = state.suite;
  const skills = Array.isArray(catalogs.skills) ? catalogs.skills : [];
  const revisions = Array.isArray(catalogs.revisions) ? catalogs.revisions : [];
  const skillCatalogAvailable = catalogs.skillCatalogAvailable === true
    || (catalogs.skillCatalogAvailable === undefined && Array.isArray(catalogs.skills));
  const skillById = new Map(skills.filter((item) => SKILL_ID.test(String(item?.skillId))).map((item) => [item.skillId, item]));
  const blocking = [];
  const warnings = [];
  const counts = { total: suite.cases.length, explicit: 0, 'implicit-natural': 0, 'multi-skill': 0, 'negative-near-miss': 0, train: 0, holdout: 0 };
  const promptKeys = new Map();

  if (!SUITE_ID.test(suite.suiteId)) blocking.push('Suite ID must use evalsuite_ followed by 8 to 80 URL-safe characters.');
  if (!boundedLabel(suite.name)) blocking.push('Suite name must contain 1 to 200 printable characters.');
  if (suite.redactionClassification !== 'local-sensitive') blocking.push('eval-suite/v3 redactionClassification must be local-sensitive.');
  if (!isRealUtcTimestamp(suite.createdAt)) blocking.push('Suite createdAt must be a real UTC timestamp.');
  if (!isRealUtcTimestamp(suite.updatedAt)) blocking.push('Suite updatedAt must be a real UTC timestamp.');
  if (isRealUtcTimestamp(suite.createdAt) && isRealUtcTimestamp(suite.updatedAt) && Date.parse(suite.updatedAt) < Date.parse(suite.createdAt)) blocking.push('Suite updatedAt cannot precede createdAt.');
  validateDatasetProvenance(suite, blocking);
  validateBaseline(suite, revisions, catalogs.currentRevisionId, blocking, warnings);
  if (suite.cases.length < 1) blocking.push('A v3 suite requires at least one case.');
  if (!skillCatalogAvailable) blocking.push('The approved skill catalog is unavailable; qualified IDs cannot be verified for import.');

  suite.cases.forEach((item, index) => {
    const label = `Case ${index + 1}`;
    if (!CASE_ID.test(item.caseId)) blocking.push(`${label} needs a valid evalcase_ ID.`);
    if (EVAL_V3_CASE_TYPES.includes(item.primaryCaseType)) counts[item.primaryCaseType] += 1;
    else blocking.push(`${label} needs one valid primary case type.`);
    if (EVAL_V3_MEMBERSHIPS.includes(item.membership)) counts[item.membership] += 1;
    else blocking.push(`${label} needs train or holdout membership.`);
    if (typeof item.prompt !== 'string' || item.prompt.includes('\0') || utf8Length(item.prompt) > MAX_PROMPT_BYTES || (!item.prompt.trim() && !item.qualifiedSkillId)) blocking.push(`${label} prompt must satisfy the 32 KiB runtime boundary; only an explicit qualified case may use an empty prompt.`);
    const expected = Array.isArray(item.expectedSkillIds) ? item.expectedSkillIds : [];
    const avoid = Array.isArray(item.avoidSkillIds) ? item.avoidSkillIds : [];
    validateSkillIdList(expected, `${label} expected`, blocking);
    validateSkillIdList(avoid, `${label} avoid`, blocking);
    if (expected.some((skillId) => avoid.includes(skillId))) blocking.push(`${label} has a qualified ID in both expected and avoid sets.`);
    if (['explicit', 'implicit-natural'].includes(item.primaryCaseType) && expected.length < 1) blocking.push(`${label} requires at least one expected qualified skill ID.`);
    if (item.primaryCaseType === 'multi-skill' && (expected.length < 2 || expected.length > 3)) blocking.push(`${label} requires two or three expected qualified skill IDs.`);
    if (item.primaryCaseType === 'negative-near-miss' && avoid.length < 1) blocking.push(`${label} requires at least one avoid qualified skill ID.`);
    if (item.qualifiedSkillId && (item.primaryCaseType !== 'explicit' || !expected.includes(item.qualifiedSkillId))) blocking.push(`${label} qualifiedSkillId is allowed only for an explicit case and must also be expected.`);
    for (const skillId of [...expected, ...avoid]) {
      if (skillCatalogAvailable && !skillById.has(skillId)) blocking.push(`${label} references ${skillId}, which is absent from the loaded approved skill catalog.`);
    }
    for (const skillId of expected) {
      const skill = skillById.get(skillId);
      if (!skill) continue;
      if (skillId === item.qualifiedSkillId) {
        if (skill.qualifiedExplicitAllowed !== true) blocking.push(`${label} explicitly qualifies ${skillId}, but policy blocks qualified routing.`);
      } else if (skill.routeEligible !== true || skill.qualifiedExplicitAllowed !== true) blocking.push(`${label} expects ${skillId}, but it is not approved for deterministic routing.`);
      if (['implicit-natural', 'multi-skill'].includes(item.primaryCaseType) && containsNormalizedPhrase(item.prompt, skill.displayName)) {
        blocking.push(`${label} prompt names expected display label ${skill.displayName}; remove label leakage before freezing the suite.`);
      }
      if (['implicit-natural', 'multi-skill'].includes(item.primaryCaseType)
        && Array.isArray(skill.aliases)
        && skill.aliases.some((alias) => containsNormalizedPhrase(item.prompt, alias))) {
        blocking.push(`${label} prompt contains an expected skill alias; remove label leakage before freezing the suite.`);
      }
      if (['implicit-natural', 'multi-skill'].includes(item.primaryCaseType) && copiesNormalizedDescription(item.prompt, skill.description)) {
        blocking.push(`${label} prompt copies the expected skill description; rewrite it before freezing the suite.`);
      }
    }
    validateCaseProvenance(item, suite.provenance.holdoutFrozenAt, label, blocking);
    const normalized = normalizePrompt(item.prompt);
    const key = normalized || (item.qualifiedSkillId ? `qualified:${item.qualifiedSkillId}` : '');
    if (key) {
      if (promptKeys.has(key)) blocking.push(`${label} duplicates the normalized prompt from case ${promptKeys.get(key) + 1}.`);
      else promptKeys.set(key, index);
    }
  });
  const caseIds = suite.cases.map((item) => item.caseId);
  if (new Set(caseIds).size !== caseIds.length) blocking.push('Case IDs must be unique.');

  const releaseCounted = counts['implicit-natural'] + counts['multi-skill'] + counts['negative-near-miss'];
  const releaseHoldout = suite.cases.filter((item) => item.membership === 'holdout' && item.primaryCaseType !== 'explicit').length;
  const requiredHoldout = Math.max(30, Math.ceil(releaseCounted * 0.2));
  const quotas = {
    releaseCounted: { value: releaseCounted, required: 150, met: releaseCounted >= 150 },
    implicitNatural: { value: counts['implicit-natural'], required: 100, met: counts['implicit-natural'] >= 100 },
    multiSkill: { value: counts['multi-skill'], required: 25, met: counts['multi-skill'] >= 25 },
    negativeNearMiss: { value: counts['negative-near-miss'], required: 25, met: counts['negative-near-miss'] >= 25 },
    holdout: { value: releaseHoldout, required: requiredHoldout, met: releaseHoldout >= requiredHoldout }
  };
  if (!Object.values(quotas).every((quota) => quota.met)) warnings.push('The reviewed v3 contract is importable only after structural errors are fixed, but this composition does not satisfy every release evidence quota.');
  if (skillCatalogAvailable && !skills.length) warnings.push('The approved skill catalog is empty; every referenced qualified ID remains blocked.');
  if (!revisions.length) warnings.push('Revision history was unavailable; the historical baseline cannot be independently selected in this browser session.');
  return {
    counts,
    quotas,
    releaseCounted,
    releaseHoldout,
    requiredHoldout,
    blocking,
    warnings,
    canImport: blocking.length === 0,
    releaseCompositionMet: Object.values(quotas).every((quota) => quota.met)
  };
}

export async function finalizeEvalSuiteV3Snapshot(suite) {
  const finalizedSuite = JSON.parse(canonicalJson(suite));
  const caseSetDigest = await sha256Digest(canonicalJson({
    schemaVersion: finalizedSuite.schemaVersion,
    cases: finalizedSuite.cases.map((item) => ({
      caseId: item.caseId,
      prompt: item.prompt,
      expectedSkillIds: item.expectedSkillIds,
      avoidSkillIds: item.avoidSkillIds,
      qualifiedSkillId: item.qualifiedSkillId ?? null,
      primaryCaseType: item.primaryCaseType,
      membership: item.membership
    }))
  }));
  finalizedSuite.provenance.frozenCaseSetDigest = caseSetDigest;
  finalizedSuite.baseline.provenance.caseSetDigest = caseSetDigest;
  finalizedSuite.datasetDigest = await sha256Digest(canonicalJson({
    schemaVersion: finalizedSuite.schemaVersion,
    suiteId: finalizedSuite.suiteId,
    name: finalizedSuite.name,
    provenance: finalizedSuite.provenance,
    baseline: finalizedSuite.baseline,
    cases: finalizedSuite.cases
  }));
  finalizedSuite.payloadDigest = await sha256Digest(canonicalPayloadJson(finalizedSuite));
  return { suite: finalizedSuite, caseSetDigest, datasetDigest: finalizedSuite.datasetDigest, payloadDigest: finalizedSuite.payloadDigest };
}

export async function refreshEvalSuiteV3Digests(suite, options = {}) {
  const finalized = await finalizeEvalSuiteV3Snapshot(suite);
  const canApply = typeof options.canApply === 'function' ? options.canApply : () => true;
  if (!canApply()) return { ...finalized, applied: false };
  suite.provenance.frozenCaseSetDigest = finalized.caseSetDigest;
  suite.baseline.provenance.caseSetDigest = finalized.caseSetDigest;
  suite.datasetDigest = finalized.datasetDigest;
  suite.payloadDigest = finalized.payloadDigest;
  return { ...finalized, applied: true };
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, new Set()));
}

export function canonicalPayloadJson(value) {
  if (!isRecord(value)) throw new Error('Canonical payload must be a plain JSON object.');
  const projection = Object.create(null);
  for (const [key, nested] of Object.entries(value)) if (!PAYLOAD_EXCLUDED_KEYS.has(key)) projection[key] = nested;
  return canonicalJson(projection);
}

export async function sha256Digest(value) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('This browser cannot compute SHA-256 digests. Use a current secure local browser or the CLI.');
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
  return `sha256:${[...digest].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

export function disposeEvalV3ReviewState(state) {
  if (!state?.suite) return;
  for (const item of state.suite.cases || []) {
    item.prompt = '';
    item.expectedSkillIds = [];
    item.avoidSkillIds = [];
    delete item.qualifiedSkillId;
    if (item.labelProvenance) {
      item.labelProvenance.author = '';
      item.labelProvenance.createdAt = '';
      item.labelProvenance.reviewedAt = '';
    }
  }
  state.suite.cases = [];
  state.suite.provenance = null;
  state.suite.baseline = null;
  state.suite = null;
  state.page = 0;
}

function parseV3Case(value, index) {
  if (!isRecord(value)) throw new Error(`Eval case ${index + 1} must be an object.`);
  exactKeys(value, ['caseId', 'prompt', 'expectedSkillIds', 'avoidSkillIds', 'qualifiedSkillId', 'primaryCaseType', 'membership', 'labelProvenance'], `eval case ${index + 1}`);
  if (!Array.isArray(value.expectedSkillIds) || !Array.isArray(value.avoidSkillIds)) throw new Error(`Eval case ${index + 1} qualified label sets must be arrays.`);
  const labelProvenance = cloneRecord(value.labelProvenance, `eval case ${index + 1} label provenance`);
  exactKeys(labelProvenance, ['author', 'sourceClass', 'createdAt', 'reviewedAt'], `eval case ${index + 1} label provenance`);
  return {
    caseId: scalar(value.caseId),
    prompt: scalar(value.prompt),
    expectedSkillIds: value.expectedSkillIds.map(scalar),
    avoidSkillIds: value.avoidSkillIds.map(scalar),
    ...(value.qualifiedSkillId === undefined ? {} : { qualifiedSkillId: scalar(value.qualifiedSkillId) }),
    primaryCaseType: scalar(value.primaryCaseType),
    membership: scalar(value.membership),
    labelProvenance: {
      author: scalar(labelProvenance.author),
      sourceClass: scalar(labelProvenance.sourceClass),
      createdAt: scalar(labelProvenance.createdAt),
      reviewedAt: scalar(labelProvenance.reviewedAt)
    }
  };
}

function validateDatasetProvenance(suite, blocking) {
  const value = suite.provenance || {};
  for (const key of ['labelAuthor', 'reviewedBy']) if (!boundedText(value[key], 200)) blocking.push(`Dataset provenance ${key} must contain 1 to 200 characters.`);
  if (!EVAL_V3_SOURCE_CLASSES.includes(value.sourceClass)) blocking.push('Dataset provenance sourceClass is invalid.');
  if (value.sourceClass === 'synthetic') blocking.push('Synthetic dataset provenance is candidate-only and cannot be the reviewed release authority.');
  for (const key of ['createdAt', 'holdoutFrozenAt', 'reviewedAt']) if (!isRealUtcTimestamp(value[key])) blocking.push(`Dataset provenance ${key} must be a real UTC timestamp.`);
  if (value.deduplicationResult !== 'passed') blocking.push('Dataset deduplication must be reviewed and recorded as passed.');
  if (value.holdoutFrozen !== true) blocking.push('Dataset holdoutFrozen must be true.');
  orderedTimestamps([
    ['dataset createdAt', value.createdAt],
    ['holdoutFrozenAt', value.holdoutFrozenAt],
    ['baseline completedAt', suite.baseline?.provenance?.completedAt],
    ['dataset reviewedAt', value.reviewedAt],
    ['suite updatedAt', suite.updatedAt]
  ], blocking);
}

function validateBaseline(suite, revisions, currentRevisionId, blocking, warnings) {
  const value = suite.baseline || {};
  for (const key of ['top1Rate', 'top3Rate', 'abstentionRate']) if (!finiteRange(value[key], 0, 1)) blocking.push(`Baseline ${key} must be between 0 and 1.`);
  if (!Number.isInteger(value.avoidHits) || value.avoidHits < 0 || value.avoidHits > 1_000_000) blocking.push('Baseline avoidHits must be an integer from 0 to 1,000,000.');
  if (!finiteRange(value.meanAdvisoryBytes, 0, 1_048_576)) blocking.push('Baseline meanAdvisoryBytes must be between 0 and 1,048,576.');
  const provenance = value.provenance || {};
  if (!isRealUtcTimestamp(provenance.completedAt)) blocking.push('Baseline completedAt must be a real UTC timestamp.');
  if (provenance.sourceKind !== 'approved-effective-revision' || !isRecord(provenance.sourceRevision)) {
    blocking.push('Select a historical approved effective revision. An operator-declared no-SkillMap baseline remains candidate-only.');
    return;
  }
  const match = revisions.find((item) => item?.revision?.revisionId === provenance.sourceRevision.revisionId);
  if (!match || canonicalJson(match.revision) !== canonicalJson(provenance.sourceRevision)) blocking.push('Baseline RevisionRef must exactly match one verified immutable history entry loaded from this workspace.');
  else if (match.routingApprovalRecorded !== true) blocking.push('Baseline RevisionRef must have a durable historical routing-approval receipt.');
  if (provenance.sourceRevision.revisionId === currentRevisionId) blocking.push('Baseline source must be historical and cannot equal the current revision.');
  if (!DIGEST.test(String(provenance.sourceRevision.effectiveDigest)) || !DIGEST.test(String(provenance.sourceRevision.effectiveRevisionDigest))) blocking.push('Baseline RevisionRef must bind both exact and semantic effective digests.');
  warnings.push('Replay metrics are operator-entered here; eval execution must replay this frozen case set against the selected historical effective artifact before release eligibility can be granted.');
}

function validateCaseProvenance(item, holdoutFrozenAt, label, blocking) {
  const value = item.labelProvenance || {};
  if (!boundedText(value.author, 200)) blocking.push(`${label} label author must contain 1 to 200 characters.`);
  if (!EVAL_V3_SOURCE_CLASSES.includes(value.sourceClass)) blocking.push(`${label} label sourceClass is invalid.`);
  if (value.sourceClass === 'synthetic') blocking.push(`${label} uses synthetic label provenance and cannot enter the release-authoritative v3 workflow.`);
  if (!isRealUtcTimestamp(value.createdAt) || !isRealUtcTimestamp(value.reviewedAt)) blocking.push(`${label} label timestamps must be real UTC timestamps.`);
  orderedTimestamps([['label createdAt', value.createdAt], ['label reviewedAt', value.reviewedAt], ['holdoutFrozenAt', holdoutFrozenAt]], blocking, label);
}

function validateSkillIdList(value, label, blocking) {
  if (!Array.isArray(value) || value.length > MAX_SKILL_IDS || value.some((item) => !SKILL_ID.test(String(item)))) blocking.push(`${label} labels must contain at most 100 valid qualified skill IDs.`);
  if (Array.isArray(value) && new Set(value).size !== value.length) blocking.push(`${label} labels must be unique.`);
}

function orderedTimestamps(entries, blocking, prefix = 'Timestamp order') {
  for (let index = 1; index < entries.length; index += 1) {
    const [priorLabel, prior] = entries[index - 1];
    const [label, value] = entries[index];
    if (isRealUtcTimestamp(prior) && isRealUtcTimestamp(value) && Date.parse(value) < Date.parse(prior)) blocking.push(`${prefix}: ${label} cannot precede ${priorLabel}.`);
  }
}

function canonicalValue(value, seen) {
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
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested === undefined || typeof nested === 'function' || typeof nested === 'symbol' || typeof nested === 'bigint') throw new Error(`Canonical JSON contains an unsupported value at ${key}.`);
    result[key] = canonicalValue(nested, seen);
  }
  seen.delete(value);
  return result;
}

function isRealUtcTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/.exec(String(value ?? ''));
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return [...bytes].map((item) => alphabet[item % alphabet.length]).join('');
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} contains unsupported field ${key}.`);
}

function cloneRecord(value, label) {
  if (!isRecord(value)) throw new Error(`Eval suite ${label} must be an object.`);
  return cloneJson(value);
}

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function scalar(value) { return typeof value === 'string' ? value : ''; }
function numericInput(value) { const number = Number(value); return Number.isFinite(number) ? number : Number.NaN; }
function finiteOrZero(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function finiteRange(value, minimum, maximum) { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }
function boundedText(value, maximum) { return typeof value === 'string' && value.trim().length > 0 && [...value].length <= maximum; }
function boundedLabel(value) { return boundedText(value, 200) && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value); }
function boundedInteger(value, minimum, maximum, fallback) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback; }
function utf8Length(value) { return new TextEncoder().encode(String(value ?? '')).length; }
function normalizePrompt(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function containsNormalizedPhrase(value, phrase) { const target = normalizePrompt(phrase); return target.length > 0 && ` ${normalizePrompt(value)} `.includes(` ${target} `); }
function copiesNormalizedDescription(prompt, description) {
  const promptTokens = normalizePrompt(prompt).split(' ').filter(Boolean);
  const descriptionTokens = normalizePrompt(description).split(' ').filter(Boolean);
  if (!descriptionTokens.length) return false;
  if (descriptionTokens.length < 4) return containsNormalizedPhrase(promptTokens.join(' '), descriptionTokens.join(' '));
  const windowSize = Math.min(8, descriptionTokens.length);
  const promptText = ` ${promptTokens.join(' ')} `;
  for (let index = 0; index <= descriptionTokens.length - windowSize; index += 1) {
    if (promptText.includes(` ${descriptionTokens.slice(index, index + windowSize).join(' ')} `)) return true;
  }
  return false;
}
