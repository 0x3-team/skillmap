import { createHash } from "node:crypto";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OMITTED_TOP_LEVEL_KEYS = new Set([
  "payloadDigest",
  "transportDigest",
  "transportMetadata"
]);

const V2_REQUIRED_TOP_LEVEL_KEYS = new Set([
  "version",
  "kind",
  "schemaVersion",
  "workspaceId",
  "workspaceRevision",
  "workspaceName",
  "generatedAt",
  "producer",
  "compatibility",
  "inputDigests",
  "payloadDigest",
  "redactionClassification",
  "redacted",
  "mode",
  "source",
  "status",
  "tokenMetrics",
  "productivity",
  "connector",
  "skills",
  "recentRouteTraces",
  "policyReviews",
  "sources"
]);

const V2_OPTIONAL_TOP_LEVEL_KEYS = new Set(["curationReceipt"]);
const V2_KNOWN_TOP_LEVEL_KEYS = new Set([
  ...V2_REQUIRED_TOP_LEVEL_KEYS,
  ...V2_OPTIONAL_TOP_LEVEL_KEYS
]);

/**
 * Produce deterministic JSON for the semantic snapshot payload. Object keys
 * are sorted recursively, array order is preserved, and only the exact
 * top-level digest/transport fields are excluded.
 */
export function canonicalPayloadJson(snapshot) {
  if (!isPlainObject(snapshot)) {
    throw new Error("Snapshot payload must be a plain object.");
  }

  const projection = Object.create(null);
  for (const [key, value] of Object.entries(snapshot)) {
    if (!OMITTED_TOP_LEVEL_KEYS.has(key)) projection[key] = value;
  }
  return JSON.stringify(canonicalValue(projection));
}

export function computePayloadDigest(snapshot) {
  return sha256(canonicalPayloadJson(snapshot));
}

export function computeTransportDigest(raw) {
  return sha256(raw);
}

export function verifyPayloadDigest(snapshot) {
  const actual = isPlainObject(snapshot) && typeof snapshot.payloadDigest === "string"
    ? snapshot.payloadDigest
    : undefined;
  let expected;
  try {
    expected = computePayloadDigest(snapshot);
  } catch (error) {
    return {
      ok: false,
      actual,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (!actual || !DIGEST_PATTERN.test(actual)) {
    return { ok: false, actual, expected, error: "payloadDigest must be a lowercase sha256 digest." };
  }
  if (actual !== expected) {
    return { ok: false, actual, expected, error: "payloadDigest does not match canonical payload bytes." };
  }
  return { ok: true, actual, expected };
}

/**
 * Validate the trusted v2 wire envelope. This is deliberately strict at the
 * top level so a producer and consumer cannot silently disagree about which
 * fields are protected by payloadDigest.
 */
export function validateDashboardSnapshotV2(snapshot) {
  const issues = [];
  if (!isPlainObject(snapshot)) return { ok: false, issues: ["Snapshot root must be a plain object."] };

  for (const key of Object.keys(snapshot)) {
    if (!V2_KNOWN_TOP_LEVEL_KEYS.has(key)) issues.push(`Unknown v2 top-level field: ${key}.`);
  }
  for (const key of V2_REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in snapshot)) issues.push(`Missing required v2 top-level field: ${key}.`);
  }

  if (snapshot.version !== 2) issues.push("Snapshot version must be 2.");
  if (snapshot.kind !== "skillmap.dashboard-snapshot") issues.push("Snapshot kind must be skillmap.dashboard-snapshot.");
  if (snapshot.schemaVersion !== 2) issues.push("Snapshot schemaVersion must be 2.");
  if (typeof snapshot.workspaceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.workspaceId)) issues.push("workspaceId must be an opaque UUID.");
  if (!isSha256Digest(snapshot.workspaceRevision)) issues.push("workspaceRevision must be a sha256 digest.");
  if (!boundedString(snapshot.workspaceName, 1, 200)) issues.push("workspaceName must be a non-empty bounded string.");
  if (!isIsoTimestamp(snapshot.generatedAt)) issues.push("generatedAt must be an ISO timestamp.");
  if (snapshot.redactionClassification !== "shareable-redacted") {
    issues.push("redactionClassification must be shareable-redacted.");
  }
  if (snapshot.redacted !== true) issues.push("Snapshot must set redacted: true.");
  if (snapshot.mode !== "release-ready" && snapshot.mode !== "attention-required") {
    issues.push("Snapshot mode must be release-ready or attention-required.");
  }
  if (snapshot.source !== "local-snapshot") issues.push("Snapshot source must be local-snapshot.");
  if (typeof snapshot.payloadDigest !== "string" || !DIGEST_PATTERN.test(snapshot.payloadDigest)) {
    issues.push("payloadDigest must be a lowercase sha256 digest.");
  }

  validateProducer(snapshot.producer, issues);
  validateCompatibility(snapshot.compatibility, issues);
  validateInputDigests(snapshot.inputDigests, issues);

  validateStatus(snapshot.status, issues);
  validateTokenMetrics(snapshot.tokenMetrics, issues);
  validateProductivity(snapshot.productivity, issues);
  validateConnector(snapshot.connector, issues);
  validateSkills(snapshot.skills, issues);
  validateRouteTraces(snapshot.recentRouteTraces, issues);
  validatePolicyReviews(snapshot.policyReviews, issues);
  validateSources(snapshot.sources, issues);
  if (snapshot.curationReceipt !== undefined) validateCurationReceipt(snapshot.curationReceipt, issues);

  return { ok: issues.length === 0, issues };
}

