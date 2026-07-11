import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeTransportDigest,
  validateDashboardSnapshotV2,
  verifyPayloadDigest
} from "../lib/canonical-payload.js";

const snapshotPath = process.argv[2] ?? process.env.SKILLMAP_DASHBOARD_SNAPSHOT;
const forbiddenStringPatterns = [
  /\/home\//i,
  /\/Users\//i,
  /C:\\Users\\/i,
  /\/private\/var\//i,
  /\/var\/folders\//i
];
const rawTextFieldPattern = /^(rawPrompt|prompt|promptText|rawSkillBody|skillBodyText)$/i;
const secretPatterns = [
  /CANARY_/i,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i
];

if (!snapshotPath) {
  console.error("Usage: node scripts/check-dashboard-snapshot.mjs <redacted-snapshot.json>");
  process.exit(2);
}

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function inspectValue(value, path = "$") {
  if (typeof value === "string") {
    for (const pattern of forbiddenStringPatterns) {
      if (pattern.test(value)) {
        fail(`Snapshot privacy check failed at ${path}: ${pattern}`);
      }
    }
    if (containsAbsolutePath(value)) fail(`Snapshot privacy check failed at ${path}: absolute local path`);
    for (const pattern of secretPatterns) if (pattern.test(value)) fail(`Snapshot privacy check failed at ${path}: secret or privacy canary`);

    const key = path.split(".").pop() ?? "";
    if (rawTextFieldPattern.test(key)) {
      fail(`Snapshot stores a forbidden raw text field at ${path}`);
    }

    if (/promptPreview$/i.test(key) && value.length > 96) {
      fail(`Snapshot promptPreview is too long at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValue(entry, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") return;

  if ("rawPromptStored" in value) {
    if (value.rawPromptStored !== false) {
      fail(`Route trace must set rawPromptStored: false at ${path}`);
    }
    if ("prompt" in value || "rawPrompt" in value || "promptText" in value) {
      fail(`Route trace stores a raw prompt field at ${path}`);
    }
  }

  if ("redacted" in value && value.redacted !== true) {
    fail(`Snapshot must keep redacted: true at ${path}`);
  }

  for (const [key, child] of Object.entries(value)) {
    if (rawTextFieldPattern.test(key)) {
      fail(`Snapshot stores a forbidden raw text field at ${path}.${key}`);
    }
    inspectValue(child, `${path}.${key}`);
  }
}

function containsAbsolutePath(value) {
  return /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value)
    || /\bfile:\/\//i.test(value);
}

const resolvedPath = resolve(snapshotPath);
let text;
try {
  text = readFileSync(resolvedPath, "utf8");
} catch (error) {
  console.error(`Unable to read snapshot: ${error.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  console.error(`Snapshot is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (parsed && typeof parsed === "object" && parsed.version === 1) {
  fail("Legacy v1 dashboard snapshots are unverified. Export a v2 snapshot with payloadDigest.");
} else {
  const contract = validateDashboardSnapshotV2(parsed);
  for (const issue of contract.issues) fail(`Snapshot contract check failed: ${issue}`);

  const digest = verifyPayloadDigest(parsed);
  if (!digest.ok) fail(`Snapshot integrity check failed: ${digest.error}`);
}
inspectValue(parsed);

if (failed) {
  process.exit(1);
}

console.log(
  `Dashboard snapshot privacy, contract, and integrity check passed. payloadDigest=${parsed.payloadDigest} transportDigest=${computeTransportDigest(text)}`
);
