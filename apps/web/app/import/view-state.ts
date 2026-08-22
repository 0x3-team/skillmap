/**
 * M4.10: Pure Import View-State Machine and Reducer.
 * Governs the 10 exhaustive states of the Import Review & Consent Seam:
 * idle, preview, uploading, partial, blocked, ready_for_consent, consented, cutover_ready, stale, error.
 *
 * Manifest Binding Rule: Client state never locally recomputes totals, mutates
 * the manifest digest, or moves from blocked to ready_for_consent. Skill exclusions
 * and manifest revisions are strictly server-bound.
 */

import {
  type CutoverReceipt,
  type ImportSessionProjection,
  type ImportUploadProgress,
  type ImportViewStateKind
} from "@/lib/import/contracts.ts";

export interface ImportClientState {
  viewState: ImportViewStateKind;
  session: ImportSessionProjection | null;
  pendingExclusionSkillNames: Set<string>;
  selectedSkillName: string | null;
  isConsentModalOpen: boolean;
  isSubmittingConsent: boolean;
  error: { message: string; code?: string } | null;
  receipt: CutoverReceipt | null;
}

export type ImportClientAction =
  | { type: "SET_SESSION"; projection: ImportSessionProjection | null }
  | { type: "SET_STATE"; state: ImportViewStateKind }
  | { type: "REQUEST_SKILL_EXCLUSION"; skillName: string }
  | { type: "SKILL_EXCLUSION_FAILED"; skillName: string }
  | { type: "SELECT_SKILL"; skillName: string | null }
  | { type: "OPEN_CONSENT_MODAL" }
  | { type: "CLOSE_CONSENT_MODAL" }
  | { type: "START_CONSENT_SUBMISSION" }
  | { type: "CONSENT_RECORDED" }
  | { type: "CONSENT_SUCCESS"; receipt: CutoverReceipt }
  | { type: "CONSENT_FAILURE"; error: string; code?: string }
  | { type: "START_UPLOAD" }
  | { type: "UPDATE_UPLOAD_PROGRESS"; progress: ImportUploadProgress }
  | { type: "UPLOAD_INTERRUPTED"; progress?: ImportUploadProgress }
  | { type: "UPLOAD_COMPLETED" }
  | { type: "MARK_STALE"; reason?: string }
  | { type: "SET_ERROR"; error: string; code?: string }
  | { type: "RESET" };

/** Valid state transition map ensuring safe deterministic progression. */
const ALLOWED_TRANSITIONS: Record<ImportViewStateKind, readonly ImportViewStateKind[]> = {
  idle: ["preview", "error"],
  preview: ["uploading", "blocked", "ready_for_consent", "stale", "error", "idle"],
  uploading: ["partial", "ready_for_consent", "blocked", "stale", "error", "idle"],
  partial: ["uploading", "stale", "error", "idle"],
  blocked: ["preview", "ready_for_consent", "stale", "error", "idle"],
  ready_for_consent: ["consented", "stale", "error", "idle"],
  consented: ["cutover_ready", "error", "stale"],
  cutover_ready: ["idle", "error"],
  stale: ["idle", "preview", "error"],
  error: ["idle", "preview", "stale"]
};

/** Checks whether transitioning from one state to another is permitted. */
export function isValidStateTransition(from: ImportViewStateKind, to: ImportViewStateKind): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Derives the computed view state from a server projection and current facts. */
export function deriveImportViewState(
  session: ImportSessionProjection | null,
  options: {
    isExpired?: boolean;
    hasError?: boolean;
    isConsenting?: boolean;
  } = {}
): ImportViewStateKind {
  if (options.hasError) return "error";
  if (!session) return "idle";
  if (options.isExpired) return "stale";
  if (options.isConsenting) return "consented";

  // If the session has a cutover receipt, it's cutover_ready
  if (session.cutoverReceipt) return "cutover_ready";

  // Consent is authoritative once the server has recorded it. Upload totals
  // may remain at 100% after consent, so they must not move the view backward.
  if (session.state === "consented") return "consented";

  // A terminal stale session is authoritative; accepted upload progress or
  // active blockers must not mask it.
  if (session.state === "stale") return "stale";

  // Check for blocked items in the server projection
  const hasBlocked = session.skills.some(
    (s) => !s.excluded && (s.status === "blocked" || s.blockedReasons.length > 0)
  );
  if (hasBlocked) return "blocked";

  // Check upload progress
  if (session.uploadProgress) {
    const { acceptedFileCount, expectedFileCount } = session.uploadProgress;
    if (acceptedFileCount > 0 && acceptedFileCount < expectedFileCount) {
      return session.state === "uploading" ? "uploading" : "partial";
    }
    if (acceptedFileCount >= expectedFileCount && expectedFileCount > 0) {
      return "ready_for_consent";
    }
  }

  // Explicit session state fallback
  return session.state;
}

