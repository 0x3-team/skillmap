"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  DatabaseZap,
  Gauge,
  GitBranch,
  LockKeyhole,
  Route,
  Search,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommandPalette, type CommandItem } from "@/components/ui/command-palette";
import { AnimatedNumber } from "@/components/ui/number";
import { getDashboardSnapshot } from "@/lib/fixtures";
import type { HostedAccountState } from "@/lib/auth/account-state";
import type { ReleaseStage } from "@/lib/security/policy";
import { cn } from "@/lib/utils";

const snapshot = getDashboardSnapshot("release-ready");

export function LandingPage({
  releaseStage = "local-candidate",
  accountState = "unavailable"
}: {
  releaseStage?: ReleaseStage;
  accountState?: HostedAccountState;
}) {
  const hosted = releaseStage !== "local-candidate";
  const publicAlpha = releaseStage === "public-alpha";
  const trustCells = trustCellsFor(releaseStage);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [demoTraceId, setDemoTraceId] = useState(snapshot.recentRouteTraces[0]?.id ?? "");
  const [demoAnnouncement, setDemoAnnouncement] = useState(
    "Recorded fixture is ready. No local command has run."
  );
  const demoTrace =
    snapshot.recentRouteTraces.find((trace) => trace.id === demoTraceId) ??
    snapshot.recentRouteTraces[0];
  const runRecordedDemo = () => {
    const selectedTrace = snapshot.recentRouteTraces[1] ?? snapshot.recentRouteTraces[0];
    if (!selectedTrace) return;
    setDemoTraceId(selectedTrace.id);
    setDemoAnnouncement(
      `Recorded fixture selected: ${selectedTrace.promptPreview}. No CLI or connector command was executed.`
    );
    window.setTimeout(() => document.getElementById("recorded-route-result")?.focus(), 0);
  };
  const commands: CommandItem[] = [
    {
      id: "skill-library",
      label: "Browse online skill library",
      group: "Navigation",
      icon: BookOpen,
      onSelect: () => {
        window.location.href = "/skills";
      }
    },
    {
      id: "submit-skill",
      label: "Open submission status",
      group: "Trust alpha",
      icon: BadgeCheck,
      onSelect: () => {
        window.location.href = "/submit";
      }
    },
    {
      id: "grading-methodology",
      label: "Read audit and grade methodology",
      group: "Trust alpha",
      icon: ShieldCheck,
      onSelect: () => {
        window.location.href = "/trust/grading";
      }
    },
    {
      id: "sample-route",
      label: "Run recorded route demo",
      group: "Router Lab",
      icon: Route,
      onSelect: runRecordedDemo
    },
    {
      id: "dashboard",
      label: "Open dashboard",
      group: "Navigation",
      icon: Gauge,
      onSelect: () => {
        window.location.href = "/dashboard";
      }
    },
    {
      id: "trust",
      label: "Inspect local trust state",
      group: "Local product",
      icon: ShieldCheck,
      onSelect: () => {
        window.location.href = "/dashboard#trust";
      }
    }
  ];

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commands} />
      <SiteHeader accountState={accountState} onOpenPalette={() => setPaletteOpen(true)} />

      <section className="border-b border-border">
        <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:px-8">
          <div className="max-w-2xl">
            <AnimatedBadge status="warning" size="md" className="mb-5">
              {publicAlpha
                ? "Free curated trust alpha · public alpha"
                : hosted
                  ? "Free curated trust alpha · private pilot"
                  : "Free curated trust alpha · local candidate"}
            </AnimatedBadge>
            <h1 className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-normal text-foreground sm:text-5xl lg:text-6xl">
              Find agent skills you can inspect before you trust.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              {hosted
                ? "Search source-bound skill records, inspect separate evidence states, save useful skills, and submit exact public GitHub versions with a free account."
                : "Search source-bound skill records, inspect separate evidence states, and save useful skills with a free account. The complete hosted workflow is validated locally; no public deployment or live OAuth path is claimed yet."}
            </p>
            <form action="/skills" method="get" className="mt-8 rounded-2xl border border-border bg-card p-3 shadow-sm">
              <label className="relative block">
                <span className="sr-only">Search the skill library</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Search a job, framework, tool, or skill"
                  className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25"
                />
              </label>
              <button type="submit" className="press mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
                <Search className="h-4 w-4" /> Search skill library
              </button>
            </form>
            <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold" aria-label="Trust alpha actions">
              <Link href="/skills" prefetch={false} className="inline-flex items-center text-primary hover:underline">Browse all skills <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
              <Link href="/submit" prefetch={false} className="text-muted-foreground hover:text-foreground">Submit a skill</Link>
              <Link href="/trust/grading" prefetch={false} className="text-muted-foreground hover:text-foreground">Read methodology</Link>
            </nav>
            <p className="mt-5 max-w-xl text-xs leading-5 text-muted-foreground">
              {hosted
                ? "Free means no billing, checkout, subscription, entitlement, paywall, or Stripe dependency. Submission enters an operator-reviewed queue; static evidence can remain provisional or blocked."
                : "Free means no billing, checkout, subscription, entitlement, paywall, or Stripe dependency. Submission, audit, grade, reporting, and lifecycle workflows are implemented locally and remain unavailable online until deployment acceptance passes."}
            </p>
          </div>

          <AlphaBoundaryPreview releaseStage={releaseStage} />
        </div>
      </section>

      <section className="border-b border-border" id="product">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionIntro
            title="A trust workflow with visible boundaries."
            text={hosted
              ? "Exact-commit submission, bounded audit, provisional grading, and operator review are active parts of this hosted alpha. Every public claim remains tied to explicit evidence and lifecycle state."
              : "The local candidate proves the catalog, account, exact-commit submission, bounded audit, provisional grading, reporting, and operator lifecycle workflow. Hosted availability remains a separate deployment gate."}
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {trustCells.map((cell, index) => (
              <Card
                key={cell.title}
                className={cn(
                  "min-h-48 p-5",
                  index === 0 && "lg:col-span-2 bg-accent/50",
                  index === 3 && "bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent)))]"
                )}
              >
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {cell.icon}
                </div>
                <AnimatedBadge status={cell.status}>{cell.state}</AnimatedBadge>
                <h3 className="mt-3 text-lg font-semibold text-foreground">{cell.title}</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {cell.text}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card/44" id="local-product">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="max-w-xl">
              <AnimatedBadge status="warning">recorded local fixture</AnimatedBadge>
              <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                The local product routes privately today.
              </h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                This secondary demo represents the separate local-first CLI and loopback application. It uses checked-in fixture evidence, does not query the hosted catalog, and does not claim that any skill executed.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={runRecordedDemo}
                >
                  Run recorded demo
                </Button>
                <Link href="/dashboard" className="inline-flex h-10 items-center justify-center px-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
                  Open local dashboard <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <WorkflowStep icon={<DatabaseZap />} title="Index" text="Metadata, aliases, source state, scripts, and families." />
                <WorkflowStep icon={<ShieldCheck />} title="Govern" text="Tiers, blocks, explicit-only rules, and review state." />
                <WorkflowStep icon={<Route />} title="Route" text="Selected skills, reasons, exclusions, and hook text." />
                <WorkflowStep icon={<BadgeCheck />} title="Audit" text="Receipts, eval confidence, and local-safe connector state." />
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold text-muted-foreground" aria-live="polite">
                {demoAnnouncement}
              </p>
              <RouteTracePanel trace={demoTrace} />
            </div>
          </div>
          <div className="mt-8 rounded-xl border border-border bg-background">
            <p className="border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Recorded local fixture metrics · not live catalog data
            </p>
            <div className="grid gap-px lg:grid-cols-4">
              <ProofMetric value={17.5} decimals={1} label="avg route hint tokens" note="recorded fixture audit" />
              <ProofMetric value={185} label="eval prompts" note="recorded fixture sample" />
              <ProofMetric value={100} suffix="%" label="top-3 route hit" note="fixture sample only" />
              <ProofMetric value={0} label="avoid hits" note="recorded fixture sample" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border" id="trust">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionIntro
            title="Read the method before you read the grade."
            text="SkillMap treats audit and grade as version-bound evidence, not shortcuts. Current seeds remain visibly not run, not tested, and ungraded until the named gates exist."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <MethodCard
              icon={<ShieldCheck />}
              eyebrow="Audit methodology"
              title="Inspect untrusted material without executing it."
              text="The audit binds exact source bytes, inventories files and permissions, and publishes bounded findings after operator review. Static analysis can surface risk; it cannot prove universal safety."
              href="/trust/auditing"
              linkLabel="Read auditing methodology"
            />
            <MethodCard
              icon={<BadgeCheck />}
              eyebrow="Grade methodology"
              title="A grade requires a reproducible receipt."
              text="A current letter band requires immutable identity, current audit and compatibility evidence, frozen evaluations, baselines, confidence, and an invalidation policy."
              href="/trust/grading"
              linkLabel="Read grading methodology"
            />
            <Card className="p-5 lg:col-span-2">
              <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <AnimatedBadge status="warning">{hosted ? "hosted alpha boundary" : "pre-deployment boundary"}</AnimatedBadge>
                  <h3 className="mt-3 text-lg font-semibold text-foreground">{hosted ? "Hosted availability does not erase evidence gates." : "Implementation evidence comes before public invitations."}</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {hosted
                      ? "A listing becomes public only through the reviewed operator path. Static scores remain provisional and letterless unless all signed behavioral-evidence gates pass; reports and lifecycle actions remain separate authorities."
                      : "Remote Supabase and web projects, live GitHub OAuth, backups, monitoring, and rollback still need exact-deployment acceptance. Local tests do not prove those states."}
                  </p>
                </div>
                <Link href="/release-status" className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold text-foreground hover:bg-accent">
                  View release status <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 rounded-lg border border-border bg-foreground p-6 text-background sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Start with the evidence, then follow the alpha openly.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-background/72">
              {hosted
                ? "Browse exact-source evidence, save useful skills, or submit one immutable public GitHub version for review. The product stays free with no billing path."
                : "Browse the locally validated catalog boundary now. The complete hosted workflow remains unavailable online until deployment acceptance. The product stays free with no billing path."}
            </p>
          </div>
          <Link
            href="/skills"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-background px-5 text-sm font-semibold text-foreground transition hover:bg-background/90"
          >
            Browse skill evidence
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
      <footer className="border-t border-border px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground" aria-label="Product information">
          <Link href="/getting-started" className="hover:text-foreground">Getting started</Link>
          <Link href="/skills" className="hover:text-foreground">Skill library</Link>
          <Link href="/submit" className="hover:text-foreground">Submit</Link>
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

function SiteHeader({ accountState, onOpenPalette }: { accountState: HostedAccountState; onOpenPalette: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" prefetch={false} className="flex items-center gap-2 font-semibold text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
            <Route className="h-4 w-4" />
          </span>
          SkillMap
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <Link href="/skills" prefetch={false} className="hover:text-foreground">
            Library
          </Link>
          <Link href="/submit" prefetch={false} className="hover:text-foreground">Submit</Link>
          <Link href="/trust/grading" prefetch={false} className="hover:text-foreground">Methodology</Link>
          <a href="#local-product" className="hover:text-foreground">Local product</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open command palette"
            onClick={onOpenPalette}
          >
            <Search className="h-4 w-4" />
          </Button>
          {accountState === "unavailable" ? (
            <span aria-label="Account status unavailable" className="hidden h-10 items-center rounded-lg border border-warning/35 bg-warning/10 px-3 text-sm font-semibold text-muted-foreground sm:inline-flex">Account unavailable</span>
          ) : (
            <Link href={accountState === "authenticated" ? "/account" : "/sign-in"} prefetch={false} className="hidden h-10 items-center justify-center rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lift transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex">
              {accountState === "authenticated" ? "Account" : "Sign in"}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function trustCellsFor(releaseStage: ReleaseStage) {
  const hosted = releaseStage !== "local-candidate";
  return [
    {
      state: hosted ? "hosted alpha" : "catalog candidate",
      status: "info" as const,
      title: "Exact source identity",
      text: "Every record binds a public repository, immutable commit, relative path, version, and entrypoint digest.",
      icon: <GitBranch className="h-4 w-4" />
    },
    {
      state: hosted ? "hosted alpha" : "catalog candidate",
      status: "info" as const,
      title: "Evidence stays separate",
      text: "Publisher, provenance, license, audit, compatibility, lifecycle, and grade states never collapse into one safety badge.",
      icon: <ShieldCheck className="h-4 w-4" />
    },
    {
      state: hosted ? "available under review" : "validated locally",
      status: hosted ? "info" as const : "success" as const,
      title: "Submit, audit, grade",
      text: hosted
        ? "Free accounts can submit exact public GitHub versions. A bounded static audit and provisional grade feed operator review before publication."
        : "The exact-commit submission, bounded static audit, provisional grading, and operator-review workflow passed local acceptance.",
      icon: <BadgeCheck className="h-4 w-4" />
    },
    {
      state: "safety boundary",
      status: "success" as const,
      title: "Submitted code stays inert",
      text: "Review treats skill text, links, and scripts as untrusted evidence. The hosted audit never executes bundled code.",
      icon: <LockKeyhole className="h-4 w-4" />
    },
    {
      state: "launch rule",
      status: "success" as const,
      title: "Free without billing",
      text: "The public launch contains no price, checkout, subscription, entitlement, metering, paywall, or Stripe dependency.",
      icon: <CheckCircle2 className="h-4 w-4" />
    }
  ];
}

function AlphaBoundaryPreview({ releaseStage }: { releaseStage: ReleaseStage }) {
  const hosted = releaseStage !== "local-candidate";
  const publicAlpha = releaseStage === "public-alpha";
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,hsl(var(--accent)),transparent)]" />
      <div className="relative">
        <AnimatedBadge status="info">current hosted boundary</AnimatedBadge>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Know what is proven before you rely on it.</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {hosted
            ? "This hosted alpha accepts exact-source submissions and publishes bounded evidence only through operator review. A static audit is never a universal safety claim."
            : "The catalog, free account, submission, audit, provisional grade, report, and operator workflow have strong local acceptance. Remote deployment remains an explicit gate."}
        </p>
      </div>
      <dl className="relative mt-6 grid gap-3">
        <BoundaryRow
          icon={<BookOpen />}
          label="Catalog and account spine"
          value={publicAlpha ? "public alpha" : hosted ? "private hosted alpha" : "validated locally"}
          tone="success"
        />
        <BoundaryRow
          icon={<BadgeCheck />}
          label="Submission, audit, and grades"
          value={hosted ? "active under review" : "validated locally"}
          tone="success"
        />
        <BoundaryRow
          icon={<DatabaseZap />}
          label={hosted ? "Public indexing" : "Remote deployment and live OAuth"}
          value={publicAlpha ? "operator enabled" : hosted ? "disabled for pilot" : "not verified"}
          tone="warning"
        />
        <BoundaryRow
          icon={<CheckCircle2 />}
          label="Product billing"
          value="absent by design"
          tone="success"
        />
      </dl>
      <div className="relative mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
        <Link href="/release-status" className="inline-flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Inspect release boundary
        </Link>
        <Link href="/getting-started" className="inline-flex h-10 items-center rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent">
          Choose a workflow
        </Link>
      </div>
    </Card>
  );
}

function BoundaryRow({
  icon,
  label,
  value,
  tone
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  tone: "success" | "warning";
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-background/88 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <dt className="flex min-w-0 items-center gap-3 text-sm font-semibold text-foreground">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {label}
      </dt>
      <dd>
        <AnimatedBadge status={tone}>{value}</AnimatedBadge>
      </dd>
    </div>
  );
}

function MethodCard({
  icon,
  eyebrow,
  title,
  text,
  href,
  linkLabel
}: {
  icon: JSX.Element;
  eyebrow: string;
  title: string;
  text: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Card className="flex min-h-64 flex-col p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
          <h3 className="mt-1 text-xl font-semibold text-foreground">{title}</h3>
        </div>
      </div>
      <p className="mt-5 flex-1 text-sm leading-6 text-muted-foreground">{text}</p>
      <Link href={href} className="mt-6 inline-flex items-center text-sm font-semibold text-primary hover:underline">
        {linkLabel} <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </Card>
  );
}

function ProofMetric({
  value,
  suffix = "",
  decimals = 0,
  label,
  note
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  label: string;
  note: string;
}) {
  return (
    <div className="border-b border-border bg-card/72 p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <p className="text-3xl font-semibold text-foreground">
        <AnimatedNumber value={value} suffix={suffix} decimals={decimals} />
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function SectionIntro({ title, text }: { title: string; text: string }) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function WorkflowStep({
  icon,
  title,
  text
}: {
  icon: JSX.Element;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

function RouteTracePanel({
  trace
}: {
  trace: (typeof snapshot.recentRouteTraces)[number] | undefined;
}) {
  if (!trace) return null;
  return (
    <Card
      id="recorded-route-result"
      tabIndex={-1}
      aria-label="Recorded fixture route result"
      className="overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="border-b border-border p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Recorded fixture result</h3>
            <p className="mt-1 text-sm text-muted-foreground">{trace.promptPreview}</p>
          </div>
          <AnimatedBadge status="info">{trace.hookChars} chars</AnimatedBadge>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_0.72fr]">
        <div className="p-5">
          <div className="space-y-3">
            {trace.recommendations.map((candidate) => (
              <div key={candidate.name} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-semibold text-foreground">
                    {candidate.name}
                  </p>
                  <AnimatedBadge status="success">
                    {Math.round(candidate.score * 100)}%
                  </AnimatedBadge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.family ?? "unclassified"} / {candidate.tier}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border bg-accent/28 p-5 lg:border-l lg:border-t-0">
          <p className="text-sm font-semibold text-foreground">Excluded safely</p>
          <div className="mt-3 space-y-2">
            {trace.exclusions.slice(0, 3).map((exclusion) => (
              <div key={exclusion.name} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <AnimatedBadge
                    status={exclusion.severity === "blocked" ? "danger" : "warning"}
                  >
                    {exclusion.severity}
                  </AnimatedBadge>
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {exclusion.name}
                  </p>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {exclusion.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
