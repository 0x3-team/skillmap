import Link from "next/link";
import { BookOpen, FilePlus2, LifeBuoy, Route, Scale } from "lucide-react";
import { resolveHostedAccountState } from "@/lib/auth/account-state.server";
import type { HostedAccountState } from "@/lib/auth/account-state";

export async function CatalogHeader({ accountState }: { accountState?: HostedAccountState }) {
  const resolvedAccountState = accountState ?? await resolveHostedAccountState();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" prefetch={false} className="flex items-center gap-2 font-semibold text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
            <Route className="h-4 w-4" />
          </span>
          SkillMap
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Hosted library navigation">
          <Link href="/skills" prefetch={false} aria-label="Skill library" className="inline-flex h-9 items-center gap-2 rounded-full px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground lg:px-3">
            <BookOpen className="h-4 w-4" />
            <span className="hidden lg:inline">Library</span>
          </Link>
          <Link href="/submit" prefetch={false} aria-label="Submit a skill" className="inline-flex h-9 items-center gap-2 rounded-full px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground lg:px-3">
            <FilePlus2 className="h-4 w-4" />
            <span className="hidden lg:inline">Submit</span>
          </Link>
          <Link href="/trust/grading" prefetch={false} aria-label="Audit and grade methodology" className="hidden h-9 items-center gap-2 rounded-full px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex lg:px-3">
            <Scale className="h-4 w-4" />
            <span className="hidden lg:inline">Methodology</span>
          </Link>
          <Link href="/support" prefetch={false} aria-label="Support" className="hidden h-9 items-center gap-2 rounded-full px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex lg:px-3">
            <LifeBuoy className="h-4 w-4" />
            <span className="hidden lg:inline">Support</span>
          </Link>
          {resolvedAccountState === "unavailable" ? (
            <span aria-label="Account status unavailable" className="inline-flex h-9 items-center rounded-full border border-warning/35 bg-warning/10 px-2 text-xs font-semibold text-muted-foreground sm:px-3.5 sm:text-sm">
              <span className="sm:hidden">Unavailable</span><span className="hidden sm:inline">Account unavailable</span>
            </span>
          ) : (
            <Link href={resolvedAccountState === "authenticated" ? "/account" : "/sign-in"} prefetch={false} className="inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 font-semibold text-foreground hover:border-primary/35 hover:bg-accent/70">
              {resolvedAccountState === "authenticated" ? "Account" : "Sign in"}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
