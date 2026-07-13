import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Bookmark, Check, ExternalLink, FileKey2, Flag, GitCommitHorizontal, ShieldQuestion } from "lucide-react";
import { notFound } from "next/navigation";
import { reportSuspiciousListing } from "@/app/skills/[publisher]/[slug]/report-actions";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable } from "@/components/skillmap/catalog-states";
import { GradePill, humanize } from "@/components/skillmap/skill-card";
import { saveSkill, unsaveSkill } from "@/app/account/actions";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { buildPublicPageMetadata, buildUnavailableMetadata } from "@/lib/metadata";
import { getPublicSkillByRoute } from "@/lib/registry/repository.server";
import { REPORT_CATEGORY_COPY, REPORT_CATEGORIES } from "@/lib/reports/input";
import { parseReportPublicId, parseReportSubmitStatus, type ReportSubmitStatus } from "@/lib/reports/status";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ publisher: string; slug: string }>;
}): Promise<Metadata> {
  const { publisher, slug } = await params;
  try {
    const skill = await getPublicSkillByRoute(publisher, slug);
    if (!skill) {
      return buildUnavailableMetadata(
        "Skill not found | SkillMap",
        "This public SkillMap skill record is unavailable."
      );
    }
    return buildPublicPageMetadata({
      title: `${skill.displayName} by ${skill.publisher.displayName} | SkillMap`,
      description: skill.summary,
      path: `/skills/${skill.publisher.handle}/${skill.slug}`
    });
  } catch (error) {
    if (
      error instanceof CatalogInputError
      || error instanceof CatalogQueryError
      || error instanceof CatalogDataError
      || error instanceof SupabaseConfigurationError
    ) {
      return buildUnavailableMetadata(
        "Skill unavailable | SkillMap",
        "This public SkillMap skill record cannot be loaded in the current environment."
      );
    }
    throw error;
  }
}

