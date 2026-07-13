import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3, Download, FileClock, GitCommitHorizontal, RotateCcw, X } from "lucide-react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withdrawQueuedSubmission } from "@/app/account/submissions/actions";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { buildCurrentPublicSkillLinks, type PublicSkillRoute } from "@/lib/registry/public-links";
import { resolvePublicSkillRoutes } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.runtime.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decodeSubmissionCursor, encodeSubmissionCursor, SubmissionCursorError } from "@/lib/submissions/cursor";
import {
  parseSubmissionListStatus,
  parseSubmissionPublicId,
  type SubmissionListStatus
} from "@/lib/submissions/status";

export const dynamic = "force-dynamic";

type SubmissionProjection = {
  submissionId: string;
  repositoryUrl: string;
  sourceCommit: string;
  sourcePath: string;
  versionLabel: string;
  licenseClaim: string | null;
  submissionPolicyVersion: "public-alpha-draft/v1";
  state: "queued" | "processing" | "changes-requested" | "rejected" | "failed" | "accepted" | "published" | "withdrawn";
  auditState: "not-run" | "passed" | "warnings" | "blocked";
  auditReceiptPublicId: string | null;
  gradeState: "ungraded" | "provisional" | "blocked";
  gradeReceiptPublicId: string | null;
  gradeConfidence: number | null;
  reviewState: "not-started" | "approved" | "changes-requested" | "rejected" | "published" | "withdrawn";
  reviewCasePublicId: string | null;
  remediationCode: string | null;
  publicStatusMessage: string | null;
  resultSkillId: string | null;
  resultVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};

export default async function AccountSubmissionsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; submission?: string | string[]; cursor?: string | string[] }>;
}) {
  const params = await searchParams;
  const status = parseSubmissionListStatus(params.status);
  const statusSubmissionId = parseSubmissionPublicId(params.submission);
  const rawCursor = typeof params.cursor === "string" ? params.cursor : null;
  let cursor: ReturnType<typeof decodeSubmissionCursor> | null = null;
  try {
    cursor = rawCursor ? decodeSubmissionCursor(rawCursor) : null;
  } catch (error) {
    if (error instanceof SubmissionCursorError) return <InvalidSubmissionsPage />;
    throw error;
  }

  let supabase: SupabaseClient<Database>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return <SubmissionsUnavailable />;
  }
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(claims, claimsError);
  if (auth.state !== "authenticated") {
    if (auth.state === "signed-out") redirect("/sign-in?next=/account/submissions");
    return <SubmissionsUnavailable />;
  }

  let query = supabase
    .from("my_skill_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .order("submission_id", { ascending: false })
    .limit(51);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},submission_id.lt.${cursor.submissionId})`);
  }
  const { data, error } = await query;
  if (error || !data) return <SubmissionsUnavailable />;
  const parsed = data.map(parseSubmissionProjection);
  if (parsed.some((submission) => submission === null)) return <SubmissionsUnavailable />;
  const hasMore = parsed.length > 50;
  const submissions = parsed.slice(0, 50) as SubmissionProjection[];
  const publicRoutes = await loadCurrentPublicRoutes(submissions.map((submission) => submission.resultSkillId));
  const lastSubmission = submissions.at(-1);
  const nextCursor = hasMore && lastSubmission
    ? encodeSubmissionCursor({ createdAt: lastSubmission.createdAt, submissionId: lastSubmission.submissionId })
    : null;
  const verifiedStatus = await verifyListStatus(supabase, status, statusSubmissionId);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader accountState="authenticated" />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Account-owned queue</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your submissions</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              These are private submission intents from your account. Queue and processing states do not claim publication, audit passage, compatibility, or a current grade.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/account" className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent"><ArrowLeft className="h-4 w-4" /> Saved skills</Link>
            <Link href="/submit" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-95">New submission <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>

        {verifiedStatus ? <ListStatusNotice status={verifiedStatus} submissionId={statusSubmissionId} /> : null}

        <section className="py-8" aria-labelledby="submission-list-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="submission-list-heading" className="text-lg font-semibold">Recent submission intents</h2>
              <p className="mt-1 text-xs text-muted-foreground">Stable newest-first pages from the owner-filtered account projection.</p>
            </div>
            <Link href="/account/export" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><Download className="h-4 w-4" /> Export account JSON</Link>
          </div>

          {submissions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
              <FileClock className="mx-auto h-7 w-7 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">No submissions yet</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Queue one exact public GitHub skill version. Nothing becomes public without later worker evidence and operator review.</p>
              <Link href="/submit" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Submit a skill</Link>
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              {submissions.map((submission) => <SubmissionCard key={submission.submissionId} submission={submission} publicRoute={submission.resultSkillId ? publicRoutes.get(submission.resultSkillId) : undefined} />)}
            </div>
          )}
          {(cursor || nextCursor) ? (
            <nav aria-label="Submission pages" className="mt-6 flex flex-wrap gap-3">
              {cursor ? <Link href="/account/submissions" className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">First page</Link> : null}
              {nextCursor ? <Link href={`/account/submissions?cursor=${encodeURIComponent(nextCursor)}`} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">Next submissions</Link> : null}
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SubmissionCard({ submission, publicRoute }: { submission: SubmissionProjection; publicRoute?: PublicSkillRoute }) {
  const state = submissionStateCopy(submission.state);
  const publicLinks = buildCurrentPublicSkillLinks(publicRoute, submission.resultVersionId);
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${state.tone}`}>{state.label}</span>
            <span className="mono break-all text-xs text-muted-foreground">{submission.submissionId}</span>
          </div>
          <a href={submission.repositoryUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-lg font-semibold hover:text-primary hover:underline">{submission.repositoryUrl}</a>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.description}</p>
        </div>
        {submission.state === "queued" ? (
          <form action={withdrawQueuedSubmission}>
            <input type="hidden" name="submissionId" value={submission.submissionId} />
            <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-full border border-destructive/30 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"><X className="h-3.5 w-3.5" /> Withdraw queued request</button>
          </form>
        ) : null}
      </div>

      <dl className="mt-5 grid min-w-0 gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
        <Coordinate label="Version" value={submission.versionLabel} />
        <Coordinate label="Skill path" value={submission.sourcePath} mono />
        <Coordinate label="Exact commit" value={submission.sourceCommit} mono />
        <Coordinate label="License claim" value={submission.licenseClaim ?? "No submitter claim"} />
      </dl>
      <EvidenceSnapshot submission={submission} publicLinks={publicLinks} />
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Queued {formatDate(submission.createdAt)}</span>
        {submission.claimedAt ? <span className="inline-flex items-center gap-1.5"><GitCommitHorizontal className="h-3.5 w-3.5" />Claimed {formatDate(submission.claimedAt)}</span> : null}
        {submission.completedAt ? <span className="inline-flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" />Closed {formatDate(submission.completedAt)}</span> : null}
      </div>
    </article>
  );
}