/** Creates the initial client state from a server projection. */
export function getInitialImportState(
  initialProjection: ImportSessionProjection | null = null
): ImportClientState {
  const viewState = deriveImportViewState(initialProjection);

  return {
    viewState,
    session: initialProjection,
    pendingExclusionSkillNames: new Set<string>(),
    selectedSkillName: initialProjection?.skills[0]?.skillName ?? null,
    isConsentModalOpen: false,
    isSubmittingConsent: false,
    error: initialProjection?.errorMessage
      ? { message: initialProjection.errorMessage, code: initialProjection.errorCode }
      : null,
    receipt: initialProjection?.cutoverReceipt ?? null
  };
}

/** Pure state machine reducer for the import review client surface. */
export function importViewReducer(
  state: ImportClientState,
  action: ImportClientAction
): ImportClientState {
  switch (action.type) {
    case "SET_SESSION": {
      const session = action.projection;
      const viewState = deriveImportViewState(session);
      return {
        ...state,
        session,
        viewState,
        pendingExclusionSkillNames: new Set<string>(),
        selectedSkillName: session?.skills[0]?.skillName ?? state.selectedSkillName,
        error: session?.errorMessage ? { message: session.errorMessage, code: session.errorCode } : null,
        receipt: session?.cutoverReceipt ?? null
      };
    }

    case "SET_STATE": {
      if (!isValidStateTransition(state.viewState, action.state)) {
        return state;
      }
      return {
        ...state,
        viewState: action.state
      };
    }

    case "REQUEST_SKILL_EXCLUSION": {
      // Manifest binding security rule (M4.04/M4.10):
      // The client must NEVER locally recompute totals, mutate the manifest digest,
      // or transition out of blocked state. Skill exclusion is a request to the server;
      // state and manifest digest remain bound to the server projection until a fresh
      // server projection is supplied via SET_SESSION.
      const nextPending = new Set(state.pendingExclusionSkillNames);
      nextPending.add(action.skillName);

      return {
        ...state,
        pendingExclusionSkillNames: nextPending
      };
    }

    case "SKILL_EXCLUSION_FAILED": {
      const nextPending = new Set(state.pendingExclusionSkillNames);
      nextPending.delete(action.skillName);
      return {
        ...state,
        pendingExclusionSkillNames: nextPending
      };
    }

    case "SELECT_SKILL":
      return {
        ...state,
        selectedSkillName: action.skillName
      };

    case "OPEN_CONSENT_MODAL":
      return {
        ...state,
        isConsentModalOpen: true
      };

    case "CLOSE_CONSENT_MODAL":
      return {
        ...state,
        isConsentModalOpen: false
      };

    case "START_CONSENT_SUBMISSION":
      return {
        ...state,
        isSubmittingConsent: true,
        isConsentModalOpen: false,
        viewState: "consented"
      };

    case "CONSENT_SUCCESS":
      return {
        ...state,
        isSubmittingConsent: false,
        receipt: action.receipt,
        viewState: "cutover_ready"
      };

    case "CONSENT_RECORDED":
      return {
        ...state,
        isSubmittingConsent: false,
        error: null,
        viewState: "consented"
      };

    case "CONSENT_FAILURE":
      return {
        ...state,
        isSubmittingConsent: false,
        error: { message: action.error, code: action.code },
        viewState: "ready_for_consent"
      };

    case "START_UPLOAD":
      return {
        ...state,
        viewState: "uploading"
      };

    case "UPDATE_UPLOAD_PROGRESS": {
      if (!state.session) return state;
      const updatedSession: ImportSessionProjection = {
        ...state.session,
        uploadProgress: action.progress
      };
      const derivedState = deriveImportViewState(updatedSession);
      return {
        ...state,
        session: updatedSession,
        viewState: derivedState === "partial" && state.viewState === "uploading"
          ? "uploading"
          : derivedState
      };
    }

    case "UPLOAD_INTERRUPTED": {
      if (!state.session) return state;
      const updatedSession: ImportSessionProjection = action.progress
        ? { ...state.session, uploadProgress: action.progress }
        : state.session;
      return {
        ...state,
        session: updatedSession,
        viewState: "partial"
      };
    }

    case "UPLOAD_COMPLETED": {
      return {
        ...state,
        viewState: deriveImportViewState(state.session)
      };
    }

    case "MARK_STALE":
      return {
        ...state,
        viewState: "stale",
        error: action.reason ? { message: action.reason, code: "SESSION_EXPIRED" } : state.error
      };

    case "SET_ERROR":
      return {
        ...state,
        viewState: "error",
        error: { message: action.error, code: action.code }
      };

    case "RESET":
      return getInitialImportState(null);

    default:
      return state;
  }
}