export function isSha256Digest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function validateProducer(value, issues) {
  if (!isPlainObject(value)) {
    issues.push("producer must be an object.");
    return;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "name" && key !== "version")) issues.push("producer contains unknown fields.");
  if (!boundedString(value.name, 1, 80)) issues.push("producer.name must be a non-empty bounded string.");
  if (!boundedString(value.version, 1, 80)) issues.push("producer.version must be a non-empty bounded string.");
}

function validateCompatibility(value, issues) {
  if (!isPlainObject(value)) {
    issues.push("compatibility must be an object.");
    return;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "minReaderSchemaVersion" && key !== "maxReaderSchemaVersion")) {
    issues.push("compatibility contains unknown fields.");
  }
  if (value.minReaderSchemaVersion !== 2 || value.maxReaderSchemaVersion !== 2) {
    issues.push("compatibility reader schema range must be exactly 2..2.");
  }
}

function validateInputDigests(value, issues) {
  if (!isPlainObject(value)) {
    issues.push("inputDigests must be an object.");
    return;
  }
  if (Object.keys(value).length === 0) issues.push("inputDigests must contain at least one digest.");
  for (const [key, digest] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) issues.push(`inputDigests contains an invalid key: ${key}.`);
    if (!isSha256Digest(digest)) issues.push(`inputDigests.${key} must be a lowercase sha256 digest.`);
  }
}

function validateStatus(value, issues) {
  const status = exactRecord(value, ["verdict", "label", "summary", "warnings", "nextActions"], [], "status", issues);
  if (!status) return;
  if (!["ok", "attention-required", "blocked"].includes(status.verdict)) issues.push("status.verdict is unsupported.");
  boundedField(status.label, "status.label", issues);
  boundedField(status.summary, "status.summary", issues, 4000);
  stringList(status.warnings, "status.warnings", issues, 100, 4000);
  stringList(status.nextActions, "status.nextActions", issues, 100, 4000);
}

