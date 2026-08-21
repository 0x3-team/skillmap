import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canApproveConsent,
  canCancelSession,
  canResumeUpload,
  canRetry,
  deriveImportViewState,
  getInitialImportState,
  getStateAriaAnnouncement,
  getStateBadgeTone,
  getStateDescription,
  getStateTitle,
  importViewReducer,
  isValidStateTransition
} from "../app/import/view-state.ts";

function createMockSession(overrides = {}) {
  return {
    sessionId: "imp_0123456789abcdef0123456789abcdef",
    state: "preview",
    device: { name: "MacBook Pro", platform: "macos" },
    summary: {
      totalSkills: 2,
      totalFiles: 4,
      totalBytes: 8192,
      duplicateCount: 0,
      warningCount: 0,
      blockedCount: 0,
      excludedCount: 0,
      manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    },
    skills: [
      {
        skillName: "code-analysis",
        status: "ready",
        fileCount: 2,
        byteTotal: 4096,
        manifestDigest: "sha256:aaaa",
        files: [{ relativePath: "SKILL.md", byteSize: 4096 }],
        warnings: [],
        blockedReasons: [],
        excluded: false
      },
      {
        skillName: "doc-generator",
        status: "ready",
        fileCount: 2,
        byteTotal: 4096,
        manifestDigest: "sha256:bbbb",
        files: [{ relativePath: "SKILL.md", byteSize: 4096 }],
        warnings: [],
        blockedReasons: [],
        excluded: false
      }
    ],
    createdAt: "2026-08-20T03:00:00Z",
    expiresAt: "2026-08-20T09:00:00Z",
    revision: 1,
    ...overrides
  };
}

test("view-state: deriveImportViewState handles all 10 states deterministically", () => {
  // 1. idle: no session
  assert.equal(deriveImportViewState(null), "idle");

  // 2. error: error override
  assert.equal(deriveImportViewState(createMockSession(), { hasError: true }), "error");

  // 3. stale: expired override
  assert.equal(deriveImportViewState(createMockSession(), { isExpired: true }), "stale");

  // 4. consented: isConsenting in flight
  assert.equal(deriveImportViewState(createMockSession(), { isConsenting: true }), "consented");

  // 5. cutover_ready: has cutover receipt
  const receiptSession = createMockSession({
    cutoverReceipt: {
      receiptId: "rcpt_0123456789abcdef0123456789abcdef",
      sessionId: "imp_0123456789abcdef0123456789abcdef",
      deviceId: "dev_1",
      manifestDigest: "sha256:1111",
      verificationDigest: "sha256:2222",
      eligibleSkillCount: 2,
      issuedAt: "2026-08-20T03:00:00Z",
      expiresAt: "2026-08-20T03:30:00Z"
    }
  });
  assert.equal(deriveImportViewState(receiptSession), "cutover_ready");

  // 6. blocked: has blocked skills
  const blockedSession = createMockSession({
    skills: [
      {
        skillName: "blocked-skill",
        status: "blocked",
        fileCount: 1,
        byteTotal: 100,
        manifestDigest: "sha256:cccc",
        files: [],
        warnings: [],
        blockedReasons: ["BLOCKED_SECRET_PATTERN"],
        excluded: false
      }
    ]
  });
  assert.equal(deriveImportViewState(blockedSession), "blocked");

  // 7. preview: normal clean session
  assert.equal(deriveImportViewState(createMockSession()), "preview");

  // 8. uploading: active upload progress
  const uploadingSession = createMockSession({
    state: "uploading",
    uploadProgress: {
      acceptedFileCount: 2,
      acceptedByteTotal: 4096,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 50
    }
  });
  assert.equal(deriveImportViewState(uploadingSession), "uploading");

  // 9. partial: interrupted upload progress
  const partialSession = createMockSession({
    state: "partial",
    uploadProgress: {
      acceptedFileCount: 2,
      acceptedByteTotal: 4096,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 50
    }
  });
  assert.equal(deriveImportViewState(partialSession), "partial");

  // 10. ready_for_consent: 100% upload progress
  const readySession = createMockSession({
    uploadProgress: {
      acceptedFileCount: 4,
      acceptedByteTotal: 8192,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 100
    }
  });
  assert.equal(deriveImportViewState(readySession), "ready_for_consent");

  // A persisted server consent must not regress when completed upload totals remain present.
  const consentedSession = createMockSession({
    state: "consented",
    uploadProgress: {
      acceptedFileCount: 4,
      acceptedByteTotal: 8192,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 100
    }
  });
  assert.equal(deriveImportViewState(consentedSession), "consented");
});

