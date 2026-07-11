import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateDashboardSnapshotV2,
  verifyPayloadDigest
} from "../lib/canonical-payload.js";

const fixtureDir = new URL("../data/fixtures", import.meta.url);
const files = readdirSync(fixtureDir).filter((file) => file.endsWith(".json"));
const forbiddenStringPatterns = [
  /\/home\//i,
  /\/Users\//i,
  /C:\\Users\\/i,
  /\/private\/var\//i,
  /\/var\/folders\//i
];
let failed = false;
const secretPatterns = [
  /CANARY_/i,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i
];
let legacyDashboardFixtures = 0;

function fail(message) {
  console.error(message);
  failed = true;
}

function inspectValue(file, value, path = "$", parent = null) {
  if (typeof value === "string") {
    for (const pattern of forbiddenStringPatterns) {
      if (pattern.test(value)) {
        fail(`Fixture privacy check failed in ${file} at ${path}: ${pattern}`);
      }
    }
    if (containsAbsolutePath(value)) fail(`Fixture privacy check failed in ${file} at ${path}: absolute local path`);
    for (const pattern of secretPatterns) if (pattern.test(value)) fail(`Fixture privacy check failed in ${file} at ${path}: secret or privacy canary`);

    const key = path.split(".").pop() ?? "";
    if (/^(rawPrompt|prompt|promptText|rawSkillBody|skillBodyText)$/i.test(key)) {
      fail(`Fixture ${file} stores a forbidden raw text field at ${path}`);
    }

    if (/promptPreview$/i.test(key) && value.length > 96) {
      fail(`Fixture ${file} promptPreview is too long at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValue(file, entry, `${path}[${index}]`, parent));
    return;
  }

  if (!value || typeof value !== "object") return;

  if ("rawPromptStored" in value) {
    if (value.rawPromptStored !== false) {
      fail(`Fixture ${file} must set rawPromptStored: false at ${path}`);
    }
    if ("prompt" in value || "rawPrompt" in value || "promptText" in value) {
      fail(`Fixture ${file} stores a raw prompt field at ${path}`);
    }
  }

  if ("redacted" in value && value.redacted !== true) {
    fail(`Fixture ${file} must keep redacted: true at ${path}`);
  }

  if ("skills" in value && Array.isArray(value.skills)) {
    for (const skill of value.skills) {
      if (typeof skill.lastHash !== "string" || !skill.lastHash.startsWith("sha256:")) {
        fail(`Fixture ${file} skill ${skill.name ?? skill.id ?? "unknown"} is missing lastHash`);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    inspectValue(file, child, `${path}.${key}`, value);
  }
}

function containsAbsolutePath(value) {
  return /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value)
    || /\bfile:\/\//i.test(value);
}

for (const file of files) {
  const fullPath = join(fixtureDir.pathname, file);
  const text = readFileSync(fullPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`Fixture ${file} is not valid JSON: ${error.message}`);
    continue;
  }

  inspectValue(file, parsed);

  if (file.startsWith("dashboard-snapshot.")) {
    if (parsed?.version === 1) {
      legacyDashboardFixtures += 1;
      if ("payloadDigest" in parsed) {
        fail(`Legacy dashboard fixture ${file} must not imply v2 payloadDigest verification`);
      }
      if (parsed.source === "local-snapshot") {
        fail(`Legacy dashboard fixture ${file} must not identify itself as trusted local snapshot state`);
      }
    } else if (parsed?.version === 2) {
      const contract = validateDashboardSnapshotV2(parsed);
      for (const issue of contract.issues) {
        fail(`Dashboard fixture ${file} failed v2 contract validation: ${issue}`);
      }
      const digest = verifyPayloadDigest(parsed);
      if (!digest.ok) {
        fail(`Dashboard fixture ${file} failed v2 payloadDigest verification: ${digest.error}`);
      }
    } else {
      fail(`Dashboard fixture ${file} must be explicit legacy v1 demo data or a valid v2 snapshot`);
    }
  }

  if (file.includes("route")) {
    const traces = Array.isArray(parsed) ? parsed : [parsed];
    if (!traces.every((trace) => trace && trace.rawPromptStored === false)) {
      fail(`Route fixture ${file} must explicitly set rawPromptStored: false on every trace`);
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `Fixture privacy and contract check passed for ${files.length} files. ${legacyDashboardFixtures} legacy v1 dashboard fixture(s) are demo-only and excluded from trusted local snapshot state.`
);