function validateTokenMetrics(value, issues) {
  const optional = ["fullBodyTokens", "catalogTokens", "hookTokensMean", "tokensAvoidedVsBodies", "tokensAvoidedVsCatalog"];
  const metrics = exactRecord(value, ["sampleSize", "method", "computedAt"], optional, "tokenMetrics", issues);
  if (!metrics) return;
  nonNegativeNumber(metrics.sampleSize, "tokenMetrics.sampleSize", issues);
  if (!["prior-audit", "workspace-estimate", "eval-report", "unknown"].includes(metrics.method)) issues.push("tokenMetrics.method is unsupported.");
  if (!isIsoTimestamp(metrics.computedAt)) issues.push("tokenMetrics.computedAt must be an ISO timestamp.");
  for (const key of optional) if (metrics[key] !== undefined) nonNegativeNumber(metrics[key], `tokenMetrics.${key}`, issues);
}

function validateProductivity(value, issues) {
  const optional = ["top1Rate", "top3Rate", "avoidHits", "avgRecommendations", "avgHookChars"];
  const metrics = exactRecord(value, ["routeCount", "evalConfidence", "releaseReady"], optional, "productivity", issues);
  if (!metrics) return;
  nonNegativeNumber(metrics.routeCount, "productivity.routeCount", issues);
  if (!["none", "demo", "weak", "alpha", "release"].includes(metrics.evalConfidence)) issues.push("productivity.evalConfidence is unsupported.");
  if (typeof metrics.releaseReady !== "boolean") issues.push("productivity.releaseReady must be boolean.");
  for (const key of optional) if (metrics[key] !== undefined) nonNegativeNumber(metrics[key], `productivity.${key}`, issues);
}

function validateConnector(value, issues) {
  const connector = exactRecord(
    value,
    ["state", "redactionEnabled", "readOnlyMode", "allowedCommands", "message"],
    ["cliVersion", "cwdAlias", "lastSeenAt", "lastSnapshotHash", "nextCommand"],
    "connector",
    issues
  );
  if (!connector) return;
  if (!["online", "offline", "blocked", "unauthorized"].includes(connector.state)) issues.push("connector.state is unsupported.");
  if (connector.redactionEnabled !== true) issues.push("connector.redactionEnabled must be true.");
  if (connector.readOnlyMode !== true) issues.push("connector.readOnlyMode must be true.");
  stringList(connector.allowedCommands, "connector.allowedCommands", issues, 100, 1000);
  boundedField(connector.message, "connector.message", issues, 4000);
  for (const key of ["cliVersion", "cwdAlias", "nextCommand"]) if (connector[key] !== undefined) boundedField(connector[key], `connector.${key}`, issues, 1000);
  if (connector.lastSeenAt !== undefined && !isIsoTimestamp(connector.lastSeenAt)) issues.push("connector.lastSeenAt must be an ISO timestamp.");
  if (connector.lastSnapshotHash !== undefined && !isSha256Digest(connector.lastSnapshotHash)) issues.push("connector.lastSnapshotHash must be a sha256 digest.");
}

function validateSkills(value, issues) {
  const rows = boundedArray(value, "skills", issues, 20000);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const label = `skills[${index}]`;
    const row = exactRecord(raw, ["id", "name", "tier", "routeEligible", "hasScripts", "sourceState", "reviewStatus", "bodyBytes", "descriptionBytes", "routeCount", "lastHash", "trustLabel", "reasonHints"], ["family", "lastRecommendedAt"], label, issues);
    if (!row) return;
    boundedField(row.id, `${label}.id`, issues, 200);
    if (typeof row.id !== "string" || !/^sk_[A-Za-z0-9_-]{43}$/.test(row.id)) issues.push(`${label}.id must be a qualified skill ID.`);
    boundedField(row.name, `${label}.name`, issues, 300);
    if (!["core", "preferred", "optional", "fallback", "blocked"].includes(row.tier)) issues.push(`${label}.tier is unsupported.`);
    if (typeof row.routeEligible !== "boolean" || typeof row.hasScripts !== "boolean") issues.push(`${label} routeEligible/hasScripts must be boolean.`);
    if (!["clean", "modified", "stale", "risky", "unknown", "error", "local"].includes(row.sourceState)) issues.push(`${label}.sourceState is unsupported.`);
    if (!["none", "reviewed", "held", "needs-review"].includes(row.reviewStatus)) issues.push(`${label}.reviewStatus is unsupported.`);
    for (const key of ["bodyBytes", "descriptionBytes", "routeCount"]) nonNegativeNumber(row[key], `${label}.${key}`, issues);
    if (!isSha256Digest(row.lastHash)) issues.push(`${label}.lastHash must be a sha256 digest.`);
    if (!["provider-verified", "user-reported", "unverified-user-reported"].includes(row.trustLabel)) issues.push(`${label}.trustLabel is unsupported.`);
    stringList(row.reasonHints, `${label}.reasonHints`, issues, 50, 1000);
    if (row.family !== undefined) boundedField(row.family, `${label}.family`, issues, 200);
    if (row.lastRecommendedAt !== undefined && !isIsoTimestamp(row.lastRecommendedAt)) issues.push(`${label}.lastRecommendedAt must be an ISO timestamp.`);
  });
}

