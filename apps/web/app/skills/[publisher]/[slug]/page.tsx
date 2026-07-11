import Link from "next/link";
import { ArrowLeft, Bookmark, Check, ExternalLink, FileKey2, GitCommitHorizontal, ShieldQuestion } from "lucide-react";
import { notFound } from "next/navigation";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable } from "@/components/skillmap/catalog-states";
import { GradePill, humanize } from "@/components/skillmap/skill-card";
import { saveSkill, unsaveSkill } from "@/app/account/actions";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { getPublicSkillByRoute } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({
  params
}: {
  params: Promise<{ publisher: string; slug: string }>;
}) {
  const { publisher, slug } = await params;
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
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    signedIn = typeof userId === "string";
    if (signedIn) {
      const { data: savedRow } = await supabase.from("saved_skills").select("skill_id").eq("skill_id", skill.skillId).maybeSingle();
      saved = Boolean(savedRow);
    }
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
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
        </article>

        <aside className="h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Version {skill.currentVersion.version}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            License: {skill.license.spdxExpression ?? humanize(skill.license.state)} · redistribution: {humanize(skill.license.redistribution)} · artifact: {humanize(skill.artifact.availability)}.
          </p>
          {signedIn ? (
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
