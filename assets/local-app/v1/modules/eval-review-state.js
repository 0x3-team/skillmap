export const EVAL_REVIEW_PAGE_SIZE = 10;
export const EVAL_CASE_TYPES = Object.freeze(['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss']);
export const EVAL_MEMBERSHIPS = Object.freeze(['train', 'holdout']);

const MAX_FILE_BYTES = 60 * 1024;
const MAX_PROMPT_BYTES = 32768;
const MAX_LABELS = 100;
const MAX_LABEL_LENGTH = 200;

export function parseEvalReviewSuite(text) {
  if (typeof text !== 'string' || utf8Length(text) > MAX_FILE_BYTES) throw new Error('The suite exceeds the 60 KiB browser review limit.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 2 || !Array.isArray(raw.evals)) {
    throw new Error('Select a SkillMap eval suite v2 JSON object with an evals array.');
  }
  exactKeys(raw, ['version', 'provenance', 'baseline', 'evals'], 'eval suite');
  const provenance = cloneObject(raw.provenance, 'provenance');
  const baseline = cloneObject(raw.baseline, 'baseline');
  validateProvenanceSchema(provenance);
  validateBaselineSchema(baseline);
  const suite = {
    version: 2,
    provenance,
    baseline,
    evals: raw.evals.map((item, index) => parseCase(item, index))
  };
  return suite;
}

export function createEvalReviewState(suite, options = {}) {
  if (!suite || suite.version !== 2 || !Array.isArray(suite.evals)) throw new Error('A parsed eval suite v2 is required.');
  const pageSize = boundedInteger(options.pageSize, 1, 50, EVAL_REVIEW_PAGE_SIZE);
  return { suite, page: 0, pageSize };
}

export function evalReviewPage(state) {
  const pageCount = Math.max(1, Math.ceil(state.suite.evals.length / state.pageSize));
  state.page = Math.min(Math.max(0, state.page), pageCount - 1);
  const start = state.page * state.pageSize;
  return { items: state.suite.evals.slice(start, start + state.pageSize), start, page: state.page, pageCount, total: state.suite.evals.length };
}

export function setEvalReviewPage(state, page) {
  state.page = boundedInteger(page, 0, Math.max(0, Math.ceil(state.suite.evals.length / state.pageSize) - 1), 0);
  return evalReviewPage(state);
}

export function updateEvalReviewCase(state, index, patch) {
  const item = state.suite.evals[index];
  if (!item) throw new Error('The selected eval case is outside the current suite.');
  if (patch.primaryCaseType !== undefined) item.primaryCaseType = String(patch.primaryCaseType);
  if (patch.membership !== undefined) item.membership = String(patch.membership);
  if (patch.expected !== undefined) item.expected = normalizeLabels(patch.expected);
  if (patch.avoid !== undefined) item.avoid = normalizeLabels(patch.avoid);
  if (state.suite.provenance && typeof state.suite.provenance === 'object') delete state.suite.provenance.datasetDigest;
  return item;
}