/** Returns the design system tone for a given view state badge. */
export function getStateBadgeTone(
  state: ImportViewStateKind
): "neutral" | "info" | "success" | "warning" | "danger" | "loading" {
  switch (state) {
    case "idle":
      return "neutral";
    case "preview":
      return "info";
    case "uploading":
    case "consented":
      return "loading";
    case "partial":
    case "stale":
      return "warning";
    case "blocked":
    case "error":
      return "danger";
    case "ready_for_consent":
    case "cutover_ready":
      return "success";
  }
}

/** Human-readable title for each state. */
export function getStateTitle(state: ImportViewStateKind): string {
  switch (state) {
    case "idle":
      return "No Active Import Session";
    case "preview":
      return "Review Import Manifest";
    case "uploading":
      return "Uploading Skill Blobs";
    case "partial":
      return "Import Upload Interrupted";
    case "blocked":
      return "Blocked Items Detected";
    case "ready_for_consent":
      return "Ready for Activation Consent";
    case "consented":
      return "Issuing Cutover Authorization";
    case "cutover_ready":
      return "Cloud Cutover Authorized";
    case "stale":
      return "Import Session Expired";
    case "error":
      return "Import Unavailable";
  }
}

/** Scannable description for each state. */
export function getStateDescription(state: ImportViewStateKind): string {
  switch (state) {
    case "idle":
      return "Run `skillmap import` in your local terminal to discover local skills and create an import session.";
    case "preview":
      return "Inspect the discovered skills, file counts, and sizes before uploading to your private vault.";
    case "uploading":
      return "Securely transferring encrypted blobs to private cloud storage. Do not close your terminal.";
    case "partial":
      return "Previous upload was interrupted. You can resume uploading remaining files or cancel this session.";
    case "blocked":
      return "Canary secrets or forbidden private files were detected. Exclude the blocked skills to proceed.";
    case "ready_for_consent":
      return "All staged files match the cloud manifest. Authorize this exact revision for finalization and local rescan.";
    case "consented":
      return "Cloud authorization is recorded. Your connector must finalize and rescan before local quarantine.";
    case "cutover_ready":
      return "Cloud parity is verified and cutover is authorized. Return to your terminal for the connector to complete local quarantine.";
    case "stale":
      return "This import session has expired or the manifest revision changed. Please re-run the CLI scanner.";
    case "error":
      return "A service or database error occurred. Your local skills remain unchanged and secure.";
  }
}

/** Accessible live-region announcement text for state transitions. */
export function getStateAriaAnnouncement(state: ImportViewStateKind): string {
  return `${getStateTitle(state)}. ${getStateDescription(state)}`;
}

/** Whether the consent action button can be triggered. */
export function canApproveConsent(state: ImportClientState): boolean {
  if (state.viewState !== "ready_for_consent") return false;
  if (!state.session || state.session.skills.length === 0) return false;
  // Cannot consent if any active (non-excluded) skill is blocked in the server session
  const hasBlockedActiveSkills = state.session.skills.some(
    (s) => !s.excluded && (s.status === "blocked" || s.blockedReasons.length > 0)
  );
  if (hasBlockedActiveSkills) return false;
  // Must have at least one non-excluded skill
  const nonExcludedCount = state.session.skills.filter((s) => !s.excluded).length;
  return nonExcludedCount > 0;
}

/** Whether upload can be resumed. */
export function canResumeUpload(state: ImportClientState): boolean {
  return state.viewState === "partial";
}

/** Whether the session can be safely canceled. */
export function canCancelSession(state: ImportClientState): boolean {
  return (
    state.viewState === "preview" ||
    state.viewState === "uploading" ||
    state.viewState === "partial" ||
    state.viewState === "blocked" ||
    state.viewState === "ready_for_consent"
  );
}

/** Whether a retry is available. */
export function canRetry(state: ImportClientState): boolean {
  return state.viewState === "error" || state.viewState === "stale";
}
