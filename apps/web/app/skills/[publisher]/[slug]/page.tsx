import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, Bookmark, Check, ExternalLink, FileKey2, Flag, GitCommitHorizontal, ShieldQuestion } from "lucide-react";
import { notFound } from "next/navigation";
import { ReportForm, ReportStatusNotice } from "@/app/skills/[publisher]/[slug]/report-form";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable } from "@/components/skillmap/catalog-states";
import { GradePill, humanize } from "@/components/skillmap/skill-card";
import { SaveStatusNotice } from "@/components/skillmap/save-status-notice";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { buildPublicPageMetadata, buildUnavailableMetadata } from "@/lib/metadata";
import { getPublicSkillByRoute } from "@/lib/registry/repository.server";
import { parseReportPublicId, parseReportSubmitStatus, type ReportSubmitStatus } from "@/lib/reports/status";
import { parseReportFlash, REPORT_FLASH_COOKIE } from "@/lib/reports/flash";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HostedAccountState } from "@/lib/auth/account-state";
import { buildExactGitHubSourceUrl } from "@/lib/registry/public-links";
import { parseSaveFlash, SAVE_FLASH_COOKIE, type SaveFlashStatus } from "@/lib/registry/save-flash";

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
  searchParams: Promise<{ reportStatus?: string | string[]; reportField?: string | string[]; report?: string | string[]; reportFlash?: string | string[]; saveFlash?: string | string[] }>;
}) {
  const { publisher, slug } = await params;
  const query = await searchParams;
  const requestedReportStatus = parseReportSubmitStatus(query.reportStatus);
  const requestedReportId = parseReportPublicId(query.report);
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
  const detailPath = `/skills/${publisher}/${slug}`;
  const cookieStore = await cookies();
  const reportFlash = parseReportFlash(
    cookieStore.get(REPORT_FLASH_COOKIE)?.value,
    query.reportFlash,
    detailPath
  );
  const saveFlash = parseSaveFlash(
    cookieStore.get(SAVE_FLASH_COOKIE)?.value,
    query.saveFlash,
    detailPath
  );

  let signedIn = false;
  let saved = false;
  let accountUnavailable = false;
  let verifiedReportStatus: ReportSubmitStatus | null = null;
  let verifiedReportId: string | null = null;
  let verifiedReportField: string | null = null;
  let verifiedSaveStatus: SaveFlashStatus | null = saveFlash?.status === "unavailable" ? "unavailable" : null;
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
      if (!savedError && saveFlash?.skillId === skill.skillId) {
        if (saveFlash.status === "saved" && saved) verifiedSaveStatus = "saved";
        if (saveFlash.status === "removed" && !saved) verifiedSaveStatus = "removed";
      }
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
      if (reportFlash) {
        verifiedReportStatus = reportFlash.status;
        verifiedReportId = reportFlash.reportId;
        verifiedReportField = reportFlash.field;
      }
    } else accountUnavailable = auth.state === "unavailable";
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    accountUnavailable = true;
  }
  const accountState: HostedAccountState = accountUnavailable
    ? "unavailable"
    : signedIn ? "authenticated" : "signed-out";
  const exactSourceUrl = buildExactGitHubSourceUrl(skill.source);

  return (
    <DetailShell accountState={accountState}>
      <Link href="/skills" prefetch={false} className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to library</Link>
      {verifiedSaveStatus ? <SaveStatusNotice status={verifiedSaveStatus} /> : null}
      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SkillActionPanel
          skill={skill}
          accountUnavailable={accountUnavailable}
          signedIn={signedIn}
          saved={saved}
          detailPath={detailPath}
          exactSourceUrl={exactSourceUrl}
          className="h-fit rounded-xl border border-border bg-card p-5 lg:hidden"
        />
        <article className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">{skill.publisher.handle}</span>
            <TrustStatePill label={`Publisher ${humanize(skill.publisher.verificationState)}`} state={skill.publisher.verificationState} />
            <TrustStatePill label={humanize(skill.lifecycleState)} state={skill.lifecycleState} />
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
              <Link href={`/skills/${publisher}/${slug}/audit`} prefetch={false} className="font-semibold text-primary underline underline-offset-4">View audit evidence</Link>
              <Link href={`/skills/${publisher}/${slug}/grade`} prefetch={false} className="font-semibold text-primary underline underline-offset-4">View grade evidence</Link>
              <Link href="/trust/auditing" prefetch={false} className="font-semibold text-primary underline underline-offset-4">How auditing works</Link>
              <Link href="/trust/grading" prefetch={false} className="font-semibold text-primary underline underline-offset-4">How grading works</Link>
            </nav>
          </section>

          <section className="mt-10 border-t border-border pt-8" aria-labelledby="freshness-signals-heading">
            <h2 id="freshness-signals-heading" className="text-xl font-semibold">Freshness signals</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Recorded signals only. SkillMap does not calculate an automatic fresh or current verdict from elapsed time; stale and incomplete states appear only when the retained evidence says so.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <FreshnessSignal
                label="Catalog publication"
                value={formatDate(skill.currentVersion.publishedAt)}
                detail={`Recorded for version ${skill.currentVersion.version}.`}
              />
              <FreshnessSignal
                label="Listing record"
                value={formatDate(skill.updatedAt)}
                detail="Most recent recorded catalog update for this listing."
              />
              <FreshnessSignal
                label="Provenance evidence"
                value={humanize(skill.evidence.provenance)}
                detail="Recorded evidence state for this exact source version."
              />
              <FreshnessSignal
                label="Audit evidence"
                value={humanize(skill.evidence.audit)}
                detail="Open the bounded audit page for any retained receipt timestamp."
              />
              <FreshnessSignal
                label="Compatibility evidence"
                value={humanize(skill.evidence.compatibility)}
                detail={skill.compatibility.profileVersion
                  ? `Host profile ${skill.compatibility.profileVersion}.`
                  : "No host-profile version is attached to this compatibility state."}
              />
              <FreshnessSignal
                label="Grade evidence"
                value={humanize(skill.currentVersion.grade.state)}
                detail={skill.currentVersion.grade.invalidatedAt
                  ? `Invalidated ${formatDate(skill.currentVersion.grade.invalidatedAt)}.`
                  : skill.currentVersion.grade.receipt
                    ? `Receipt recorded ${formatDate(skill.currentVersion.grade.receipt.gradedAt)}.`
                    : "No public grade receipt timestamp is attached to this version."}
              />
            </dl>
          </section>

          <section className="mt-10 border-t border-border pt-8">
            <h2 className="text-xl font-semibold">Source and integrity</h2>
            <dl className="mt-4 grid gap-3">
              <SourceRow icon={<GitCommitHorizontal />} label="Immutable commit" value={skill.source.commit} mono />
              <SourceRow icon={<FileKey2 />} label="Relative skill path" value={skill.source.path} mono />
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
            {verifiedReportStatus ? <ReportStatusNotice status={verifiedReportStatus} reportId={verifiedReportId} field={verifiedReportField} /> : null}
            {accountUnavailable ? (
              <div className="mt-5 rounded-xl border border-warning/35 bg-warning/10 p-4" role="status">
                <p className="font-semibold">Reporting is temporarily unavailable</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Account authentication could not be verified, so no report form or unauthenticated fallback is available.</p>
              </div>
            ) : signedIn ? (
              <ReportForm
                skillId={skill.skillId}
                versionId={skill.currentVersion.versionId}
                returnPath={detailPath}
                requestId={reportFlash?.requestId ?? randomUUID()}
                initialCategory={reportFlash?.category}
                initialMessage={reportFlash?.message}
              />
            ) : (
              <div className="mt-5 rounded-xl border border-border bg-card p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
                <div><p className="font-semibold">Sign in to send a report</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Anonymous reporting is not enabled until provider-level anti-spam controls exist. A free verified account is required.</p></div>
                <Link href={`/sign-in?next=${encodeURIComponent(`/skills/${publisher}/${slug}#report-listing`)}`} prefetch={false} className="mt-4 inline-flex h-10 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground sm:mt-0">Sign in to report</Link>
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Limits:</strong> at most 5 queued reports per account and 20 new reports per rolling 24 hours, plus one queued report for each exact version/category and a 24-hour cooldown on that tuple even after resolution. Reports are immutable, operator-resolved, and have no response-time SLA in the free alpha.</p>
          </section>
        </article>

        <SkillActionPanel
          skill={skill}
          accountUnavailable={accountUnavailable}
          signedIn={signedIn}
          saved={saved}
          detailPath={detailPath}
          exactSourceUrl={exactSourceUrl}
          className="hidden h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24 lg:block"
        />
      </div>
    </DetailShell>
  );
}

type PublicSkillDetail = NonNullable<Awaited<ReturnType<typeof getPublicSkillByRoute>>>;

function SkillActionPanel({
  skill,
  accountUnavailable,
  signedIn,
  saved,
  detailPath,
  exactSourceUrl,
  className
}: {
  skill: PublicSkillDetail;
  accountUnavailable: boolean;
  signedIn: boolean;
  saved: boolean;
  detailPath: string;
  exactSourceUrl: string | null;
  className: string;
}) {
  return (
    <aside data-skill-actions aria-label="Skill version actions" className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Version {skill.currentVersion.version}</p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        License: {skill.license.spdxExpression ?? humanize(skill.license.state)} · redistribution: {humanize(skill.license.redistribution)} · artifact: {humanize(skill.artifact.availability)}.
      </p>
      {accountUnavailable ? (
        <p role="status" className="mt-5 rounded-lg border border-border bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground">
          Saved-skill status is temporarily unavailable.
        </p>
      ) : signedIn ? (
        <form action="/account/saved/action" method="post" className="mt-5">
          <input type="hidden" name="skillId" value={skill.skillId} />
          <input type="hidden" name="operation" value={saved ? "remove" : "save"} />
          <input type="hidden" name="returnPath" value={detailPath} />
          <button type="submit" className="press inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            {saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            {saved ? "Remove from saved" : "Save skill"}
          </button>
        </form>
      ) : (
        <Link href={`/sign-in?next=${encodeURIComponent(detailPath)}`} prefetch={false} className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"><Bookmark className="h-4 w-4" /> Sign in to save</Link>
      )}
      {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-center text-sm font-semibold hover:bg-accent">View exact source at commit <ExternalLink className="h-4 w-4 shrink-0" /></a> : null}
      <a href={skill.source.repositoryUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-center text-sm font-semibold hover:bg-accent">View repository root <ExternalLink className="h-4 w-4 shrink-0" /></a>
      <Link href={`/api/v1/skills/${skill.skillId}`} prefetch={false} className="mt-3 block break-all text-center font-mono text-[11px] text-muted-foreground hover:text-foreground">{skill.skillId}</Link>
    </aside>
  );
}

function DetailShell({ children, accountState }: { children: React.ReactNode; accountState?: HostedAccountState }) {
  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground"><CatalogHeader accountState={accountState} /><section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">{children}</section></main>;
}

function TrustStatePill({ label, state }: { label: string; state: string }) {
  const tone = state === "identity-verified" || state === "published"
    ? "border-success/30 bg-success/10 text-success"
    : state === "disputed"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : state === "deprecated"
        ? "border-warning/35 bg-warning/10 text-foreground"
        : "border-border bg-muted text-muted-foreground";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-sm font-semibold text-foreground">{humanize(value)}</p></div>;
}

function FreshnessSignal({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-2">
        <span className="block text-sm font-semibold text-foreground">{value}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
      </dd>
    </div>
  );
}

function SourceRow({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return <div className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[10rem_1fr] sm:items-start"><dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">{icon}<span>{label}</span></dt><dd className={`${mono ? "mono break-all text-xs" : "text-sm"} text-foreground`}>{value}</dd></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unavailable" : date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}