function EvidenceSnapshot({ submission, publicLinks }: { submission: SubmissionProjection; publicLinks: ReturnType<typeof buildCurrentPublicSkillLinks> }) {
  return (
    <div className="mt-5 border-t border-border pt-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <EvidenceState label="Static audit" value={humanizeState(submission.auditState)} receipt={submission.auditReceiptPublicId} />
        <EvidenceState
          label="Grade evidence"
          value={submission.gradeState === "provisional" && submission.gradeConfidence !== null
            ? `Provisional · ${Math.round(submission.gradeConfidence * 100)}% confidence`
            : humanizeState(submission.gradeState)}
          receipt={submission.gradeReceiptPublicId}
        />
        <EvidenceState label="Operator review" value={humanizeState(submission.reviewState)} receipt={submission.reviewCasePublicId} />
      </div>
      {submission.publicStatusMessage ? (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-foreground">{submission.publicStatusMessage}</p>
      ) : null}
      {(submission.remediationCode || submission.resultSkillId || submission.resultVersionId) ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {submission.remediationCode ? <span>Remediation: <span className="mono text-foreground">{submission.remediationCode}</span></span> : null}
          {submission.resultSkillId ? <span>Public skill: <span className="mono text-foreground">{submission.resultSkillId}</span></span> : null}
          {submission.resultVersionId ? <span>Public version: <span className="mono text-foreground">{submission.resultVersionId}</span></span> : null}
        </div>
      ) : null}
      {submission.state === "published" ? publicLinks ? (
        <nav aria-label="Published submission result" className="mt-4 flex flex-wrap gap-2">
          <Link href={publicLinks.detail} prefetch={false} className="inline-flex h-9 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">View published listing</Link>
          <Link href={publicLinks.audit} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">View audit evidence</Link>
          <Link href={publicLinks.grade} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">View grade evidence</Link>
        </nav>
      ) : (
        <p className="mt-4 rounded-xl border border-border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground" role="status">This exact published result is not the current public route. SkillMap does not redirect it to a newer, hidden, or unavailable version.</p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Policy {submission.submissionPolicyVersion}. Receipt states are version-bound and separate. This surface never upgrades a provisional or blocked grade to current.</p>
    </div>
  );
}

async function loadCurrentPublicRoutes(skillIds: Array<string | null>): Promise<Map<string, PublicSkillRoute>> {
  try {
    return await resolvePublicSkillRoutes(skillIds.filter((skillId): skillId is string => skillId !== null));
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogQueryError || error instanceof CatalogDataError
      || error instanceof SupabaseConfigurationError) return new Map();
    throw error;
  }
}

