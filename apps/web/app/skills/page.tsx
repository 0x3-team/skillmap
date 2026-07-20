import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { CatalogUnavailable, EmptyCatalog } from "@/components/skillmap/catalog-states";
import { SkillCard } from "@/components/skillmap/skill-card";
import { CatalogDataError, CatalogInputError, CatalogQueryError } from "@/lib/registry/errors";
import { listPublicSkills } from "@/lib/registry/repository.server";
import { buildPublicPageMetadata } from "@/lib/metadata";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Skill library | SkillMap",
  description: "Browse exact-source agent skills with separate provenance, license, audit, compatibility, lifecycle, and grade evidence.",
  path: "/skills"
});

export const dynamic = "force-dynamic";

export default async function SkillsPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string | string[];
    limit?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  let result;
  try {
    const params = await searchParams;
    result = await listPublicSkills({
      q: scalarCatalogParameter(params.q, "q"),
      limit: scalarCatalogParameter(params.limit, "limit"),
      cursor: scalarCatalogParameter(params.cursor, "cursor")
    });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError || error instanceof CatalogQueryError || error instanceof CatalogDataError) {
      return <SkillsShell><CatalogUnavailable /></SkillsShell>;
    }
    if (error instanceof CatalogInputError) {
      return (
        <SkillsShell>
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive" role="alert">
            <h1 className="text-lg font-semibold text-foreground">Catalog query rejected</h1>
            <p className="mt-2">{error.message} <Link href="/skills" className="font-semibold underline">Reset the catalog query</Link>.</p>
          </div>
        </SkillsShell>
      );
    }
    throw error;
  }

  const nextHref = result.pagination.nextCursor
    ? `/skills?${new URLSearchParams({
        ...(result.query.q ? { q: result.query.q } : {}),
        limit: String(result.query.limit),
        cursor: result.pagination.nextCursor
      }).toString()}`
    : null;

  return (
    <SkillsShell>
      <div className="flex flex-col gap-7 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Online skill library</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Inspect the evidence before the instruction body.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Catalog size and evidence state reflect the current environment. Every visible record keeps source, license, audit, compatibility, lifecycle, and grade state distinct.
          </p>
        </div>
        <p className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          {result.items.length} shown · {result.pagination.hasMore ? "more available" : "end of result"}
        </p>
      </div>

      <form action="/skills" method="get" className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search skills</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={result.query.q ?? ""} maxLength={200} placeholder="Search name, summary, or description" className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
        </label>
        <button type="submit" className="press h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Search library</button>
      </form>

      <div className="mt-8">
        {result.items.length === 0 ? (
          <EmptyCatalog query={result.query.q} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.items.map((skill) => <SkillCard key={skill.skillId} skill={skill} />)}
          </div>
        )}
      </div>

      {nextHref ? (
        <div className="mt-8 flex justify-center">
          <Link href={nextHref} className="inline-flex h-10 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold hover:border-primary/35 hover:bg-accent">Next page</Link>
        </div>
      ) : null}
    </SkillsShell>
  );
}

function scalarCatalogParameter(
  value: string | string[] | undefined,
  name: "q" | "limit" | "cursor"
): string | undefined {
  if (Array.isArray(value)) {
    throw new CatalogInputError("INVALID_QUERY", `Repeated ${name} parameters are not allowed.`);
  }
  return value;
}

function SkillsShell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background text-foreground">
      <CatalogHeader />
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">{children}</section>
    </main>
  );
}
