import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  calculateInventorySummary,
  formatByteSize,
  isCutoverReceiptId,
  isImportSessionId,
  isImportViewStateKind,
  isSha256Digest,
  normalizeInventorySummary
} from "../lib/import/contracts.ts";

import {
  containsSecretPattern,
  isPrivatePath,
  isSafeRelativePath,
  redactImportPayload,
  sanitizeCutoverReceipt,
  sanitizeImportSessionProjection,
  sanitizePath,
  sanitizeSkillPreviewItem,
  REDACTED_PATH_MARKER,
  REDACTED_SECRET_MARKER
} from "../lib/import/redaction.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("contracts: formatByteSize accurately formats byte sizes", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(512), "512 B");
  assert.equal(formatByteSize(1024), "1.0 KB");
  assert.equal(formatByteSize(2560), "2.5 KB");
  assert.equal(formatByteSize(1048576), "1.0 MB");
  assert.equal(formatByteSize(10485760), "10 MB");
  assert.equal(formatByteSize(-10), "0 B");
  assert.equal(formatByteSize(NaN), "0 B");
});

test("contracts: ID and digest checkers validate strict grammar", () => {
  assert.equal(isImportSessionId("imp_0123456789abcdef0123456789abcdef"), true);
  assert.equal(isImportSessionId("imp_0123456789abcdef"), false); // too short
  assert.equal(isImportSessionId("not_an_imp_id"), false);
  assert.equal(isImportSessionId(""), false);
  assert.equal(isImportSessionId(null), false);

  assert.equal(isCutoverReceiptId("rcpt_0123456789abcdef0123456789abcdef"), true);
  assert.equal(isCutoverReceiptId("rcpt_abc123"), false);
  assert.equal(isCutoverReceiptId(undefined), false);

  assert.equal(isSha256Digest("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), true);
  assert.equal(isSha256Digest("sha256:short"), false);
  assert.equal(isSha256Digest("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), false); // missing prefix

  assert.equal(isImportViewStateKind("idle"), true);
  assert.equal(isImportViewStateKind("preview"), true);
  assert.equal(isImportViewStateKind("uploading"), true);
  assert.equal(isImportViewStateKind("partial"), true);
  assert.equal(isImportViewStateKind("blocked"), true);
  assert.equal(isImportViewStateKind("ready_for_consent"), true);
  assert.equal(isImportViewStateKind("consented"), true);
  assert.equal(isImportViewStateKind("cutover_ready"), true);
  assert.equal(isImportViewStateKind("stale"), true);
  assert.equal(isImportViewStateKind("error"), true);
  assert.equal(isImportViewStateKind("invalid_state"), false);
});

test("contracts: calculateInventorySummary computes exact totals and exclusion adjustments", () => {
  const skills = [
    {
      skillName: "skill-a",
      status: "ready",
      fileCount: 3,
      byteTotal: 3000,
      manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      files: [],
      warnings: [],
      blockedReasons: [],
      excluded: false
    },
    {
      skillName: "skill-b",
      status: "warning",
      fileCount: 2,
      byteTotal: 2000,
      manifestDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      files: [],
      warnings: ["UNUSED_DEPENDENCY"],
      blockedReasons: [],
      isDuplicate: true,
      excluded: false
    },
    {
      skillName: "skill-c",
      status: "blocked",
      fileCount: 1,
      byteTotal: 1000,
      manifestDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      files: [],
      warnings: [],
      blockedReasons: ["BLOCKED_SECRET_PATTERN"],
      excluded: true
    }
  ];

  const summary = calculateInventorySummary(skills, "sha256:manifest-summary-digest");
  assert.equal(summary.totalSkills, 2); // 1 excluded
  assert.equal(summary.totalFiles, 5);
  assert.equal(summary.totalBytes, 5000);
  assert.equal(summary.duplicateCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.blockedCount, 0); // excluded skill does not count towards active blocked
  assert.equal(summary.excludedCount, 1);
  assert.equal(summary.manifestDigest, "sha256:manifest-summary-digest");
});

test("redaction: isPrivatePath identifies absolute and traversal paths strictly", () => {
  assert.equal(isPrivatePath("/Users/stevmq/skills/my-skill"), true);
  assert.equal(isPrivatePath("/etc/shadow"), true);
  assert.equal(isPrivatePath("file:///Users/stevmq/doc"), true);
  assert.equal(isPrivatePath("~/.config/skillmap"), true);
  assert.equal(isPrivatePath("C:\\Users\\stevmq\\Documents"), true);
  assert.equal(isPrivatePath("C:/projects/skill"), true);
  assert.equal(isPrivatePath("\\\\server\\share\\file"), true);
  assert.equal(isPrivatePath("../../secret.key"), true);
  assert.equal(isPrivatePath("skills/../../passwd"), true);

  assert.equal(isPrivatePath("SKILL.md"), false);
  assert.equal(isPrivatePath("scripts/extract.py"), false);
  assert.equal(isPrivatePath("references/docs.json"), false);
  assert.equal(isPrivatePath(""), false);
});

test("redaction: isSafeRelativePath validates relative paths without escape", () => {
  assert.equal(isSafeRelativePath("SKILL.md"), true);
  assert.equal(isSafeRelativePath("scripts/run.py"), true);
  assert.equal(isSafeRelativePath("assets/images/diagram.png"), true);
  assert.equal(isSafeRelativePath("references/Crème brûlée notes.md"), true);
  assert.equal(isSafeRelativePath("invalid path with spaces.md"), true);
  assert.equal(isSafeRelativePath("a-b_c.d/e-f_g.h"), true);

  assert.equal(isSafeRelativePath("/SKILL.md"), false);
  assert.equal(isSafeRelativePath("../SKILL.md"), false);
  assert.equal(isSafeRelativePath(".env"), false);
  assert.equal(isSafeRelativePath(""), false);
  assert.equal(isSafeRelativePath("scripts//double-slash.py"), false);
  assert.equal(isSafeRelativePath("references/Cre\u0300me.md"), false);
  assert.equal(isSafeRelativePath("references/%2e%2e/secret.md"), false);
  assert.equal(isSafeRelativePath(`${"a/".repeat(32)}file.md`), false);
  assert.equal(isSafeRelativePath(`${"é".repeat(256)}.md`), false);
});

test("redaction: sanitizePath redacts sensitive paths and returns clean relative paths", () => {
  assert.equal(sanitizePath("/Users/stevmq/project/SKILL.md"), REDACTED_PATH_MARKER);
  assert.equal(sanitizePath("file:///etc/hosts"), REDACTED_PATH_MARKER);
  assert.equal(sanitizePath("~/my-skill/SKILL.md"), REDACTED_PATH_MARKER);
  assert.equal(sanitizePath("SKILL.md"), "SKILL.md");
  assert.equal(sanitizePath("scripts/runner.sh"), "scripts/runner.sh");
  assert.equal(sanitizePath(null), REDACTED_PATH_MARKER);
});

test("redaction: containsSecretPattern detects private keys, tokens and auth headers", () => {
  assert.equal(containsSecretPattern("-----BEGIN RSA PRIVATE KEY-----\nMIIE..."), true);
  assert.equal(containsSecretPattern("-----BEGIN OPENSSH PRIVATE KEY-----"), true);
  assert.equal(containsSecretPattern("Bearer eyJhbGciOi..."), true);
  assert.equal(containsSecretPattern("sk_live_1234567890abcdef"), true);
  assert.equal(containsSecretPattern("ghp_1234567890abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(containsSecretPattern("Clean text without tokens"), false);
});

test("redaction: redactImportPayload recursively strips raw content and scrubs secrets/paths", () => {
  const dirty = {
    sessionId: "imp_0123456789abcdef0123456789abcdef",
    content: "raw secret script content that must not be sent",
    body: "sensitive file content",
    scriptBody: "echo password123",
    token: "secret-token-value",
    privatePath: "/Users/stevmq/private/path.ts",
    nested: {
      key: "secret-key",
      validPath: "SKILL.md",
      authHeader: "Bearer 12345",
      secretReason: "Found key: -----BEGIN PRIVATE KEY-----"
    },
    list: ["SKILL.md", "/var/log/syslog", "Bearer secret"]
  };

  const clean = redactImportPayload(dirty);
  assert.equal(clean.sessionId, "imp_0123456789abcdef0123456789abcdef");
  assert.equal(clean.content, undefined);
  assert.equal(clean.body, undefined);
  assert.equal(clean.scriptBody, undefined);
  assert.equal(clean.token, undefined);
  assert.equal(clean.privatePath, REDACTED_PATH_MARKER);
  assert.equal(clean.nested.key, undefined);
  assert.equal(clean.nested.validPath, "SKILL.md");
  assert.equal(clean.nested.authHeader, undefined);
  assert.equal(clean.nested.secretReason, REDACTED_SECRET_MARKER);
  assert.deepEqual(clean.list, ["SKILL.md", REDACTED_PATH_MARKER, REDACTED_SECRET_MARKER]);
});

test("redaction: sanitizeImportSessionProjection transforms raw payload to guaranteed safe model", () => {
  const rawSession = {
    sessionId: "imp_0123456789abcdef0123456789abcdef",
    state: "preview",
    device: {
      id: "dev_123",
      name: "Office Mac",
      platform: "darwin"
    },
    summary: {
      totalSkills: 2,
      totalFiles: 4,
      totalBytes: 8192,
      manifestDigest: "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef"
    },
    skills: [
      {
        skillName: "code-assistant",
        status: "ready",
        fileCount: 2,
        byteTotal: 4096,
        manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        files: [
          { relativePath: "SKILL.md", byteSize: 2048 },
          { relativePath: "/Users/stevmq/leak/script.py", byteSize: 2048 }
        ],
        rawText: "RAW CONTENT LEAK"
      },
      {
        skillName: "/absolute/bad/name",
        status: "blocked"
      }
    ],
    errorMessage: "Sensitive error from /Users/stevmq/secret/path"
  };

  const projection = sanitizeImportSessionProjection(rawSession);
  assert.ok(projection);
  assert.equal(projection.sessionId, "imp_0123456789abcdef0123456789abcdef");
  assert.equal(projection.device.name, "Office Mac");
  assert.equal(projection.skills.length, 1); // Discarded invalid skill name with absolute path
  assert.equal(projection.skills[0].skillName, "code-assistant");
  assert.equal(projection.skills[0].files[0].relativePath, "SKILL.md");
  assert.equal(projection.skills[0].files[1].relativePath, REDACTED_PATH_MARKER);
  assert.equal(projection.skills[0].rawText, undefined);
  assert.equal(projection.errorMessage, "An unexpected error occurred during import.");
});

test("redaction: sanitizeCutoverReceipt ensures valid receipt and excludes eligiblePaths", () => {
  const rawReceipt = {
    receiptId: "rcpt_0123456789abcdef0123456789abcdef",
    sessionId: "imp_0123456789abcdef0123456789abcdef",
    deviceId: "dev_987",
    manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    verificationDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    eligibleSkillCount: 2,
    eligiblePaths: ["skill-a", "/Users/stevmq/skill-b", "skill-c/SKILL.md"],
    issuedAt: "2026-08-20T03:00:00Z",
    expiresAt: "2026-08-20T03:30:00Z"
  };

  const receipt = sanitizeCutoverReceipt(rawReceipt);
  assert.ok(receipt);
  assert.equal(receipt.receiptId, "rcpt_0123456789abcdef0123456789abcdef");
  assert.equal(receipt.eligibleSkillCount, 2);
  // P1: eligiblePaths must NOT be serialized in the browser receipt
  assert.equal("eligiblePaths" in receipt, false);
});

test("contracts: normalizeInventorySummary handles malformed or empty payloads safely", () => {
  assert.equal(normalizeInventorySummary(null), null);
  assert.equal(normalizeInventorySummary("invalid"), null);
  assert.deepEqual(normalizeInventorySummary({}), {
    totalSkills: 0,
    totalFiles: 0,
    totalBytes: 0,
    duplicateCount: 0,
    warningCount: 0,
    blockedCount: 0,
    excludedCount: 0,
    manifestDigest: ""
  });
  assert.deepEqual(
    normalizeInventorySummary({
      totalSkills: -5,
      totalFiles: 3.8,
      totalBytes: 1024,
      manifestDigest: "  sha256:abc  "
    }),
    {
      totalSkills: 0,
      totalFiles: 3,
      totalBytes: 1024,
      duplicateCount: 0,
      warningCount: 0,
      blockedCount: 0,
      excludedCount: 0,
      manifestDigest: "sha256:abc"
    }
  );
});

test("redaction: sanitizeSkillPreviewItem falls back on malformed or empty items", () => {
  assert.equal(sanitizeSkillPreviewItem(null), null);
  assert.equal(sanitizeSkillPreviewItem(123), null);

  const fallback = sanitizeSkillPreviewItem({});
  assert.ok(fallback);
  assert.equal(fallback.skillName, "unnamed-skill");
  assert.equal(fallback.status, "ready");
  assert.equal(fallback.fileCount, 0);
  assert.equal(fallback.byteTotal, 0);

  const blockedWithReason = sanitizeSkillPreviewItem({
    name: "auth-skill",
    status: "BLOCKED",
    blockedReasons: ["BLOCKED_SECRET_PATTERN", "Found token: ghp_1234567890abcdefghijklmnopqrstuvwxyz"]
  });
  assert.ok(blockedWithReason);
  assert.equal(blockedWithReason.status, "blocked");
  assert.equal(blockedWithReason.blockedReasons[0], "BLOCKED_SECRET_PATTERN");
  assert.equal(blockedWithReason.blockedReasons[1], REDACTED_SECRET_MARKER);
});

test("redaction: redactImportPayload stops at max depth safely", () => {
  let nested = { val: "inner" };
  for (let i = 0; i < 15; i++) {
    nested = { child: nested };
  }
  const result = redactImportPayload(nested);
  assert.ok(result);
});

test("boundary check: import-review-client.tsx never imports redaction or raw-sanitization", async () => {
  const clientPath = resolve(__dirname, "../app/import/import-review-client.tsx");
  const clientSource = await readFile(clientPath, "utf8");

  assert.equal(clientSource.includes("from \"@/lib/import/redaction"), false);
  assert.equal(clientSource.includes("from \"./redaction"), false);
  assert.equal(clientSource.includes("from \"../lib/import/redaction"), false);
  assert.equal(clientSource.includes("sanitizeImportSessionProjection"), false);
  assert.equal(clientSource.includes("redactImportPayload"), false);
});

test("boundary check: redaction.ts is marked server-only", async () => {
  const redactionPath = resolve(__dirname, "../lib/import/redaction.ts");
  const redactionSource = await readFile(redactionPath, "utf8");

  assert.ok(redactionSource.includes("import \"server-only\""));
});

test("M4 import page fetches only the owner dashboard-safe projection before client rendering", async () => {
  const pageSource = await readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8");
  assert.ok(pageSource.includes('from("my_import_dashboard")'));
  assert.ok(pageSource.includes("sanitizeImportDashboardRows"));
  assert.match(pageSource, /<ImportReviewClient\s+initialProjection=\{projection\}/u);
  assert.equal(pageSource.includes("serviceRoleKey"), false);
  assert.equal(pageSource.includes("private."), false);
});

test("consent binding: confirmation modal form includes sessionId, revision, and manifestDigest", async () => {
  const clientPath = resolve(__dirname, "../app/import/import-review-client.tsx");
  const clientSource = await readFile(clientPath, "utf8");

  assert.ok(clientSource.includes('name="sessionId"'));
  assert.ok(clientSource.includes('name="revision"'));
  assert.ok(clientSource.includes('name="manifestDigest"'));
});

test("exclusion control requires a server callback and has no legacy client toggle action", async () => {
  const clientPath = resolve(__dirname, "../app/import/import-review-client.tsx");
  const statePath = resolve(__dirname, "../app/import/view-state.ts");
  const [clientSource, stateSource] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(statePath, "utf8")
  ]);

  assert.ok(clientSource.includes("disabled={isExcluded || !onRequestExclusionAction"));
  assert.ok(clientSource.includes("event.currentTarget.checked"));
  assert.ok(clientSource.includes('type: "SKILL_EXCLUSION_FAILED"'));
  assert.ok(stateSource.includes('| { type: "SKILL_EXCLUSION_FAILED"; skillName: string }'));
  assert.equal(stateSource.includes("TOGGLE_SKILL_EXCLUSION"), false);
});

test("dialog and exclusion controls keep keyboard focus and one-way exclusion semantics explicit", async () => {
  const clientPath = resolve(__dirname, "../app/import/import-review-client.tsx");
  const clientSource = await readFile(clientPath, "utf8");

  assert.ok(clientSource.includes('if (e.key !== "Tab") return'));
  assert.ok(clientSource.includes("previousFocus?.focus()"));
  assert.ok(clientSource.includes("disabled={isExcluded ||"));
  assert.ok(clientSource.includes('aria-pressed={isSelected}'));
  assert.ok(clientSource.includes('type="button"'));
});
