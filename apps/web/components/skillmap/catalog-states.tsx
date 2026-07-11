import Link from "next/link";
import { AlertTriangle, DatabaseZap } from "lucide-react";

export function CatalogUnavailable({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-warning/35 bg-warning/10 ${compact ? "p-4" : "p-6 sm:p-8"}`} role="status">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <h2 className="font-semibold text-foreground">Hosted catalog unavailable</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Supabase is not configured or cannot be reached in this environment. SkillMap has not substituted fixture data.
          </p>
        </div>
      </div>
    </div>
  );
}

export function EmptyCatalog({ query }: { query: string | null }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
      <DatabaseZap className="mx-auto h-6 w-6 text-primary" />
      <h2 className="mt-4 text-lg font-semibold">{query ? "No matching skills" : "No published skills"}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {query ? "Try a different name or descriptive phrase." : "Nothing has crossed the public catalog gate yet."}
      </p>
      {query ? <Link href="/skills" className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline">Clear search</Link> : null}
    </div>
  );
}