export function parseLabelInput(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

export function labelsToInput(labels) {
  return Array.isArray(labels) ? labels.join('\n') : '';
}

export function summarizeEvalReview(state) {
  const suite = state.suite;
  const counts = { total: suite.evals.length, explicit: 0, 'implicit-natural': 0, 'multi-skill': 0, 'negative-near-miss': 0, train: 0, holdout: 0 };
  const blocking = [];
  const warnings = [];
  const normalizedPrompts = new Map();
  let overlapCases = 0;
  let leakageCases = 0;
  let duplicatePromptCases = 0;

  if (suite.evals.length === 0) blocking.push('An eval suite v2 requires at least one case.');

  suite.evals.forEach((item, index) => {
    if (EVAL_CASE_TYPES.includes(item.primaryCaseType)) counts[item.primaryCaseType] += 1;
    else blocking.push(`Case ${index + 1} needs one valid primary case type.`);
    if (EVAL_MEMBERSHIPS.includes(item.membership)) counts[item.membership] += 1;
    else blocking.push(`Case ${index + 1} needs train or holdout membership.`);

    const expected = Array.isArray(item.expected) ? item.expected : [];
    const avoid = Array.isArray(item.avoid) ? item.avoid : [];
    const expectedSet = new Set(expected);
    const avoidSet = new Set(avoid);
    if (expectedSet.size !== expected.length || avoidSet.size !== avoid.length) blocking.push(`Case ${index + 1} contains duplicate labels.`);
    if (expected.length > MAX_LABELS || avoid.length > MAX_LABELS || [...expected, ...avoid].some(label => typeof label !== 'string' || !label.trim() || [...label].length > MAX_LABEL_LENGTH)) {
      blocking.push(`Case ${index + 1} has an empty, oversized, or over-count label set.`);
    }
    if (expected.some(label => avoidSet.has(label))) {
      overlapCases += 1;
      blocking.push(`Case ${index + 1} has a label in both expected and avoid sets.`);
    }
    if (['explicit', 'implicit-natural'].includes(item.primaryCaseType) && expected.length < 1) blocking.push(`Case ${index + 1} requires at least one expected label.`);
    if (item.primaryCaseType === 'multi-skill' && (expected.length < 2 || expected.length > 3)) blocking.push(`Case ${index + 1} requires two or three expected labels.`);
    if (item.primaryCaseType === 'negative-near-miss' && avoid.length < 1) blocking.push(`Case ${index + 1} requires at least one avoid label.`);

    const prompt = String(item.prompt || '');
    if (!prompt.trim() || utf8Length(prompt) > MAX_PROMPT_BYTES) blocking.push(`Case ${index + 1} has an empty or oversized prompt.`);
    const normalizedPrompt = normalizeText(prompt);
    if (normalizedPrompts.has(normalizedPrompt)) {
      duplicatePromptCases += 1;
    } else normalizedPrompts.set(normalizedPrompt, index);
    if (['implicit-natural', 'multi-skill'].includes(item.primaryCaseType) && expected.some(label => containsNormalized(prompt, label))) leakageCases += 1;
  });

  const releaseCounted = counts['implicit-natural'] + counts['multi-skill'] + counts['negative-near-miss'];
  const releaseHoldout = suite.evals.filter(item => item.membership === 'holdout' && item.primaryCaseType !== 'explicit').length;
  const requiredHoldout = Math.max(30, Math.ceil(releaseCounted * 0.2));
  const quotas = {
    releaseCounted: { value: releaseCounted, required: 150, met: releaseCounted >= 150 },
    implicitNatural: { value: counts['implicit-natural'], required: 100, met: counts['implicit-natural'] >= 100 },
    multiSkill: { value: counts['multi-skill'], required: 25, met: counts['multi-skill'] >= 25 },
    negativeNearMiss: { value: counts['negative-near-miss'], required: 25, met: counts['negative-near-miss'] >= 25 },
    holdout: { value: releaseHoldout, required: requiredHoldout, met: releaseHoldout >= requiredHoldout }
  };

  if (leakageCases) warnings.push(`${leakageCases} implicit or multi-skill case(s) name an expected label in the prompt.`);
  if (duplicatePromptCases) warnings.push(`${duplicatePromptCases} case(s) duplicate another prompt after normalization; deduplicate before creating the v3 authority draft.`);
  if (!quotas.releaseCounted.met) warnings.push(`Legacy migration composition is ${releaseCounted}; the v3 evidence floor later requires at least 150 disjoint typed cases.`);
  if (!quotas.implicitNatural.met || !quotas.multiSkill.met || !quotas.negativeNearMiss.met) warnings.push('One or more v3 migration-target case-type quotas are not met. This v2 file remains candidate-only regardless of its counts.');
  if (!quotas.holdout.met) warnings.push(`Legacy frozen holdout is ${releaseHoldout}; a migrated v3 suite would require at least ${requiredHoldout}.`);
  warnings.push(...provenanceWarnings(suite.provenance), ...baselineWarnings(suite.baseline));

  return {
    counts, quotas, releaseCounted, releaseHoldout, requiredHoldout, overlapCases, leakageCases, duplicatePromptCases,
    blocking, warnings, canImport: blocking.length === 0,
    credible: blocking.length === 0 && leakageCases === 0 && duplicatePromptCases === 0 && Object.values(quotas).every(quota => quota.met) && provenanceWarnings(suite.provenance).length === 0 && baselineWarnings(suite.baseline).length === 0
  };
}

export function disposeEvalReviewState(state) {
  if (!state?.suite) return;
  for (const item of state.suite.evals || []) {
    item.prompt = '';
    item.expected = [];
    item.avoid = [];
    if (item.id) item.id = '';
  }
  state.suite.evals = [];
  state.suite.provenance = null;
  state.suite.baseline = null;
  state.suite = null;
  state.page = 0;
}

function parseCase(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Eval case ${index + 1} must be an object.`);
  exactKeys(value, ['id', 'prompt', 'expected', 'avoid', 'primaryCaseType', 'membership'], `eval case ${index + 1}`);
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.trim() || [...value.id].length > 200)) throw new Error(`Eval case ${index + 1} id must be 1 to 200 characters.`);
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || utf8Length(value.prompt) > MAX_PROMPT_BYTES) throw new Error(`Eval case ${index + 1} prompt must be 1 to 32768 UTF-8 bytes.`);
  if (!Array.isArray(value.expected) || !value.expected.every(label => typeof label === 'string')) throw new Error(`Eval case ${index + 1} expected labels must be strings.`);
  if (value.avoid !== undefined && (!Array.isArray(value.avoid) || !value.avoid.every(label => typeof label === 'string'))) throw new Error(`Eval case ${index + 1} avoid labels must be strings.`);
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    prompt: value.prompt,
    expected: [...value.expected],
    avoid: Array.isArray(value.avoid) ? [...value.avoid] : [],
    primaryCaseType: typeof value.primaryCaseType === 'string' ? value.primaryCaseType : '',
    membership: typeof value.membership === 'string' ? value.membership : ''
  };
}

function provenanceWarnings(value) {
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Complete eval v2 provenance is missing.'];
  for (const key of ['labelAuthor', 'sourceClass', 'createdAt', 'reviewedAt']) if (typeof value[key] !== 'string' || !value[key].trim()) warnings.push(`Provenance ${key} is missing.`);
  if (!['passed', 'failed', 'not-run'].includes(value.deduplicationResult)) warnings.push('Provenance deduplicationResult is invalid.');
  if (value.deduplicationResult !== 'passed') warnings.push('Provenance does not record passed deduplication.');
  if (value.holdoutFrozen !== true) warnings.push('Provenance does not mark the holdout as frozen.');
  return warnings;
}

function baselineWarnings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['A complete baseline is missing.'];
  const warnings = [];
  for (const key of ['top1Rate', 'top3Rate', 'avoidHits', 'abstentionRate', 'meanAdvisoryBytes']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) warnings.push(`Baseline ${key} is missing or invalid.`);
  return warnings;
}

function normalizeLabels(value) {
  return Array.isArray(value) ? value.map(label => String(label).trim()).filter(Boolean) : parseLabelInput(value);
}

function containsNormalized(prompt, label) {
  const target = normalizeText(label);
  return target.length > 0 && normalizeText(prompt).includes(target);
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} contains unsupported field ${key}.`);
}

function cloneObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Eval suite ${label} must be an object.`);
  return JSON.parse(JSON.stringify(value));
}

function validateProvenanceSchema(value) {
  exactKeys(value, ['labelAuthor', 'sourceClass', 'createdAt', 'reviewedAt', 'deduplicationResult', 'holdoutFrozen', 'datasetDigest'], 'eval provenance');
  for (const key of ['labelAuthor', 'sourceClass']) if (typeof value[key] !== 'string' || !value[key].trim() || [...value[key]].length > 200) throw new Error(`Eval provenance ${key} must be 1 to 200 characters.`);
  for (const key of ['createdAt', 'reviewedAt']) if (typeof value[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value[key]) || !Number.isFinite(Date.parse(value[key]))) throw new Error(`Eval provenance ${key} must be an ISO timestamp.`);
  if (!['passed', 'failed', 'not-run'].includes(value.deduplicationResult)) throw new Error('Eval provenance deduplicationResult is invalid.');
  if (typeof value.holdoutFrozen !== 'boolean') throw new Error('Eval provenance holdoutFrozen must be boolean.');
  if (value.datasetDigest !== undefined && (typeof value.datasetDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.datasetDigest))) throw new Error('Eval provenance datasetDigest must be a SHA-256 digest.');
}

function validateBaselineSchema(value) {
  exactKeys(value, ['top1Rate', 'top3Rate', 'avoidHits', 'abstentionRate', 'meanAdvisoryBytes'], 'eval baseline');
  for (const key of ['top1Rate', 'top3Rate', 'abstentionRate']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) throw new Error(`Eval baseline ${key} must be between 0 and 1.`);
  if (!Number.isInteger(value.avoidHits) || value.avoidHits < 0 || value.avoidHits > 1000000) throw new Error('Eval baseline avoidHits must be an integer from 0 to 1000000.');
  if (typeof value.meanAdvisoryBytes !== 'number' || !Number.isFinite(value.meanAdvisoryBytes) || value.meanAdvisoryBytes < 0 || value.meanAdvisoryBytes > 1048576) throw new Error('Eval baseline meanAdvisoryBytes must be between 0 and 1048576.');
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}