test("view-state: transition validation permits valid progressions and blocks illegal jumps", () => {
  assert.equal(isValidStateTransition("idle", "preview"), true);
  assert.equal(isValidStateTransition("preview", "uploading"), true);
  assert.equal(isValidStateTransition("uploading", "ready_for_consent"), true);
  assert.equal(isValidStateTransition("ready_for_consent", "consented"), true);
  assert.equal(isValidStateTransition("consented", "cutover_ready"), true);
  assert.equal(isValidStateTransition("uploading", "partial"), true);
  assert.equal(isValidStateTransition("partial", "uploading"), true);

  // Illegal jumps
  assert.equal(isValidStateTransition("idle", "cutover_ready"), false);
  assert.equal(isValidStateTransition("idle", "ready_for_consent"), false);
  assert.equal(isValidStateTransition("cutover_ready", "uploading"), false);
});

test("manifest binding regression: exclusion request does not locally mutate digest or unblock session", () => {
  const originalDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
  const sessionWithBlocked = createMockSession({
    summary: {
      totalSkills: 2,
      totalFiles: 3,
      totalBytes: 3000,
      duplicateCount: 0,
      warningCount: 0,
      blockedCount: 1,
      excludedCount: 0,
      manifestDigest: originalDigest
    },
    skills: [
      {
        skillName: "good-skill",
        status: "ready",
        fileCount: 2,
        byteTotal: 2000,
        manifestDigest: "sha256:1",
        files: [],
        warnings: [],
        blockedReasons: [],
        excluded: false
      },
      {
        skillName: "bad-skill",
        status: "blocked",
        fileCount: 1,
        byteTotal: 1000,
        manifestDigest: "sha256:2",
        files: [],
        warnings: [],
        blockedReasons: ["FORBIDDEN_KEY_FILE"],
        excluded: false
      }
    ]
  });

  let state = getInitialImportState(sessionWithBlocked);
  assert.equal(state.viewState, "blocked");
  assert.equal(canApproveConsent(state), false);

  // Request exclusion on client
  state = importViewReducer(state, { type: "REQUEST_SKILL_EXCLUSION", skillName: "bad-skill" });
  assert.equal(state.pendingExclusionSkillNames.has("bad-skill"), true);

  // Repeated requests stay pending; the client cannot toggle the request away.
  state = importViewReducer(state, { type: "REQUEST_SKILL_EXCLUSION", skillName: "bad-skill" });
  assert.equal(state.pendingExclusionSkillNames.has("bad-skill"), true);

  // P1: Client state MUST NOT mutate session totals, digest, or transition to ready_for_consent
  assert.equal(state.viewState, "blocked");
  assert.equal(state.session.summary.manifestDigest, originalDigest);
  assert.equal(state.session.summary.blockedCount, 1);
  assert.equal(canApproveConsent(state), false);

  // Only when the server issues a fresh projection with updated digest does state update
  const updatedServerProjection = {
    ...sessionWithBlocked,
    summary: {
      totalSkills: 1,
      totalFiles: 2,
      totalBytes: 2000,
      duplicateCount: 0,
      warningCount: 0,
      blockedCount: 0,
      excludedCount: 1,
      manifestDigest: "sha256:new_server_manifest_digest_without_bad_skill"
    },
    skills: [
      {
        skillName: "good-skill",
        status: "ready",
        fileCount: 2,
        byteTotal: 2000,
        manifestDigest: "sha256:1",
        files: [],
        warnings: [],
        blockedReasons: [],
        excluded: false
      },
      {
        skillName: "bad-skill",
        status: "blocked",
        fileCount: 1,
        byteTotal: 1000,
        manifestDigest: "sha256:2",
        files: [],
        warnings: [],
        blockedReasons: ["FORBIDDEN_KEY_FILE"],
        excluded: true
      }
    ],
    state: "preview"
  };

  state = importViewReducer(state, { type: "SET_SESSION", projection: updatedServerProjection });
  assert.equal(state.pendingExclusionSkillNames.size, 0);
  assert.equal(state.viewState, "preview");
  assert.equal(state.session.summary.manifestDigest, "sha256:new_server_manifest_digest_without_bad_skill");
  assert.equal(state.session.summary.totalSkills, 1);
});

