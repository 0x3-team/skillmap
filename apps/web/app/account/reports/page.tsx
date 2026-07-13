import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock3, FileWarning, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { buildCurrentPublicSkillLinks, type PublicSkillRoute } from "@/lib/registry/public-links";
import { resolvePublicSkillRoutes } from "@/lib/registry/repository.server";
import { decodeReportCursor, encodeReportCursor, ReportCursorError } from "@/lib/reports/cursor";
import { REPORT_CATEGORY_COPY, REPORT_CATEGORIES, type ReportCategory } from "@/lib/reports/input";
import { REPORT_PUBLIC_ID } from "@/lib/reports/status";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ReportProjection = {
  reportId: string;
  skillId: string;
  versionId: string;
  category: ReportCategory;
  message: string;
  state: "queued" | "resolved";
  dispositionCode: "confirmed" | "no-action" | "duplicate" | "invalid" | null;
  resolutionReasonCode: string | null;
  publicResolutionMessage: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export default async function AccountReportsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawCursor = typeof params.cursor === "string" ? params.cursor : null;
  let cursor: ReturnType<typeof decodeReportCursor> | null = null;
  try {
    cursor = rawCursor ? decodeReportCursor(rawCursor) : null;
  } catch (error) {
    if (error instanceof ReportCursorError) return <InvalidReportsPage />;
    throw error;
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return <ReportsUnavailable />;
  }
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(claims, claimsError);
  if (auth.state !== "authenticated") {
    if (auth.state === "signed-out") redirect("/sign-in?next=/account/reports");
    return <ReportsUnavailable />;
  }

  let query = supabase
    .from("my_skill_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .order("report_id", { ascending: false })
    .limit(51);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},report_id.lt.${cursor.reportId})`);
  }
  const { data, error } = await query;
  if (error || !data) return <ReportsUnavailable />;
  const parsed = data.map(parseReportProjection);
  if (parsed.some((report) => report === null)) return <ReportsUnavailable />;
  const hasMore = parsed.length > 50;
  const reports = parsed.slice(0, 50) as ReportProjection[];
  const publicRoutes = await loadCurrentPublicRoutes(reports.map((report) => report.skillId));
  const last = reports.at(-1);
  const nextCursor = hasMore && last ? encodeReportCursor({ createdAt: last.createdAt, reportId: last.reportId }) : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader accountState="authenticated" />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Account-owned safety queue</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your listing reports</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Private reports tied to your account, the exact public skill version, and one category. Resolution is an operator disposition, not proof that every repository file was reviewed.
            </p>
          </div>
          <Link href="/account" className="inline-flex h-10 items-center gap-2 self-start rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-accent sm:self-auto"><ArrowLeft className="h-4 w-4" /> Account</Link>
        </div>

        <section className="py-8" aria-labelledby="report-history-heading">
          <div className="max-w-3xl rounded-xl border border-border bg-muted/35 p-4 text-xs leading-5 text-muted-foreground">
            <strong className="text-foreground">Anti-spam boundary:</strong> reports require a verified account and an exact current public version. Each account may hold at most 5 queued reports and create at most 20 in a rolling 24-hour window. Only one queued report per version/category is allowed, and the same account cannot submit that tuple again for 24 hours—even after resolution. Reports are immutable after submission and there is no response-time SLA in the free alpha.
          </div>
          <h2 id="report-history-heading" className="mt-7 text-lg font-semibold">Report history</h2>
          {reports.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">No listing reports</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Use the report form on a public skill detail page when you can identify a bounded concern with its current exact version.</p>
              <Link href="/skills" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Browse public skills</Link>
            </div>
          ) : (
            <div className="mt-5 grid gap-4">{reports.map((report) => <ReportCard key={report.reportId} report={report} publicRoute={publicRoutes.get(report.skillId)} />)}</div>
          )}
          {(cursor || nextCursor) ? (
            <nav aria-label="Report history pages" className="mt-6 flex flex-wrap gap-3">
              {cursor ? <Link href="/account/reports" className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">First page</Link> : null}
              {nextCursor ? <Link href={`/account/reports?cursor=${encodeURIComponent(nextCursor)}`} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">Next reports</Link> : null}
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function ReportCard({ report, publicRoute }: { report: ReportProjection; publicRoute?: PublicSkillRoute }) {
  const category = REPORT_CATEGORY_COPY[report.category];
  const publicLinks = buildCurrentPublicSkillLinks(publicRoute, report.versionId);
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${report.state === "queued" ? "border-warning/35 bg-warning/10 text-foreground" : "border-success/30 bg-success/10 text-foreground"}`}>{report.state === "queued" ? "Queued" : "Resolved"}</span>
            <span className="text-xs font-semibold text-primary">{category.label}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{report.message}</p>
        </div>
        <span className="mono break-all text-[11px] text-muted-foreground">{report.reportId}</span>
      </div>
      <dl className="mt-5 grid gap-3 border-t border-border pt-5 text-xs sm:grid-cols-2">
        <Coordinate label="Skill" value={report.skillId} />
        <Coordinate label="Exact version" value={report.versionId} />
      </dl>
      {publicLinks ? (
        <nav aria-label="Reported listing evidence" className="mt-4 flex flex-wrap gap-2">
          <Link href={publicLinks.detail} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">View reported listing</Link>
          <Link href={publicLinks.audit} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">View current audit</Link>
          <Link href={publicLinks.grade} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-accent">View current grade</Link>
        </nav>
      ) : null}
      {report.state === "resolved" ? (
        <div className="mt-5 rounded-xl border border-border bg-muted/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operator disposition · {humanize(report.dispositionCode ?? "resolved")}</p>
          <p className="mt-2 text-sm leading-6">{report.publicResolutionMessage}</p>
          {report.resolutionReasonCode ? <p className="mt-2 text-xs text-muted-foreground">Reason code: <span className="mono">{report.resolutionReasonCode}</span></p> : null}
        </div>
      ) : (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-xs leading-5 text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />Queued means the report was accepted for operator review. It does not mean the listing is confirmed unsafe or scheduled for removal.</p>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Submitted {formatDate(report.createdAt)}{report.resolvedAt ? ` · resolved ${formatDate(report.resolvedAt)}` : ""}</p>
    </article>
  );
}

