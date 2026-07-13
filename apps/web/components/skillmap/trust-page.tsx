import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Route, TerminalSquare } from "lucide-react";

export function TrustPage({
  eyebrow,
  title,
  intro,
  children
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
              <Route className="h-4 w-4" />
            </span>
            SkillMap
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to overview
          </Link>
        </div>
      </header>
      <article className="mx-auto min-w-0 max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{intro}</p>
        <div className="mt-12 grid min-w-0 gap-5">{children}</div>
      </article>
      <footer className="border-t border-border">
        <nav className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-3 px-4 py-8 text-sm text-muted-foreground sm:px-6" aria-label="Product information">
          <Link href="/getting-started" className="hover:text-foreground">Getting started</Link>
          <Link href="/trust/auditing" className="hover:text-foreground">Auditing</Link>
          <Link href="/trust/grading" className="hover:text-foreground">Grading</Link>
          <Link href="/security" className="hover:text-foreground">Security</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/release-status" className="hover:text-foreground">Release status</Link>
          <Link href="/support" className="hover:text-foreground">Support</Link>
        </nav>
      </footer>
    </main>
  );
}

export function TrustSection({ title, children, command }: { title: string; children: ReactNode; command?: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-7">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 min-w-0 space-y-3 text-sm leading-7 text-muted-foreground">{children}</div>
      {command ? (
        <pre className="mt-5 max-w-full overflow-x-auto rounded-lg border border-border bg-background p-4 text-xs text-foreground"><code>{command}</code></pre>
      ) : null}
    </section>
  );
}

export function BoundaryList({ items }: { items: string[] }) {
  return <ul className="grid gap-2">{items.map((item) => <li key={item} className="flex gap-3"><TerminalSquare className="mt-1 h-4 w-4 shrink-0 text-primary" /><span>{item}</span></li>)}</ul>;
}
