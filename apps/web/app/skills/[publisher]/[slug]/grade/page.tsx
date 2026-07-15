import { CatalogHeader } from "@/components/skillmap/catalog-header";
import type { Metadata } from "next";
import {
  EvidenceFact,
  EvidenceFacts,
  EvidencePageShell,
  EvidenceUnavailable,
  GradeDimensionList,
  GradeGateList,
  ProjectionBoundary,
  ReasonCodeList
} from "@/components/skillmap/public-evidence";
import { EvidenceDataError, EvidenceQueryError, getPublicGradeEvidence } from "@/lib/evidence/repository.server";
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
    if (!skill) return buildUnavailableMetadata("Grade evidence not found | SkillMap", "This public SkillMap grade evidence route is unavailable.");
    return buildPublicPageMetadata({
      title: `${skill.displayName} grade evidence | SkillMap`,
      description: `Bounded current-version provisional or blocked grade evidence for ${skill.displayName} by ${skill.publisher.displayName}.`,
      path: `/skills/${publisher}/${slug}/grade`
    });
  } catch (error) {
    if (error instanceof CatalogInputError || error instanceof CatalogQueryError || error instanceof CatalogDataError || error instanceof SupabaseConfigurationError) {
      return buildUnavailableMetadata("Grade evidence unavailable | SkillMap", "This public SkillMap grade evidence route could not be validated.");
    }
    throw error;
  }
}

export default async function PublicGradeEvidencePage({ params }: { params: Promise<{ publisher: string; slug: string }> }) {
  const { publisher, slug } = await params;
  let skill;
  let evidence;
  try {
    skill = await getPublicSkillByRoute(publisher, slug);
    if (!skill) notFound();
    evidence = await getPublicGradeEvidence(skill.skillId, skill.currentVersion.versionId);
  } catch (error) {
    if (error instanceof CatalogInputError) notFound();
    if (error instanceof CatalogQueryError || error instanceof CatalogDataError || error instanceof EvidenceQueryError
      || error instanceof EvidenceDataError || error instanceof SupabaseConfigurationError) {
      return <EvidenceError />;
    }
    throw error;
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <EvidencePageShell publisher={publisher} slug={slug} eyebrow="Current version evidence" title={`${skill.displayName} grade evidence`} intro="Version-bound evaluation evidence for the exact currently published source commit. Alpha grades remain provisional or blocked; this page does not promote them to a current grade.">
        <ProjectionBoundary viewName="api.catalog_grade_evidence" methodologyPath="/trust/grading" methodologyLabel="Read the grading methodology" />
        {evidence ? (
          <section className="py-8" aria-labelledby="grade-result-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="grade-result-heading" className="text-xl font-semibold">Grade result</h2>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${evidence.state === "provisional" ? "border-primary/30 bg-primary/10" : "border-destructive/30 bg-destructive/10"}`}>{humanize(evidence.state)}</span>
            </div>
            <EvidenceFacts>
              <EvidenceFact label="Grade receipt" value={evidence.gradeReceiptId} mono />
              <EvidenceFact label="Canonical evidence digest" value={evidence.receiptDigest} mono />
              <EvidenceFact label="Linked audit receipt" value={`${evidence.auditReceiptId} · ${evidence.auditReceiptDigest}`} mono />
              <EvidenceFact label="Skill / version" value={`${evidence.skillId} · ${evidence.versionId}`} mono />
              <EvidenceFact label="Exact source commit" value={evidence.sourceCommit} mono />
              <EvidenceFact label="Graded" value={formatDate(evidence.gradedAt)} />
              <EvidenceFact label="Score / confidence" value={evidence.state === "provisional" ? `${evidence.totalScore?.toFixed(1)} / 100 · ${Math.round((evidence.confidence ?? 0) * 100)}% confidence` : "Blocked · score and confidence intentionally absent"} />
              <EvidenceFact label="Rubric / host / evaluator" value={`${evidence.rubricVersion} · ${evidence.hostProfileVersion} · ${evidence.evaluatorVersion}`} />
              <EvidenceFact
                label="Compatibility evidence"
                value={evidence.compatibilityEvidenceDigest ?? "Not bound · the compatibility hard gate did not pass"}
                mono={Boolean(evidence.compatibilityEvidenceDigest)}
              />
              <EvidenceFact label="Evaluation suite" value={evidence.evaluationSuiteDigest ?? "Not run / none recorded for this provisional evaluation"} mono={Boolean(evidence.evaluationSuiteDigest)} />
            </EvidenceFacts>
            <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
              <GradeGateList gates={evidence.hardGates} />
              <GradeDimensionList dimensions={evidence.dimensions} />
            </div>
            <div className="mt-5"><h3 className="text-sm font-semibold">Why this grade has its current state</h3><ReasonCodeList values={evidence.reasonCodes} emptyLabel="No public grade reason codes were emitted." /></div>
          </section>
        ) : <EvidenceUnavailable kind="grade" />}
      </EvidencePageShell>
    </main>
  );
}

function EvidenceError() {
  return <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground"><CatalogHeader /><section className="mx-auto max-w-5xl px-4 py-14 sm:px-6"><div className="rounded-2xl border border-warning/35 bg-warning/10 p-8 text-center"><h1 className="text-xl font-semibold">Public grade evidence unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The public catalog or bounded evidence projection could not be validated. No stale or private fallback was shown.</p></div></section></main>;
}

function humanize(value: string) { return value.replaceAll("-", " "); }
function formatDate(value: string) { return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }); }