test("view-state: reducer manages consent flow, modal states, and receipt delivery", () => {
  const session = createMockSession({ state: "ready_for_consent" });
  let state = getInitialImportState(session);
  assert.equal(state.viewState, "ready_for_consent");
  assert.equal(canApproveConsent(state), true);

  // Open modal
  state = importViewReducer(state, { type: "OPEN_CONSENT_MODAL" });
  assert.equal(state.isConsentModalOpen, true);

  // Close modal
  state = importViewReducer(state, { type: "CLOSE_CONSENT_MODAL" });
  assert.equal(state.isConsentModalOpen, false);

  // Start consent submission
  state = importViewReducer(state, { type: "START_CONSENT_SUBMISSION" });
  assert.equal(state.isSubmittingConsent, true);
  assert.equal(state.viewState, "consented");

  // Consent success
  const receipt = {
    receiptId: "rcpt_0123456789abcdef0123456789abcdef",
    sessionId: session.sessionId,
    deviceId: "dev_1",
    manifestDigest: "sha256:1111",
    verificationDigest: "sha256:2222",
    eligibleSkillCount: 2,
    issuedAt: "2026-08-20T03:00:00Z",
    expiresAt: "2026-08-20T03:30:00Z"
  };
  state = importViewReducer(state, { type: "CONSENT_SUCCESS", receipt });
  assert.equal(state.isSubmittingConsent, false);
  assert.equal(state.viewState, "cutover_ready");
  assert.equal(state.receipt.receiptId, "rcpt_0123456789abcdef0123456789abcdef");
  assert.equal(state.receipt.eligibleSkillCount, 2);
});

test("view-state: reducer manages upload progress and interruption", () => {
  let state = getInitialImportState(createMockSession());
  assert.equal(state.viewState, "preview");

  // Start upload
  state = importViewReducer(state, { type: "START_UPLOAD" });
  assert.equal(state.viewState, "uploading");

  // Update progress
  state = importViewReducer(state, {
    type: "UPDATE_UPLOAD_PROGRESS",
    progress: {
      acceptedFileCount: 2,
      acceptedByteTotal: 4096,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 50
    }
  });
  assert.equal(state.viewState, "uploading");
  assert.equal(state.session.uploadProgress.percentComplete, 50);

  // Interruption
  state = importViewReducer(state, { type: "UPLOAD_INTERRUPTED" });
  assert.equal(state.viewState, "partial");
  assert.equal(canResumeUpload(state), true);

  // 100% completion
  state = importViewReducer(state, {
    type: "UPDATE_UPLOAD_PROGRESS",
    progress: {
      acceptedFileCount: 4,
      acceptedByteTotal: 8192,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 100
    }
  });
  assert.equal(state.viewState, "ready_for_consent");
});

