import Link from "next/link";
import { ArrowLeft, FileSearch, ShieldAlert } from "lucide-react";

export function EvidencePageShell({
  publisher,
  slug,
  eyebrow,
  title,
  intro,
  children
}: {
  publisher: string;
  slug: string;
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href={`/skills/${publisher}/${slug}`} className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to skill detail</Link>
      <header className="mt-7 border-b border-border pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">{intro}</p>
      </header>
      {children}
    </div>
  );
}

export function ProjectionBoundary({ viewName, methodologyPath, methodologyLabel }: { viewName: string; methodologyPath: string; methodologyLabel: string }) {
  return (
    <section className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6" aria-labelledby="projection-boundary-heading">
      <div className="flex items-start gap-3">
        <FileSearch className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 id="projection-boundary-heading" className="font-semibold">Bounded public evidence projection</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This page reads only <span className="mono text-xs text-foreground">{viewName}</span>. The receipt digest identifies the retained evidence, but this is not the full private receipt envelope and exposes no public <span className="mono text-xs">projectionDigest</span>. Private evidence, submitter data, worker internals, and operator notes remain excluded.
          </p>
          <Link href={methodologyPath} className="mt-3 inline-flex text-sm font-semibold text-primary underline underline-offset-4">{methodologyLabel}</Link>
        </div>
      </div>
    </section>
  );
}

export function EvidenceUnavailable({ kind }: { kind: "audit" | "grade" }) {
  return (
    <div className="mt-8 rounded-2xl border border-warning/35 bg-warning/10 p-8 text-center" role="status">
      <ShieldAlert className="mx-auto h-7 w-7 text-warning" />
      <h2 className="mt-4 text-xl font-semibold">No current public {kind} evidence</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        The exact current public version has no row in the bounded {kind} evidence projection. SkillMap does not substitute catalog summary fields, stale receipts, private records, or fixtures.
      </p>
    </div>
  );
}

export function EvidenceFacts({ children }: { children: React.ReactNode }) {
  return <dl className="mt-6 grid gap-3 sm:grid-cols-2">{children}</dl>;
}

export function EvidenceFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 rounded-xl border border-border bg-card p-4"><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className={`mt-2 ${mono ? "mono break-all text-xs" : "text-sm font-semibold"}`}>{value}</dd></div>;
}

export function JsonEvidence({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <pre className="mono mt-3 max-h-[30rem] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/55 p-3 text-[11px] leading-5 text-foreground">{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}
