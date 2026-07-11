export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground" aria-busy="true">
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm font-semibold">Loading SkillMap evidence…</p>
        <p className="mt-2 text-xs text-muted-foreground">The source mode and integrity receipt will remain visible when the route is ready.</p>
      </div>
    </main>
  );
}