test("view-state: upload completion cannot bypass active server blockers", () => {
  const blockedSession = createMockSession({
    state: "uploading",
    skills: [
      {
        ...createMockSession().skills[0],
        status: "blocked",
        blockedReasons: ["IMPORT_SECRET_BLOCKED"]
      }
    ]
  });
  let state = getInitialImportState(blockedSession);
  assert.equal(state.viewState, "blocked");

  state = importViewReducer(state, {
    type: "UPDATE_UPLOAD_PROGRESS",
    progress: {
      acceptedFileCount: 4,
      acceptedByteTotal: 8192,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 100
    }
  });
  assert.equal(state.viewState, "blocked");

  state = importViewReducer(state, { type: "UPLOAD_COMPLETED" });
  assert.equal(state.viewState, "blocked");
});

test("view-state: copy and tone helpers map to all 10 states with accurate cutover descriptions", () => {
  const allStates = [
    "idle",
    "preview",
    "uploading",
    "partial",
    "blocked",
    "ready_for_consent",
    "consented",
    "cutover_ready",
    "stale",
    "error"
  ];

  for (const s of allStates) {
    const tone = getStateBadgeTone(s);
    assert.ok(typeof tone === "string" && tone.length > 0);

    const title = getStateTitle(s);
    assert.ok(typeof title === "string" && title.length > 0);

    const desc = getStateDescription(s);
    assert.ok(typeof desc === "string" && desc.length > 0);

    const announcement = getStateAriaAnnouncement(s);
    assert.ok(announcement.includes(title));
  }

  // P2 copy assertion: cutover_ready states cloud parity is verified and cutover is authorized
  const cutoverDesc = getStateDescription("cutover_ready");
  assert.ok(cutoverDesc.includes("Cloud parity is verified"));
  assert.ok(cutoverDesc.includes("cutover is authorized"));
});

test("view-state: capabilities are strictly mapped to states", () => {
  const idle = getInitialImportState(null);
  assert.equal(canCancelSession(idle), false);
  assert.equal(canRetry(idle), false);
  assert.equal(canResumeUpload(idle), false);
  assert.equal(canApproveConsent(idle), false);

  const errorState = importViewReducer(idle, { type: "SET_ERROR", error: "Test error" });
  assert.equal(canRetry(errorState), true);
  assert.equal(canCancelSession(errorState), false);

  const staleState = importViewReducer(idle, { type: "MARK_STALE" });
  assert.equal(canRetry(staleState), true);
});

test("view-state: reducer handles SELECT_SKILL, RESET, and invalid transitions", () => {
  const session = createMockSession();
  let state = getInitialImportState(session);

  // Select skill
  state = importViewReducer(state, { type: "SELECT_SKILL", skillName: "doc-generator" });
  assert.equal(state.selectedSkillName, "doc-generator");

  // Invalid transition attempt
  state = importViewReducer(state, { type: "SET_STATE", state: "cutover_ready" });
  assert.equal(state.viewState, "preview"); // Blocked!

  // Reset
  state = importViewReducer(state, { type: "RESET" });
  assert.equal(state.viewState, "idle");
  assert.equal(state.session, null);
});

test("view-state: canApproveConsent returns false when all skills are excluded on server", () => {
  const session = createMockSession({
    state: "ready_for_consent",
    skills: [
      {
        skillName: "skill-1",
        status: "ready",
        fileCount: 1,
        byteTotal: 100,
        manifestDigest: "sha256:1",
        files: [],
        warnings: [],
        blockedReasons: [],
        excluded: true
      }
    ]
  });
  const state = getInitialImportState(session);
  assert.equal(canApproveConsent(state), false);
});

test("view-state: terminal stale session with accepted progress derives stale before progress states", () => {
  const staleSession = createMockSession({
    state: "stale",
    uploadProgress: {
      acceptedFileCount: 4,
      acceptedByteTotal: 8192,
      expectedFileCount: 4,
      expectedByteTotal: 8192,
      percentComplete: 100
    }
  });

  // A session whose server state is stale must not regress to ready_for_consent
  // just because all upload bytes have already been accepted.
  assert.equal(deriveImportViewState(staleSession), "stale");

  const state = getInitialImportState(staleSession);
  assert.equal(state.viewState, "stale");
  assert.equal(canRetry(state), true);
});