function EvidenceState({ label, value, receipt }: { label: string; value: string; receipt: string | null }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/35 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {receipt ? <p className="mono mt-1 break-all text-[0.68rem] leading-4 text-muted-foreground">{receipt}</p> : null}
    </div>
  );
}

function Coordinate({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-foreground ${mono ? "mono text-xs leading-5" : ""}`}>{value}</dd></div>;
}

function ListStatusNotice({ status, submissionId }: { status: SubmissionListStatus; submissionId: string | null }) {
  const copy: Record<SubmissionListStatus, { title: string; body: string; tone: string }> = {
    queued: { title: "Submission queued", body: submissionId ? `${submissionId} is account-owned and waiting for worker claim.` : "The submission is waiting for worker claim.", tone: "border-primary/30 bg-primary/10" },
    withdrawn: { title: "Queued submission withdrawn", body: submissionId ? `${submissionId} is closed and cannot be claimed.` : "The queued submission is closed and cannot be claimed.", tone: "border-primary/30 bg-primary/10" },
    "not-withdrawable": { title: "Submission was not withdrawn", body: "Only one of your own currently queued submissions can be withdrawn. No other state was changed.", tone: "border-warning/35 bg-warning/10" },
    "service-unavailable": { title: "Submission status unavailable", body: "The requested mutation could not be confirmed. SkillMap does not claim that the record changed.", tone: "border-warning/35 bg-warning/10" }
  };
  const message = copy[status];
  return <div className={`mt-7 rounded-xl border p-4 ${message.tone}`} role="status"><p className="font-semibold">{message.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{message.body}</p></div>;
}

async function verifyListStatus(
  supabase: SupabaseClient<Database>,
  status: SubmissionListStatus | null,
  submissionId: string | null
): Promise<SubmissionListStatus | null> {
  if (status !== "queued" && status !== "withdrawn") return status;
  if (!submissionId) return null;
  const { data, error } = await supabase
    .from("my_skill_submissions")
    .select("submission_id,state")
    .eq("submission_id", submissionId)
    .maybeSingle();
  return !error && data?.submission_id === submissionId && data.state === status ? status : null;
}

function submissionStateCopy(state: SubmissionProjection["state"]) {
  if (state === "queued") return { label: "Queued", description: "Waiting for a constrained worker claim. No audit or grade receipt exists from this queue state.", tone: "border-primary/30 bg-primary/10 text-primary" };
  if (state === "processing") return { label: "Processing", description: "A worker lease is active. Processing does not imply acceptance, publication, or a current grade.", tone: "border-warning/35 bg-warning/10 text-foreground" };
  if (state === "changes-requested") return { label: "Changes requested", description: "Operator review requires a new immutable submission or documented remediation. This record is not public.", tone: "border-warning/35 bg-warning/10 text-foreground" };
  if (state === "rejected") return { label: "Rejected", description: "Operator review rejected this immutable source intent. It did not create a public listing or current grade.", tone: "border-destructive/30 bg-destructive/10 text-destructive" };
  if (state === "failed") return { label: "Processing failed", description: "The worker could not complete this attempt. No public result or grade is claimed.", tone: "border-destructive/30 bg-destructive/10 text-destructive" };
  if (state === "accepted") return { label: "Accepted for publication", description: "Operator evidence accepted this source intent, but publication is a separate transition and any grade remains provisional.", tone: "border-primary/30 bg-primary/10 text-primary" };
  if (state === "published") return { label: "Published", description: "The authoritative workflow recorded a public result. This account card does not claim that its provisional grade is current.", tone: "border-success/30 bg-success/10 text-success" };
  return { label: "Withdrawn", description: "Closed by the submitter while eligible for withdrawal. This intent is not public.", tone: "border-border bg-muted text-muted-foreground" };
}

function parseSubmissionProjection(row: Database["api"]["Views"]["my_skill_submissions"]["Row"]): SubmissionProjection | null {
  const extended = row as typeof row & Record<string, unknown>;
  if (typeof row.submission_id !== "string" || !/^sub_[0-9a-f]{32}$/.test(row.submission_id)) return null;
  if (typeof row.repository_url !== "string" || !/^https:\/\/github[.]com\/[a-z0-9.-]+\/[a-z0-9_.-]+$/.test(row.repository_url)) return null;
  if (typeof row.source_commit !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.source_commit)) return null;
  if (typeof row.source_path !== "string" || typeof row.version_label !== "string") return null;
  if (row.license_claim !== null && typeof row.license_claim !== "string") return null;
  if (!["queued", "processing", "changes-requested", "rejected", "failed", "accepted", "published", "withdrawn"].includes(row.state ?? "")) return null;
  if (extended.submission_policy_version !== "public-alpha-draft/v1") return null;
  if (!["not-run", "passed", "warnings", "blocked"].includes(String(extended.audit_state))) return null;
  if (!["ungraded", "provisional", "blocked"].includes(String(extended.grade_state))) return null;
  if (!["not-started", "approved", "changes-requested", "rejected", "published", "withdrawn"].includes(String(extended.review_state))) return null;
  if (!optionalPublicId(extended.audit_receipt_public_id, /^aud_[0-9a-f]{32}$/)) return null;
  if (!optionalPublicId(extended.grade_receipt_public_id, /^grd_[0-9a-f]{32}$/)) return null;
  if (!optionalPublicId(extended.review_case_public_id, /^rev_[0-9a-f]{32}$/)) return null;
  if (!optionalPublicId(extended.result_skill_id, /^skl_[0-9a-f]{32}$/)) return null;
  if (!optionalPublicId(extended.result_version_id, /^skv_[0-9a-f]{32}$/)) return null;
  if (extended.grade_confidence !== null && (typeof extended.grade_confidence !== "number" || extended.grade_confidence < 0 || extended.grade_confidence > 1)) return null;
  if (!optionalBoundedText(extended.remediation_code, 64, /^[A-Z][A-Z0-9_]{0,63}$/)) return null;
  if (!optionalBoundedText(extended.public_status_message, 500)) return null;
  if (typeof row.created_at !== "string" || typeof row.updated_at !== "string") return null;
  if (row.claimed_at !== null && typeof row.claimed_at !== "string") return null;
  if (row.completed_at !== null && typeof row.completed_at !== "string") return null;
  return {
    submissionId: row.submission_id,
    repositoryUrl: row.repository_url,
    sourceCommit: row.source_commit,
    sourcePath: row.source_path,
    versionLabel: row.version_label,
    licenseClaim: row.license_claim,
    submissionPolicyVersion: "public-alpha-draft/v1",
    state: row.state as SubmissionProjection["state"],
    auditState: extended.audit_state as SubmissionProjection["auditState"],
    auditReceiptPublicId: extended.audit_receipt_public_id as string | null,
    gradeState: extended.grade_state as SubmissionProjection["gradeState"],
    gradeReceiptPublicId: extended.grade_receipt_public_id as string | null,
    gradeConfidence: extended.grade_confidence as number | null,
    reviewState: extended.review_state as SubmissionProjection["reviewState"],
    reviewCasePublicId: extended.review_case_public_id as string | null,
    remediationCode: extended.remediation_code as string | null,
    publicStatusMessage: extended.public_status_message as string | null,
    resultSkillId: extended.result_skill_id as string | null,
    resultVersionId: extended.result_version_id as string | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at
  };
}

function optionalPublicId(value: unknown, pattern: RegExp): value is string | null {
  return value === null || (typeof value === "string" && pattern.test(value));
}

function optionalBoundedText(value: unknown, maximumLength: number, pattern?: RegExp): value is string | null {
  return value === null || (typeof value === "string" && value.length >= 1 && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/.test(value) && (!pattern || pattern.test(value)));
}

function humanizeState(value: string) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function SubmissionsUnavailable() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader accountState="unavailable" />
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-warning/35 bg-warning/10 p-6 sm:p-8" role="status">
          <h1 className="text-xl font-semibold">Your submission status is unavailable.</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Authentication or the owner-filtered submission projection could not be verified. No fixture rows are shown and no mutation was attempted.</p>
        </div>
      </section>
    </main>
  );
}

function InvalidSubmissionsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">That submission page link is invalid.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Return to the first page. No account data was changed.</p>
          <Link href="/account/submissions" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Return to submissions</Link>
        </div>
      </section>
    </main>
  );
}
