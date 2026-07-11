import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  canonicalPayloadJson,
  computePayloadDigest,
  computeTransportDigest,
  validateDashboardSnapshotV2,
  verifyPayloadDigest
} from "../lib/canonical-payload.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const canonicalVector = {
  z: 3,
  payloadDigest: "excluded",
  a: { z: 1, a: 2 },
  list: [{ b: 2, a: 1 }, -0]
};
assert.equal(
  canonicalPayloadJson(canonicalVector),
  '{"a":{"a":2,"z":1},"list":[{"a":1,"b":2},0],"z":3}'
);
assert.equal(
  computePayloadDigest(canonicalVector),
  "sha256:14621e97c81c2ffae8fa42f1966e99dda9b08cb7cd66323f3a9da2917b55803b"
);

function buildSnapshot() {
  const snapshot = {
    version: 2,
    kind: "skillmap.dashboard-snapshot",
    schemaVersion: 2,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    workspaceRevision: SHA_A,
    workspaceName: "Integrity Demo",
    generatedAt: "2026-07-10T12:00:00.000Z",
    producer: { name: "skillmap", version: "0.1.0" },
    compatibility: {
      minReaderSchemaVersion: 2,
      maxReaderSchemaVersion: 2
    },
    inputDigests: { status: SHA_A },
    redactionClassification: "shareable-redacted",
    redacted: true,
    mode: "release-ready",
    source: "local-snapshot",
    status: {
      verdict: "ok",
      label: "Ready",
      summary: "Snapshot is ready.",
      warnings: ["first", "second"],
      nextActions: []
    },
    tokenMetrics: {
      sampleSize: 0,
      method: "unknown",
      computedAt: "2026-07-10T12:00:00.000Z"
    },
    productivity: {
      routeCount: 0,
      evalConfidence: "none",
      releaseReady: false
    },
    connector: {
      state: "blocked",
      redactionEnabled: true,
      readOnlyMode: true,
      allowedCommands: ["skillmap status --json"],
      message: "Read-only snapshot."
    },
    skills: [],
    recentRouteTraces: [],
    policyReviews: [],
    sources: []
  };

  return { ...snapshot, payloadDigest: computePayloadDigest(snapshot) };
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)])
  );
}

