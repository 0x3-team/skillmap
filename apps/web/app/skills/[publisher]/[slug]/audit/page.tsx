import { CatalogHeader } from "@/components/skillmap/catalog-header";
import type { Metadata } from "next";
import {
  EvidenceFact,
  EvidenceFacts,
  EvidencePageShell,
  EvidenceUnavailable,
  JsonEvidence,
  ProjectionBoundary
} from "@/components/skillmap/public-evidence";
import { EvidenceDataError, EvidenceQueryError, getPublicAuditEvidence } from "@/lib/evidence/repository.server";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { getPublicSkillByRoute } from "@/lib/registry/repository.server";
import { buildPublicPageMetadata, buildUnavailableMetadata } from "@/lib/metadata";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publisher: string; slug: string }> }): Promise<Metadata> {
  const { publisher, slug } = await params;
  try {
    const skill = await getPublicSkillByRoute(publisher, slug);
    if (!skill) return buildUnavailableMetadata("Audit evidence not found | SkillMap", "This public SkillMap audit evidence route is unavailable.");
    return buildPublicPageMetadata({
      title: `${skill.displayName} audit evidence | SkillMap`,
      description: `Bounded current-version static audit evidence for ${skill.displayName} by ${skill.publisher.displayName}.`,
      path: `/skills/${publisher}/${slug}/audit`
    });
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogQueryError || error instanceof CatalogDataError || error instanceof SupabaseConfigurationError) {
      return buildUnavailableMetadata("Audit evidence unavailable | SkillMap", "This public SkillMap audit evidence route could not be validated.");
    }
    throw error;
  }
}

export default async function PublicAuditEvidencePage({ params }: { params: Promise<{ publisher: string; slug: string }> }) {
  const { publisher, slug } = await params;
  let skill;
  let evidence;
  try {
    skill = await getPublicSkillByRoute(publisher, slug);
    if (!skill) notFound();
    evidence = await getPublicAuditEvidence(skill.skillId, skill.currentVersion.versionId);
  } catch (error) {
    if (error instanceof CatalogInputError) notFound();
    if (error instanceof CatalogQueryError || error instanceof CatalogDataError || error instanceof EvidenceQueryError
      || error instanceof EvidenceDataError || error instanceof SupabaseConfigurationError) {
      return <EvidenceError kind="audit" />;
    }
    throw error;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <EvidencePageShell publisher={publisher} slug={slug} eyebrow="Current version evidence" title={`${skill.displayName} audit evidence`} intro="Static inspection evidence bound to the exact source commit currently published in the catalog. It describes observed signals and policy output, not an execution guarantee or permanent safety claim.">
        <ProjectionBoundary viewName="api.catalog_audit_evidence" methodologyPath="/trust/auditing" methodologyLabel="Read the audit methodology" />
        {evidence ? (
          <section className="py-8" aria-labelledby="audit-result-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="audit-result-heading" className="text-xl font-semibold">Audit result</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${evidence.state === "passed" ? "border-success/30 bg-success/10" : evidence.state === "warnings" ? "border-warning/35 bg-warning/10" : "border-destructive/30 bg-destructive/10"}`}>{humanize(evidence.state)}</span>
            </div>
            <EvidenceFacts>
              <EvidenceFact label="Audit receipt" value={evidence.auditReceiptId} mono />
              <EvidenceFact label="Canonical evidence digest" value={evidence.receiptDigest} mono />
              <EvidenceFact label="Skill / version" value={`${evidence.skillId} · ${evidence.versionId}`} mono />
              <EvidenceFact label="Exact source commit" value={evidence.sourceCommit} mono />
              <EvidenceFact label="Audited" value={formatDate(evidence.auditedAt)} />
              <EvidenceFact label="Policy / host / worker" value={`${evidence.policyVersion} · ${evidence.hostProfileVersion} · ${evidence.workerVersion}`} />
              <EvidenceFact label="License evidence" value={`${humanize(evidence.licenseState)}${evidence.spdxExpression ? ` · ${evidence.spdxExpression}` : ""}`} />
              <EvidenceFact label="Indicators" value={`scripts ${yesNo(evidence.permissionScripts)} · network ${yesNo(evidence.networkIndicators)} · tools ${yesNo(evidence.toolIndicators)}`} />
            </EvidenceFacts>
            <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
              <JsonEvidence title="Finding counts" value={evidence.findingCounts} />
              <JsonEvidence title="Public checks" value={evidence.checks} />
            </div>
            <ReasonCodes values={evidence.reasonCodes} />
          </section>
        ) : <EvidenceUnavailable kind="audit" />}
      </EvidencePageShell>
    </main>
  );
}

function ReasonCodes({ values }: { values: string[] }) {
  return <div className="mt-5"><h3 className="text-sm font-semibold">Reason codes</h3>{values.length ? <div className="mt-3 flex flex-wrap gap-2">{values.map((value) => <span key={value} className="mono rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{value}</span>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No public reason codes were emitted.</p>}</div>;
}

function EvidenceError({ kind }: { kind: string }) {
  return <main className="min-h-screen bg-background text-foreground"><CatalogHeader /><section className="mx-auto max-w-5xl px-4 py-14 sm:px-6"><div className="rounded-2xl border border-warning/35 bg-warning/10 p-8 text-center"><h1 className="text-xl font-semibold">Public {kind} evidence unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The public catalog or bounded evidence projection could not be validated. No stale or private fallback was shown.</p></div></section></main>;
}

function humanize(value: string) { return value.replaceAll("-", " "); }
function yesNo(value: boolean) { return value ? "detected" : "not detected"; }
function formatDate(value: string) { return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }); }