async function loadCurrentPublicRoutes(skillIds: string[]): Promise<Map<string, PublicSkillRoute>> {
  try {
    return await resolvePublicSkillRoutes(skillIds);
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogQueryError || error instanceof CatalogDataError
      || error instanceof SupabaseConfigurationError) return new Map();
    throw error;
  }
}

function Coordinate({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-semibold text-muted-foreground">{label}</dt><dd className="mono mt-1 break-all text-foreground">{value}</dd></div>;
}

function parseReportProjection(row: Record<string, unknown>): ReportProjection | null {
  const category = typeof row.category === "string" && REPORT_CATEGORIES.includes(row.category as ReportCategory) ? row.category as ReportCategory : null;
  const disposition = row.disposition_code === null || ["confirmed", "no-action", "duplicate", "invalid"].includes(String(row.disposition_code))
    ? row.disposition_code as ReportProjection["dispositionCode"]
    : undefined;
  if (typeof row.report_id !== "string" || !REPORT_PUBLIC_ID.test(row.report_id)
    || typeof row.skill_id !== "string" || !/^skl_[0-9a-f]{32}$/.test(row.skill_id)
    || typeof row.version_id !== "string" || !/^skv_[0-9a-f]{32}$/.test(row.version_id)
    || !category || typeof row.message !== "string" || row.message.length < 10 || row.message.length > 2_000
    || row.message !== row.message.trim() || row.message !== row.message.normalize("NFC") || /[\u0000-\u001f\u007f]/.test(row.message)
    || (row.state !== "queued" && row.state !== "resolved") || disposition === undefined
    || !isTimestamp(row.created_at) || !isTimestamp(row.updated_at)) return null;
  const resolutionReasonCode = optionalBoundedString(row.resolution_reason_code, 64, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const publicResolutionMessage = optionalBoundedString(row.public_resolution_message, 500);
  const resolvedAt = optionalBoundedString(row.resolved_at, 64);
  if (resolutionReasonCode === undefined || publicResolutionMessage === undefined || resolvedAt === undefined) return null;
  if (row.state === "queued" && (disposition !== null || resolutionReasonCode !== null || publicResolutionMessage !== null || resolvedAt !== null)) return null;
  if (row.state === "resolved" && (disposition === null || resolutionReasonCode === null || publicResolutionMessage === null || resolvedAt === null)) return null;
  if (resolvedAt !== null && !isTimestamp(resolvedAt)) return null;
  return {
    reportId: row.report_id,
    skillId: row.skill_id,
    versionId: row.version_id,
    category,
    message: row.message,
    state: row.state,
    dispositionCode: disposition,
    resolutionReasonCode,
    publicResolutionMessage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt
  };
}

function optionalBoundedString(value: unknown, maximum: number, pattern?: RegExp): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))) return undefined;
  return value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unavailable" : date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(new Date(value).valueOf());
}

function humanize(value: string): string {
  return value.replaceAll("-", " ");
}

function ReportsUnavailable() {
  return <main className="min-h-screen bg-background text-foreground"><CatalogHeader accountState="unavailable" /><section className="mx-auto max-w-5xl px-4 py-14 sm:px-6"><div className="rounded-2xl border border-warning/35 bg-warning/10 p-8 text-center"><FileWarning className="mx-auto h-7 w-7 text-warning" /><h1 className="mt-4 text-xl font-semibold">Report history unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Authentication or the owner-filtered report projection could not be verified. No public or fixture fallback was substituted.</p></div></section></main>;
}

function InvalidReportsPage() {
  return <main className="min-h-screen bg-background text-foreground"><CatalogHeader /><section className="mx-auto max-w-5xl px-4 py-14 sm:px-6"><div className="rounded-2xl border border-border bg-card p-8 text-center"><h1 className="text-xl font-semibold">That report-history page link is invalid.</h1><Link href="/account/reports" className="mt-5 inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">Return to report history</Link></div></section></main>;
}
