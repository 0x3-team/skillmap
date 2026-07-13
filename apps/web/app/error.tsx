"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="max-w-md rounded-xl border border-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-destructive">Route unavailable</p>
        <h1 className="mt-3 text-2xl font-semibold">This SkillMap route could not be completed.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Retry this route. SkillMap does not claim that a save, submission, report, account action, or evidence read completed unless its authoritative state is visible.</p>
        <button className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background" type="button" onClick={reset}>Retry</button>
      </div>
    </main>
  );
}