function checkCli(snapshot, expectedStatus) {
  const dir = mkdtempSync(join(tmpdir(), "skillmap-snapshot-integrity-"));
  const file = join(dir, "snapshot.json");
  try {
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const result = spawnSync(
      process.execPath,
      [new URL("./check-dashboard-snapshot.mjs", import.meta.url).pathname, file],
      { encoding: "utf8" }
    );
    assert.equal(
      result.status,
      expectedStatus,
      `checker exit status differed; stdout=${result.stdout} stderr=${result.stderr}`
    );
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const valid = buildSnapshot();
assert.deepEqual(validateDashboardSnapshotV2(valid), { ok: true, issues: [] });
assert.equal(verifyPayloadDigest(valid).ok, true);

const reordered = reverseObjectKeys(valid);
assert.equal(computePayloadDigest(reordered), valid.payloadDigest);
assert.equal(verifyPayloadDigest(reordered).ok, true);

const protoOne = JSON.parse('{"kind":"prototype-vector","__proto__":{"value":1}}');
const protoTwo = JSON.parse('{"kind":"prototype-vector","__proto__":{"value":2}}');
assert.match(canonicalPayloadJson(protoOne), /"__proto__"/);
assert.notEqual(computePayloadDigest(protoOne), computePayloadDigest(protoTwo));

const compact = JSON.stringify(valid);
const pretty = `${JSON.stringify(valid, null, 2)}\n`;
assert.notEqual(computeTransportDigest(compact), computeTransportDigest(pretty));
assert.equal(computePayloadDigest(JSON.parse(compact)), computePayloadDigest(JSON.parse(pretty)));

const semanticTamper = structuredClone(valid);
semanticTamper.status.summary = "Tampered but still valid-looking.";
assert.equal(verifyPayloadDigest(semanticTamper).ok, false);

const arrayOrderTamper = structuredClone(valid);
arrayOrderTamper.status.warnings.reverse();
assert.equal(verifyPayloadDigest(arrayOrderTamper).ok, false);

const unknownTopLevel = { ...valid, futureField: true };
assert.equal(validateDashboardSnapshotV2(unknownTopLevel).ok, false);
assert.match(
  validateDashboardSnapshotV2(unknownTopLevel).issues.join(" "),
  /Unknown v2 top-level field: futureField/
);

const unknownNested = structuredClone(valid);
unknownNested.status.unexpectedNestedControl = "force-ready";
unknownNested.payloadDigest = computePayloadDigest(unknownNested);
assert.equal(validateDashboardSnapshotV2(unknownNested).ok, false);
assert.match(validateDashboardSnapshotV2(unknownNested).issues.join(" "), /status contains unknown field/);

const legacySkillId = structuredClone(valid);
legacySkillId.skills = [{
  id: "legacy-name-only-id",
  name: "alpha",
  tier: "preferred",
  routeEligible: false,
  hasScripts: false,
  sourceState: "unknown",
  reviewStatus: "none",
  bodyBytes: 0,
  descriptionBytes: 0,
  routeCount: 0,
  lastHash: SHA_A,
  trustLabel: "unverified-user-reported",
  reasonHints: ["route=blocked"]
}];
legacySkillId.payloadDigest = computePayloadDigest(legacySkillId);
assert.equal(validateDashboardSnapshotV2(legacySkillId).ok, false);
assert.match(validateDashboardSnapshotV2(legacySkillId).issues.join(" "), /qualified skill ID/);

const absolutePathPoison = structuredClone(valid);
absolutePathPoison.status.summary = "Tenant root is /mnt/customer-secret/skills";
absolutePathPoison.payloadDigest = computePayloadDigest(absolutePathPoison);
const absoluteCli = checkCli(absolutePathPoison, 1);
assert.match(absoluteCli.stderr, /absolute local path/);

const secretPoison = structuredClone(valid);
secretPoison.status.summary = "token ghp_1234567890ABCDEFGHIJ";
secretPoison.payloadDigest = computePayloadDigest(secretPoison);
const secretCli = checkCli(secretPoison, 1);
assert.match(secretCli.stderr, /secret or privacy canary/);

const previewPoison = structuredClone(valid);
previewPoison.recentRouteTraces = [{
  id: "trace-preview",
  createdAt: valid.generatedAt,
  promptPreview: "raw prompt text",
  rawPromptStored: false,
  recommendations: [],
  exclusions: [],
  hookText: "",
  hookChars: 0,
  statusWarnings: [],
  tokenEstimate: { hookTokens: 0, method: "fixture" }
}];
previewPoison.payloadDigest = computePayloadDigest(previewPoison);
assert.equal(validateDashboardSnapshotV2(previewPoison).ok, false);
assert.match(validateDashboardSnapshotV2(previewPoison).issues.join(" "), /promptPreview/);

const malformedDigest = { ...valid, payloadDigest: "sha256:not-a-real-digest" };
assert.equal(validateDashboardSnapshotV2(malformedDigest).ok, false);
assert.equal(verifyPayloadDigest(malformedDigest).ok, false);

const transportFields = {
  ...valid,
  transportDigest: `sha256:${"b".repeat(64)}`,
  transportMetadata: { encoding: "utf-8" }
};
assert.equal(computePayloadDigest(transportFields), valid.payloadDigest);
assert.equal(validateDashboardSnapshotV2(transportFields).ok, false);

const nonContractTransportField = { ...valid, transport: { encoding: "utf-8" } };
assert.notEqual(computePayloadDigest(nonContractTransportField), valid.payloadDigest);
assert.equal(validateDashboardSnapshotV2(nonContractTransportField).ok, false);

const nestedTransportField = structuredClone(valid);
nestedTransportField.connector.transportDigest = `sha256:${"b".repeat(64)}`;
assert.notEqual(computePayloadDigest(nestedTransportField), valid.payloadDigest);

const validCli = checkCli(valid, 0);
assert.match(validCli.stdout, /privacy, contract, and integrity check passed/);

const tamperedCli = checkCli(semanticTamper, 1);
assert.match(tamperedCli.stderr, /payloadDigest does not match canonical payload bytes/);

const legacyCli = checkCli({ version: 1, redacted: true }, 1);
assert.match(legacyCli.stderr, /Legacy v1 dashboard snapshots are unverified/);

console.log("Snapshot integrity adversarial checks passed (canonical parity, tamper rejection, strict v2 schema, and legacy blocking).");
