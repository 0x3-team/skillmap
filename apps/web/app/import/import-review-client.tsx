"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  HardDrive,
  Laptop,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  Terminal,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useId, useReducer, useRef, useState } from "react";
import {
  canApproveConsent,
  getInitialImportState,
  getStateAriaAnnouncement,
  getStateBadgeTone,
  getStateDescription,
  importViewReducer,
  type ImportClientAction,
  type ImportClientState
} from "./view-state.ts";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import { Button, StatefulButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/number";
import {
  formatByteSize,
  type CutoverReceipt,
  type ImportSessionProjection,
  type ImportSkillPreviewItem,
  type ImportViewStateKind
} from "@/lib/import/contracts.ts";
import { cn } from "@/lib/utils";
import { submitImportConsent } from "@/lib/import/consent-submission.ts";

export interface ImportReviewClientProps {
  /** Previously sanitized, dashboard-safe import session projection. */
  initialProjection?: ImportSessionProjection | null;
  /** Bounded server-side dashboard load failure. */
  initialError?: { message: string; code: string };
  notice?: { tone: "error" | "warning" | "success"; message: string };
  stateOverride?: ImportViewStateKind;
  onConsentAction?: (formData: FormData) => void | Promise<void>;
  onRequestExclusionAction?: (skillName: string) => void | Promise<void>;
  onRetryAction?: () => void | Promise<void>;
  isPending?: boolean;
}

const MANAGED_IMPORT_COMMAND = "skillmap import vault <skill-path>";
const CLI_RECOVERY_MESSAGE = "This browser cannot resume or cancel device-auth sessions.";

export function ImportReviewClient({
  initialProjection = null,
  initialError,
  notice,
  stateOverride,
  onConsentAction,
  onRequestExclusionAction,
  onRetryAction,
  isPending = false
}: ImportReviewClientProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    importViewReducer,
    { initialProjection, initialError },
    ({ initialProjection: projection, initialError: error }) => {
      const initial = getInitialImportState(projection);
      return error
        ? { ...initial, viewState: "error" as const, error }
        : initial;
    }
  );

  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Sync state override if supplied from server/testing
  useEffect(() => {
    if (stateOverride && stateOverride !== state.viewState) {
      dispatch({ type: "SET_STATE", state: stateOverride });
    }
  }, [stateOverride, state.viewState]);

  // Sync fresh server projection when passed down from server parent
  useEffect(() => {
    if (initialProjection) {
      dispatch({ type: "SET_SESSION", projection: initialProjection });
    }
  }, [initialProjection]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopiedText(label);
        setTimeout(() => setCopiedText(null), 2000);
      }
    } catch {
      // Ignore clipboard write failures gracefully
    }
  };

  const currentViewState = stateOverride ?? state.viewState;
  const session = state.session;
  const selectedSkill = session?.skills.find(
    (s) => s.skillName === state.selectedSkillName
  ) ?? session?.skills[0] ?? null;

  const badgeTone = getStateBadgeTone(currentViewState);
  const description = getStateDescription(currentViewState);
  const ariaAnnouncement = getStateAriaAnnouncement(currentViewState);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 outline-none"
    >
      {/* Accessible live region announcement */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {ariaAnnouncement}
      </div>

      {/* Header section */}
      <header className="border-b border-border pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Import Review & Cutover
              </h1>
              <AnimatedBadge tone={badgeTone} size="md" pulse={badgeTone === "loading"}>
                {currentViewState.replace(/_/g, " ")}
              </AnimatedBadge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          </div>

          {session ? (
            <div className="flex flex-wrap items-center gap-2 self-start text-xs text-muted-foreground sm:self-auto">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 font-mono">
                <Laptop className="h-3.5 w-3.5" />
                {session.device.name}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 font-mono">
                <HardDrive className="h-3.5 w-3.5" />
                {session.sessionId.slice(0, 12)}…
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-6 rounded-xl border p-4 text-sm leading-6 ${
            notice.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : notice.tone === "warning"
                ? "border-warning/35 bg-warning/10 text-foreground"
                : "border-success/30 bg-success/10 text-foreground"
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {/* Main Viewport Content based on 10 States */}
      <div className="mt-8">
        {currentViewState === "idle" && (
          <IdleStateView onCopy={(text) => copyToClipboard(text, "cmd")} copied={copiedText === "cmd"} />
        )}

        {currentViewState === "error" && (
          <ErrorStateView
            error={state.error?.message ?? session?.errorMessage ?? "An unexpected error occurred during import."}
            code={state.error?.code ?? session?.errorCode}
            onRetry={onRetryAction}
            isPending={isPending}
          />
        )}

        {currentViewState === "stale" && (
          <StaleStateView isPending={isPending} />
        )}

        {currentViewState === "cutover_ready" && (
          <CutoverReadyView
            receipt={state.receipt ?? session?.cutoverReceipt ?? null}
            onCopy={copyToClipboard}
            copiedLabel={copiedText}
          />
        )}

        {(currentViewState === "preview" ||
          currentViewState === "uploading" ||
          currentViewState === "partial" ||
          currentViewState === "blocked" ||
          currentViewState === "ready_for_consent" ||
          currentViewState === "consented") &&
          session && (
            <ActiveSessionView
              state={state}
              currentViewState={currentViewState}
              session={session}
              selectedSkill={selectedSkill}
              dispatch={dispatch}
              onRequestExclusionAction={onRequestExclusionAction}
              onCopy={copyToClipboard}
              copiedLabel={copiedText}
              isPending={isPending}
              consentActionAvailable={typeof onConsentAction === "function"}
            />
          )}
      </div>

      {/* Accessible Consent Confirmation Modal Dialog */}
      {state.isConsentModalOpen && session && (
        <ConsentConfirmationDialog
          session={session}
          onClose={() => dispatch({ type: "CLOSE_CONSENT_MODAL" })}
          onConfirm={(formData) => {
            dispatch({ type: "START_CONSENT_SUBMISSION" });
            void submitImportConsent(onConsentAction, formData).then((result) => {
              if (result.ok) {
                dispatch({ type: "CONSENT_RECORDED" });
                router.refresh();
                return;
              }
              dispatch({ type: "CONSENT_FAILURE", error: result.error, code: result.code });
            });
          }}
          isSubmitting={state.isSubmittingConsent || isPending}
        />
      )}
    </main>
  );
}

/** 1. Idle State View: instructions to invoke `skillmap import` via terminal connector. */
function IdleStateView({
  onCopy,
  copied
}: {
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  const cliCommand = MANAGED_IMPORT_COMMAND;

  return (
    <Card className="mx-auto max-w-2xl border-border bg-card p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <Terminal className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-foreground sm:text-2xl">
          Start an Import from Your Terminal
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          SkillMap discovered no active import session for this device. Run the local-first CLI
          command to scan, doctor, and stage your skills safely.
        </p>

        <div className="mt-6 flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-muted/80 px-4 py-3">
          <code className="font-mono text-sm font-semibold text-foreground">
            {cliCommand}
          </code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(cliCommand)}
            aria-label="Copy CLI import command"
            className="h-8 gap-1.5 px-2.5 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-500">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </Button>
        </div>

        <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-3.5">
            <span className="text-xs font-semibold text-primary">1. Local Scan</span>
            <p className="mt-1 text-xs text-muted-foreground">
              Discovers approved local skills without uploading secret files.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <span className="text-xs font-semibold text-primary">2. Cloud Review</span>
            <p className="mt-1 text-xs text-muted-foreground">
              Verify manifests and counts safely here in the dashboard.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <span className="text-xs font-semibold text-primary">3. Cutover</span>
            <p className="mt-1 text-xs text-muted-foreground">
              Local connector securely migrates skills upon verified receipt.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** 2. Error State View: clean, privacy-safe error container. */
function ErrorStateView({
  error,
  code,
  onRetry,
  isPending
}: {
  error: string;
  code?: string;
  onRetry?: () => void | Promise<void>;
  isPending: boolean;
}) {
  const router = useRouter();

  return (
    <Card className="mx-auto max-w-xl border-destructive/30 bg-destructive/5 p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-foreground">Import Error</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
        {code ? (
          <span className="mt-3 inline-block rounded border border-border bg-muted px-2.5 py-0.5 font-mono text-xs text-foreground">
            Error code: {code}
          </span>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {onRetry ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => void onRetry()}
              disabled={isPending}
              icon={isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            >
              {isPending ? "Retrying…" : "Retry Import"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/")}
          >
            Return to Dashboard
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 3. Stale / Expired State View. */
function StaleStateView({
  isPending
}: {
  isPending: boolean;
}) {
  const router = useRouter();

  return (
    <Card className="mx-auto max-w-xl border-amber-500/30 bg-amber-500/5 p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Clock className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-foreground">Session Stale or Expired</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This import session has expired or the manifest revision changed in another session.
          Your local skills are safe. Please re-run or refresh to load the latest state.
        </p>

        <div className="mt-6">
          <Button
            variant="primary"
            size="md"
            onClick={() => router.refresh()}
            disabled={isPending}
            icon={isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          >
            {isPending ? "Refreshing…" : "Refresh & Rescan"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 4. Cutover Ready View (M4.11): displays cutover receipt details & terminal guidance. */
function CutoverReadyView({
  receipt,
  onCopy,
  copiedLabel
}: {
  receipt: CutoverReceipt | null;
  onCopy: (text: string, label: string) => void;
  copiedLabel: string | null;
}) {
  return (
    <div className="space-y-6">
      <Card className="border-emerald-500/30 bg-emerald-500/5 p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground">
            Cloud Cutover Authorized
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Cloud parity is verified and cutover is authorized. An immutable cutover receipt
            has been issued for your local connector.
          </p>
        </div>

        {receipt ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cutover Receipt Details
            </h3>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Receipt ID</dt>
                <dd className="mt-1 flex items-center gap-2 font-mono text-xs font-medium text-foreground">
                  <span className="truncate">{receipt.receiptId}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(receipt.receiptId, "rcpt")}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Copy receipt ID"
                  >
                    {copiedLabel === "rcpt" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">Eligible Skills</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {receipt.eligibleSkillCount} skill{receipt.eligibleSkillCount === 1 ? "" : "s"}
                </dd>
              </div>

              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Verification Digest</dt>
                <dd className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {receipt.verificationDigest}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-border bg-muted/60 p-4">
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="text-sm leading-6">
              <span className="font-semibold text-foreground">Next Step:</span>{" "}
              <span className="text-muted-foreground">
                {getStateDescription("cutover_ready")}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Active Session View: Metrics, Blocked alerts, Progress bars, Skills table, Action bar. */
function ActiveSessionView({
  state,
  currentViewState,
  session,
  selectedSkill,
  dispatch,
  onRequestExclusionAction,
  onCopy,
  copiedLabel,
  isPending,
  consentActionAvailable
}: {
  state: ImportClientState;
  currentViewState: ImportViewStateKind;
  session: ImportSessionProjection;
  selectedSkill: ImportSkillPreviewItem | null;
  dispatch: React.Dispatch<ImportClientAction>;
  onRequestExclusionAction?: (skillName: string) => void | Promise<void>;
  onCopy: (text: string, label: string) => void;
  copiedLabel: string | null;
  isPending: boolean;
  consentActionAvailable: boolean;
}) {
  const summary = session.summary;
  const isBlocked = currentViewState === "blocked" || summary.blockedCount > 0;
  const isUploading = currentViewState === "uploading";
  const isPartial = currentViewState === "partial";
  const isReadyForConsent = currentViewState === "ready_for_consent";
  const isConsented = currentViewState === "consented";
  const needsCliRecovery = currentViewState === "preview"
    || currentViewState === "partial"
    || currentViewState === "ready_for_consent";

  return (
    <div className="space-y-6">
      {/* State-specific Banners */}
      {isBlocked && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/35 bg-destructive/10 p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                Blocked Items Detected ({summary.blockedCount})
              </h2>
              <p className="text-xs leading-5 text-muted-foreground">
                Canary secrets, private keys, or disallowed extensions were detected. You cannot
                force-upload blocked classes. Return to the CLI to exclude blocked skills, rebuild
                the manifest, and retry this import.
              </p>
            </div>
          </div>
        </div>
      )}

      {isPartial && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Upload Interrupted
                </h2>
                <p className="text-xs text-muted-foreground">
                  {session.uploadProgress?.acceptedFileCount ?? 0} of{" "}
                  {session.uploadProgress?.expectedFileCount ?? summary.totalFiles} files
                  transferred. Return to the CLI to safely resume this upload with device proof.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.error && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.error.message}
        </p>
      )}

      {isReadyForConsent && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                All Files Staged & Verified
              </h2>
              <p className="text-xs text-muted-foreground">
                All staged files match the cloud manifest. Authorize this exact revision so your
                connector can finalize it, rescan local files, and issue the cutover receipt.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Metrics Grid */}
      <section aria-label="Import summary metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Total Skills</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            <AnimatedNumber value={summary.totalSkills} />
          </p>
          {summary.excludedCount > 0 ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {summary.excludedCount} excluded
            </span>
          ) : null}
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Total Files</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            <AnimatedNumber value={summary.totalFiles} />
          </p>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Total Size</span>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {formatByteSize(summary.totalBytes)}
          </p>
        </Card>

        <Card className="p-4">
          <span className="text-xs font-medium text-muted-foreground">Manifest Digest</span>
          <p className="mt-1 truncate font-mono text-xs text-foreground">
            {summary.manifestDigest.slice(0, 16)}…
          </p>
          <button
            type="button"
            onClick={() => onCopy(summary.manifestDigest, "digest")}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            aria-label="Copy full manifest digest"
          >
            {copiedLabel === "digest" ? "Copied" : "Copy Digest"}
          </button>
        </Card>
      </section>

      {/* Upload Progress Bar if in uploading or partial */}
      {(isUploading || isPartial) && session.uploadProgress && (
        <Card className="p-5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground">Transfer Progress</span>
            <span className="font-mono text-muted-foreground">
              {session.uploadProgress.percentComplete}% (
              {formatByteSize(session.uploadProgress.acceptedByteTotal)} /{" "}
              {formatByteSize(session.uploadProgress.expectedByteTotal)})
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-all duration-300",
                isPartial ? "bg-amber-500" : "bg-primary"
              )}
              style={{ width: `${session.uploadProgress.percentComplete}%` }}
              role="progressbar"
              aria-valuenow={session.uploadProgress.percentComplete}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </Card>
      )}

      {/* Two-Column Grid: Skills List + Skill Detail Inspector */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Skill Inventory Table */}
        <section
          aria-labelledby="skills-inventory-heading"
          className="space-y-3 lg:col-span-7"
        >
          <div className="flex items-center justify-between">
            <h2 id="skills-inventory-heading" className="text-base font-semibold text-foreground">
              Discovered Skills ({session.skills.length})
            </h2>
            <span className="text-xs text-muted-foreground">
              Select items to inspect or exclude
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border" role="list">
              {session.skills.map((skill) => {
                const isSelected = selectedSkill?.skillName === skill.skillName;
                const isExcluded = Boolean(skill.excluded);
                const isSkillBlocked = skill.status === "blocked" || skill.blockedReasons.length > 0;

                return (
                  <li
                    key={skill.skillName}
                    className={cn(
                      "flex items-center justify-between gap-3 p-3.5 transition-colors sm:p-4",
                      isSelected ? "bg-accent/40" : "hover:bg-muted/40",
                      isExcluded && "opacity-60 bg-muted/20"
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer bg-transparent text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={() => dispatch({ type: "SELECT_SKILL", skillName: skill.skillName })}
                      aria-pressed={isSelected}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "font-mono text-sm font-semibold truncate",
                            isExcluded ? "line-through text-muted-foreground" : "text-foreground"
                          )}
                        >
                          {skill.skillName}
                        </span>

                        <AnimatedBadge
                          tone={
                            isSkillBlocked
                              ? "danger"
                              : skill.status === "warning"
                                ? "warning"
                                : skill.isDuplicate
                                  ? "neutral"
                                  : "success"
                          }
                          size="sm"
                        >
                          {isSkillBlocked
                            ? "Blocked"
                            : skill.status === "warning"
                              ? "Warning"
                              : skill.isDuplicate
                                ? "Duplicate"
                                : "Ready"}
                        </AnimatedBadge>
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{skill.fileCount} files</span>
                        <span>•</span>
                        <span>{formatByteSize(skill.byteTotal)}</span>
                        {skill.sourceType ? (
                          <>
                            <span>•</span>
                            <span className="capitalize">{skill.sourceType}</span>
                          </>
                        ) : null}
                      </div>
                    </button>

                    {/* Exclude Checkbox */}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          disabled={isExcluded || !onRequestExclusionAction || state.pendingExclusionSkillNames.has(skill.skillName)}
                          onChange={(event) => {
                            if (event.currentTarget.checked || !onRequestExclusionAction) return;
                            dispatch({
                              type: "REQUEST_SKILL_EXCLUSION",
                              skillName: skill.skillName
                            });
                            void Promise.resolve()
                              .then(() => onRequestExclusionAction(skill.skillName))
                              .catch(() => {
                                dispatch({
                                  type: "SKILL_EXCLUSION_FAILED",
                                  skillName: skill.skillName
                                });
                              });
                          }}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Include ${skill.skillName} in import`}
                        />
                        <span className="hidden sm:inline">
                          {isExcluded ? "Excluded" : "Include"}
                        </span>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Right Column: Selected Skill Details Inspector */}
        <section
          aria-labelledby="skill-details-heading"
          className="space-y-3 lg:col-span-5"
        >
          <h2 id="skill-details-heading" className="text-base font-semibold text-foreground">
            Manifest Inspector
          </h2>

          {selectedSkill ? (
            <Card className="p-5">
              <div className="flex items-start justify-between gap-2 border-b border-border pb-4">
                <div>
                  <h3 className="font-mono text-base font-semibold text-foreground">
                    {selectedSkill.skillName}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedSkill.fileCount} files • {formatByteSize(selectedSkill.byteTotal)}
                  </p>
                </div>
                <AnimatedBadge
                  tone={
                    selectedSkill.status === "blocked" || selectedSkill.blockedReasons.length > 0
                      ? "danger"
                      : "info"
                  }
                  size="sm"
                >
                  {selectedSkill.status}
                </AnimatedBadge>
              </div>

              {/* Blocked reasons */}
              {selectedSkill.blockedReasons.length > 0 && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                  <span className="text-xs font-semibold text-destructive">
                    Blocked Reasons:
                  </span>
                  <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
                    {selectedSkill.blockedReasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {selectedSkill.warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Warnings:
                  </span>
                  <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">
                    {selectedSkill.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Relative Files Listing (Strictly Relative Paths Only) */}
              <div className="mt-4">
                <span className="text-xs font-medium text-muted-foreground">
                  Included Files (Safe Relative Paths)
                </span>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
                  {selectedSkill.files.map((file, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded bg-muted/60 px-2.5 py-1.5 text-xs font-mono"
                    >
                      <span className="truncate text-foreground">
                        {file.relativePath}
                      </span>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {formatByteSize(file.byteSize)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-xs text-muted-foreground">
              Select a skill from the list to view its files and validation status.
            </Card>
          )}
        </section>
      </div>

      {/* Sticky Bottom Action Bar */}
      <footer className="mt-8 flex flex-col-reverse gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {needsCliRecovery && (
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">
              To resume, return to the local terminal and run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {MANAGED_IMPORT_COMMAND}
              </code>{" "}
              again. To cancel, stop the local command and let the session expire. {CLI_RECOVERY_MESSAGE}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canApproveConsent(state) && (
            <Button
              variant="primary"
              size="md"
              onClick={() => dispatch({ type: "OPEN_CONSENT_MODAL" })}
              disabled={isPending || isConsented || !consentActionAvailable}
              title={consentActionAvailable ? undefined : "Consent is temporarily unavailable. Refresh and try again."}
              icon={isPending || isConsented ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            >
              {isConsented ? "Issuing Receipt…" : "Authorize Activation & Cutover"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Accessible Consent Confirmation Dialog enforcing keyboard trap, Escape dismissal, and exact form binding. */
export function ConsentConfirmationDialog({
  session,
  onClose,
  onConfirm,
  isSubmitting
}: {
  session: ImportSessionProjection;
  onClose: () => void;
  onConfirm: (formData: FormData) => void;
  isSubmitting: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  const activeSkills = session.skills.filter((s) => !s.excluded);

  // Trap focus and handle Escape key
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");

    const focusableElements = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");

    focusableElements()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const elements = focusableElements();
      if (elements.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onConfirm(formData);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-foreground">
                Authorize Cloud Cutover
              </h2>
              <p className="text-xs text-muted-foreground">
                Session: <span className="font-mono">{session.sessionId.slice(0, 16)}…</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close confirmation dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p id={descId} className="text-sm leading-6 text-muted-foreground">
          You are authorizing final verification for{" "}
          <strong className="text-foreground">{activeSkills.length} skill{activeSkills.length === 1 ? "" : "s"}</strong> (
          {formatByteSize(session.summary.totalBytes)}). This records approval for the exact session
          and manifest. Your connector must still finalize and rescan before it can issue a cutover receipt.
        </p>

        <div className="rounded-lg border border-border bg-muted/40 p-3 max-h-32 overflow-y-auto">
          <ul className="space-y-1 text-xs font-mono text-foreground">
            {activeSkills.map((s) => (
              <li key={s.skillName} className="flex items-center gap-2">
                <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                <span className="truncate">{s.skillName}</span>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {/* P1: Consent FormData bindings */}
          <input type="hidden" name="sessionId" value={session.sessionId} />
          <input type="hidden" name="revision" value={String(session.revision)} />
          <input type="hidden" name="manifestDigest" value={session.summary.manifestDigest} />
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <StatefulButton
            type="submit"
            variant="primary"
            size="md"
            state={isSubmitting ? "loading" : "idle"}
            loadingLabel="Authorizing…"
          >
            Confirm & Authorize
          </StatefulButton>
        </form>
      </div>
    </div>
  );
}
