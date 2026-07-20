import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="max-w-md rounded-xl border border-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">404</p>
        <h1 className="mt-3 text-2xl font-semibold">That SkillMap route does not exist.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Return to the recorded public overview or use the one-time URL printed by <code>skillmap dashboard</code> for the live local product.</p>
        <Link href="/" className="mt-5 inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Return home</Link>
      </div>
    </main>
  );
}
