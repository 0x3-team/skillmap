import Link from "next/link";
import { BookOpen, Route } from "lucide-react";

export function CatalogHeader({ account = false }: { account?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
            <Route className="h-4 w-4" />
          </span>
          SkillMap
        </Link>
        <nav className="flex items-center gap-2 text-sm" aria-label="Hosted library navigation">
          <Link href="/skills" aria-label="Skill library" className="inline-flex h-9 items-center gap-2 rounded-full px-3 font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Skill library</span>
          </Link>
          <Link href={account ? "/account" : "/sign-in"} className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 font-semibold text-foreground hover:border-primary/35 hover:bg-accent/70">
            {account ? "Account" : "Sign in"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