export default async function SkillDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ publisher: string; slug: string }>;
  searchParams: Promise<{ reportStatus?: string | string[]; reportField?: string | string[]; report?: string | string[] }>;
}) {
  const { publisher, slug } = await params;
  const query = await searchParams;
  const requestedReportStatus = parseReportSubmitStatus(query.reportStatus);
  const requestedReportId = parseReportPublicId(query.report);
  const reportField = typeof query.reportField === "string" && /^[a-z][A-Za-z]{0,39}$/.test(query.reportField) ? query.reportField : null;
  let skill;
  try {
    skill = await getPublicSkillByRoute(publisher, slug);
  } catch (error) {
    if (error instanceof CatalogInputError) notFound();
    if (error instanceof SupabaseConfigurationError || error instanceof CatalogQueryError || error instanceof CatalogDataError) {
      return <DetailShell><CatalogUnavailable /></DetailShell>;
    }
    throw error;
  }
  if (!skill) notFound();

  let signedIn = false;
  let saved = false;
  let accountUnavailable = false;
  let verifiedReportStatus: ReportSubmitStatus | null = requestedReportStatus === "queued" || requestedReportStatus === "duplicate"
    ? null
    : requestedReportStatus;
  let verifiedReportId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const auth = classifyVerifiedClaims(data, error);
    signedIn = auth.state === "authenticated";
    if (auth.state === "authenticated") {
      const { data: savedRow, error: savedError } = await supabase
        .from("saved_skills")
        .select("skill_id")
        .eq("user_id", auth.userId)
        .eq("skill_id", skill.skillId)
        .maybeSingle();
      if (savedError) accountUnavailable = true;
      else saved = Boolean(savedRow);
      if ((requestedReportStatus === "queued" || requestedReportStatus === "duplicate") && requestedReportId) {
        const { data: reportRow, error: reportError } = await supabase
          .from("my_skill_reports")
          .select("report_id,state")
          .eq("report_id", requestedReportId)
          .eq("skill_id", skill.skillId)
          .eq("version_id", skill.currentVersion.versionId)
          .maybeSingle();
        if (reportError) accountUnavailable = true;
        else if (reportRow?.report_id === requestedReportId
          && (requestedReportStatus !== "queued" || reportRow.state === "queued")) {
          verifiedReportStatus = requestedReportStatus;
          verifiedReportId = requestedReportId;
        }
      }
    } else accountUnavailable = auth.state === "unavailable";
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    accountUnavailable = true;
  }

  return (
    <DetailShell account={signedIn}>
      <Link href="/skills" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to library</Link>
      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{skill.publisher.handle}</span>
            <GradePill state={skill.currentVersion.grade.state} band={skill.currentVersion.grade.band} />
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Compatibility {humanize(skill.compatibility.state)}</span>
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{skill.displayName}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{skill.description}</p>

          <section className="mt-10 border-t border-border pt-8">
            <h2 className="text-xl font-semibold">Current evidence</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <EvidenceCell label="Provenance" value={skill.evidence.provenance} />
              <EvidenceCell label="Audit" value={skill.evidence.audit} />
              <EvidenceCell label="Compatibility" value={skill.evidence.compatibility} />
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              “Unverified,” “not run,” and “not tested” are deliberate truth states—not failures hidden behind a score.
            </p>
            <nav className="mt-4 flex flex-wrap gap-4 text-sm" aria-label="Evidence methodology">
              <Link href={`/skills/${publisher}/${slug}/audit`} className="font-semibold text-primary underline underline-offset-4">View audit evidence</Link>
              <Link href={`/skills/${publisher}/${slug}/grade`} className="font-semibold text-primary underline underline-offset-4">View grade evidence</Link>
              <Link href="/trust/auditing" className="font-semibold text-primary underline underline-offset-4">How auditing works</Link>
              <Link href="/trust/grading" className="font-semibold text-primary underline underline-offset-4">How grading works</Link>
            </nav>
          </section>

          <section className="mt-10 border-t border-border pt-8">
            <h2 className="text-xl font-semibold">Source and integrity</h2>
            <dl className="mt-4 grid gap-3">
              <SourceRow icon={<GitCommitHorizontal />} label="Immutable commit" value={skill.source.commit} mono />
              <SourceRow icon={<FileKey2 />} label="Entrypoint digest" value={skill.source.entrypointContentDigest} mono />
              <SourceRow icon={<ShieldQuestion />} label="Raw source snapshot" value={skill.source.rawSnapshotDigest ?? "Pending canonical receipt"} mono={Boolean(skill.source.rawSnapshotDigest)} />
              <SourceRow icon={<ShieldQuestion />} label="Normalized artifact" value={skill.artifact.normalizedDigest ?? "Pending package pipeline"} mono={Boolean(skill.artifact.normalizedDigest)} />
            </dl>
          </section>

          <section className="mt-10 border-t border-border pt-8">
            <h2 className="text-xl font-semibold">Capabilities and relationships</h2>
            <div className="mt-4 flex flex-wrap gap-2">{skill.capabilities.map((item) => <span key={item} className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{item}</span>)}</div>
            {skill.relationships.length ? (
              <div className="mt-5 grid gap-3">
                {skill.relationships.map((relationship) => (
                  <div key={`${relationship.type}:${relationship.targetSkillId}`} className="rounded-lg border border-border bg-card p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{humanize(relationship.type)} · {humanize(relationship.evidenceState)}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{relationship.reason}</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-4 text-sm text-muted-foreground">No reviewed relationships are published for this version.</p>}
          </section>

          <section className="mt-10 scroll-mt-20 border-t border-border pt-8" id="report-listing" aria-labelledby="report-listing-heading">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning"><Flag className="h-5 w-5" /></span>
              <div>
                <h2 id="report-listing-heading" className="text-xl font-semibold">Report a suspicious listing</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Report one bounded concern about this exact current version. Reports are private to your account and operators; submitting one does not establish that the listing is unsafe.</p>
              </div>
            </div>
            {verifiedReportStatus ? <ReportStatusNotice status={verifiedReportStatus} reportId={verifiedReportId} field={reportField} /> : null}
            {accountUnavailable ? (
              <div className="mt-5 rounded-xl border border-warning/35 bg-warning/10 p-4" role="status">
                <p className="font-semibold">Reporting is temporarily unavailable</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Account authentication could not be verified, so no report form or unauthenticated fallback is available.</p>
              </div>
            ) : signedIn ? (
              <ReportForm
                skillId={skill.skillId}
                versionId={skill.currentVersion.versionId}
                returnPath={`/skills/${publisher}/${slug}`}
                requestId={randomUUID()}
              />
            ) : (
              <div className="mt-5 rounded-xl border border-border bg-card p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
                <div><p className="font-semibold">Sign in to send a report</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Anonymous reporting is not enabled until provider-level anti-spam controls exist. A free verified account is required.</p></div>
                <Link href={`/sign-in?next=${encodeURIComponent(`/skills/${publisher}/${slug}#report-listing`)}`} className="mt-4 inline-flex h-10 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground sm:mt-0">Sign in to report</Link>
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Limits:</strong> at most 5 queued reports per account and 20 new reports per rolling 24 hours, plus one queued report for each exact version/category and a 24-hour cooldown on that tuple even after resolution. Reports are immutable, operator-resolved, and have no response-time SLA in the free alpha.</p>
          </section>
        </article>

        <aside className="h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Version {skill.currentVersion.version}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            License: {skill.license.spdxExpression ?? humanize(skill.license.state)} · redistribution: {humanize(skill.license.redistribution)} · artifact: {humanize(skill.artifact.availability)}.
          </p>
          {accountUnavailable ? (
            <p role="status" className="mt-5 rounded-lg border border-border bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground">
              Saved-skill status is temporarily unavailable.
            </p>
          ) : signedIn ? (
            <form action={saved ? unsaveSkill : saveSkill} className="mt-5">
              <input type="hidden" name="skillId" value={skill.skillId} />
              <button type="submit" className="press inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
                {saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {saved ? "Remove from saved" : "Save skill"}
              </button>
            </form>
          ) : (
            <Link href={`/sign-in?next=${encodeURIComponent(`/skills/${publisher}/${slug}`)}`} className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"><Bookmark className="h-4 w-4" /> Sign in to save</Link>
          )}
          <a href={skill.source.repositoryUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-sm font-semibold hover:bg-accent">View source repository <ExternalLink className="h-4 w-4" /></a>
          <Link href={`/api/v1/skills/${skill.skillId}`} className="mt-3 block break-all text-center font-mono text-[11px] text-muted-foreground hover:text-foreground">{skill.skillId}</Link>
        </aside>
      </div>
    </DetailShell>
  );
}

function DetailShell({ children, account = false }: { children: React.ReactNode; account?: boolean }) {
  return <main className="min-h-screen bg-background text-foreground"><CatalogHeader account={account} /><section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">{children}</section></main>;
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-sm font-semibold text-foreground">{humanize(value)}</p></div>;
}

function SourceRow({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return <div className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[10rem_1fr] sm:items-start"><dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">{icon}<span>{label}</span></dt><dd className={`${mono ? "mono break-all text-xs" : "text-sm"} text-foreground`}>{value}</dd></div>;
}

function ReportForm({ skillId, versionId, returnPath, requestId }: { skillId: string; versionId: string; returnPath: string; requestId: string }) {
  const control = "mt-2 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
  return (
    <form action={reportSuspiciousListing} className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <input type="hidden" name="skillId" value={skillId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="report-category" className="text-sm font-semibold">Concern category</label>
          <select id="report-category" name="category" required defaultValue="" className={`${control} h-11`}>
            <option value="">Choose one category</option>
            {REPORT_CATEGORIES.map((category) => <option key={category} value={category}>{REPORT_CATEGORY_COPY[category].label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="report-request-id" className="text-sm font-semibold">Request ID</label>
          <input id="report-request-id" name="idempotencyKey" value={requestId} readOnly className={`${control} mono h-11 bg-muted/50 text-xs`} />
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="report-message" className="text-sm font-semibold">What is wrong with this listing?</label>
        <p id="report-message-hint" className="mt-1 text-xs leading-5 text-muted-foreground">10–2,000 characters. Use one normalized paragraph; line breaks and control characters are rejected. Do not include credentials, private prompts, patient data, or workspace contents.</p>
        <textarea id="report-message" name="message" required minLength={10} maxLength={2000} rows={5} aria-describedby="report-message-hint" className={`${control} resize-y py-3`} />
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="mono break-all text-[11px] text-muted-foreground">{skillId} · {versionId}</p>
        <button type="submit" className="press inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background"><Flag className="h-4 w-4" /> Queue private report</button>
      </div>
    </form>
  );
}

function ReportStatusNotice({ status, reportId, field }: { status: ReportSubmitStatus; reportId: string | null; field: string | null }) {
  const messages: Record<ReportSubmitStatus, { title: string; body: string; tone: string }> = {
    "active-limit": { title: "Queued-report limit reached", body: "This account already has 5 queued listing reports. No new report was created; wait for an operator disposition before retrying.", tone: "border-warning/35 bg-warning/10" },
    "auth-unavailable": { title: "Authentication could not be verified", body: "No report was accepted. Try again after hosted authentication recovers.", tone: "border-warning/35 bg-warning/10" },
    cooldown: { title: "Report cooldown is active", body: "This account already reported this exact version/category within 24 hours. No additional report was created.", tone: "border-warning/35 bg-warning/10" },
    "daily-limit": { title: "Daily report limit reached", body: "This account already created 20 listing reports in the rolling 24-hour window. No new report was created.", tone: "border-warning/35 bg-warning/10" },
    duplicate: { title: "That report request already exists", body: reportId ? `Existing report ${reportId} remains the account-owned source of truth.` : "No second report was created. Open your report history to review the existing request.", tone: "border-warning/35 bg-warning/10" },
    invalid: { title: "Report input was rejected", body: field ? `The ${field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} field was not canonical. No report was created.` : "One or more fields were invalid. No report was created.", tone: "border-destructive/30 bg-destructive/10" },
    queued: { title: "Private report queued", body: reportId ? `Report ${reportId} is now visible in your account history.` : "The report was accepted and is now visible in your account history.", tone: "border-primary/30 bg-primary/10" },
    "service-unavailable": { title: "Reporting service unavailable", body: "The write could not be confirmed, so SkillMap does not claim that a report was created.", tone: "border-warning/35 bg-warning/10" },
    "target-unavailable": { title: "This exact listing cannot be reported", body: "The skill/version pair is no longer the exact current public listing. Reload the catalog before trying again.", tone: "border-warning/35 bg-warning/10" }
  };
  const message = messages[status];
  return <div className={`mt-5 rounded-xl border p-4 ${message.tone}`} role="status"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{message.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{message.body}</p>{status === "queued" || status === "duplicate" ? <Link href="/account/reports" className="mt-2 inline-flex text-sm font-semibold text-primary underline underline-offset-4">View report history</Link> : null}</div>;
}