function validateRouteTraces(value, issues) {
  const rows = boundedArray(value, "recentRouteTraces", issues, 1000);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const label = `recentRouteTraces[${index}]`;
    const row = exactRecord(raw, ["id", "createdAt", "rawPromptStored", "recommendations", "exclusions", "hookText", "hookChars", "statusWarnings", "tokenEstimate"], [], label, issues);
    if (!row) return;
    boundedField(row.id, `${label}.id`, issues, 200);
    if (!isIsoTimestamp(row.createdAt)) issues.push(`${label}.createdAt must be an ISO timestamp.`);
    if (row.rawPromptStored !== false) issues.push(`${label}.rawPromptStored must be false.`);
    boundedField(row.hookText, `${label}.hookText`, issues, 500);
    nonNegativeNumber(row.hookChars, `${label}.hookChars`, issues);
    stringList(row.statusWarnings, `${label}.statusWarnings`, issues, 100, 2000);
    validateRouteCandidates(row.recommendations, `${label}.recommendations`, issues);
    validateRouteExclusions(row.exclusions, `${label}.exclusions`, issues);
    const estimate = exactRecord(row.tokenEstimate, ["hookTokens", "method"], ["catalogTokensAvoided", "fullBodyTokensAvoided"], `${label}.tokenEstimate`, issues);
    if (estimate) {
      nonNegativeNumber(estimate.hookTokens, `${label}.tokenEstimate.hookTokens`, issues);
      boundedField(estimate.method, `${label}.tokenEstimate.method`, issues, 300);
      for (const key of ["catalogTokensAvoided", "fullBodyTokensAvoided"]) if (estimate[key] !== undefined) nonNegativeNumber(estimate[key], `${label}.tokenEstimate.${key}`, issues);
    }
  });
}

function validateRouteCandidates(value, label, issues) {
  const rows = boundedArray(value, label, issues, 50);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const itemLabel = `${label}[${index}]`;
    const row = exactRecord(raw, ["name", "score", "tier", "reasons"], ["family"], itemLabel, issues);
    if (!row) return;
    boundedField(row.name, `${itemLabel}.name`, issues, 300);
    nonNegativeNumber(row.score, `${itemLabel}.score`, issues);
    if (!["core", "preferred", "optional", "fallback", "blocked"].includes(row.tier)) issues.push(`${itemLabel}.tier is unsupported.`);
    stringList(row.reasons, `${itemLabel}.reasons`, issues, 50, 1000);
    if (row.family !== undefined) boundedField(row.family, `${itemLabel}.family`, issues, 200);
  });
}

function validateRouteExclusions(value, label, issues) {
  const rows = boundedArray(value, label, issues, 100);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const itemLabel = `${label}[${index}]`;
    const row = exactRecord(raw, ["name", "reason", "severity"], [], itemLabel, issues);
    if (!row) return;
    boundedField(row.name, `${itemLabel}.name`, issues, 300);
    boundedField(row.reason, `${itemLabel}.reason`, issues, 2000);
    if (!["info", "warning", "blocked"].includes(row.severity)) issues.push(`${itemLabel}.severity is unsupported.`);
  });
}

function validatePolicyReviews(value, issues) {
  const rows = boundedArray(value, "policyReviews", issues, 1000);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const label = `policyReviews[${index}]`;
    const row = exactRecord(raw, ["id", "queue", "name", "state", "reason", "nextAction"], [], label, issues);
    if (!row) return;
    for (const key of ["id", "name", "reason", "nextAction"]) boundedField(row[key], `${label}.${key}`, issues, 2000);
    if (!["unmatched", "duplicate", "explicit-only", "blocked", "inventory-missing"].includes(row.queue)) issues.push(`${label}.queue is unsupported.`);
    if (!["ready", "needs-review", "held"].includes(row.state)) issues.push(`${label}.state is unsupported.`);
  });
}

function validateSources(value, issues) {
  const rows = boundedArray(value, "sources", issues, 20000);
  if (!rows) return;
  rows.forEach((raw, index) => {
    const label = `sources[${index}]`;
    const row = exactRecord(raw, ["id", "name", "source", "state", "lastCheckedAt", "reviewStatus", "nextAction"], [], label, issues);
    if (!row) return;
    for (const key of ["id", "name", "source", "nextAction"]) boundedField(row[key], `${label}.${key}`, issues, 2000);
    if (!["clean", "modified", "stale", "risky", "unknown", "error", "local"].includes(row.state)) issues.push(`${label}.state is unsupported.`);
    if (!["none", "reviewed", "held", "needs-review"].includes(row.reviewStatus)) issues.push(`${label}.reviewStatus is unsupported.`);
    if (!isIsoTimestamp(row.lastCheckedAt)) issues.push(`${label}.lastCheckedAt must be an ISO timestamp.`);
  });
}

function validateCurationReceipt(value, issues) {
  const receipt = exactRecord(value, ["modelLabel", "curator", "recordedAt", "policyHash"], [], "curationReceipt", issues);
  if (!receipt) return;
  if (!["provider-verified", "user-reported", "unverified-user-reported"].includes(receipt.modelLabel)) issues.push("curationReceipt.modelLabel is unsupported.");
  boundedField(receipt.curator, "curationReceipt.curator", issues, 200);
  if (!isIsoTimestamp(receipt.recordedAt)) issues.push("curationReceipt.recordedAt must be an ISO timestamp.");
  if (!isSha256Digest(receipt.policyHash)) issues.push("curationReceipt.policyHash must be a sha256 digest.");
}

function exactRecord(value, required, optional, label, issues) {
  if (!isPlainObject(value)) {
    issues.push(`${label} must be an object.`);
    return undefined;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${label} contains unknown field: ${key}.`);
  for (const key of required) if (!(key in value)) issues.push(`${label} is missing required field: ${key}.`);
  return value;
}

function boundedArray(value, label, issues, max) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return undefined;
  }
  if (value.length > max) issues.push(`${label} exceeds maximum length ${max}.`);
  return value;
}

function stringList(value, label, issues, maxItems, maxLength) {
  const rows = boundedArray(value, label, issues, maxItems);
  if (!rows) return;
  rows.forEach((item, index) => boundedField(item, `${label}[${index}]`, issues, maxLength));
}

function boundedField(value, label, issues, max = 1000) {
  if (!boundedString(value, 0, max)) issues.push(`${label} must be a bounded string.`);
}

function nonNegativeNumber(value, label, issues) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) issues.push(`${label} must be a finite non-negative number.`);
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) throw new Error("Canonical JSON contains a non-JSON value.");

    const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested === undefined) throw new Error(`Canonical JSON contains undefined at ${key}.`);
    result[key] = canonicalValue(nested);
  }
  return result;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
