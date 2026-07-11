"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Braces,
  CheckCircle2,
  Command,
  DatabaseZap,
  Gauge,
  GitBranch,
  LockKeyhole,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow,
  Zap
} from "lucide-react";
import { useState } from "react";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommandPalette, type CommandItem } from "@/components/ui/command-palette";
import { AnimatedNumber } from "@/components/ui/number";
import { getDashboardSnapshot, percent } from "@/lib/fixtures";
import { cn } from "@/lib/utils";

const snapshot = getDashboardSnapshot("release-ready");

const serviceCells = [
  {
    title: "Registry outside context",
    text: "The local skill map stays outside the agent prompt while metadata, policy, and provenance remain queryable.",
    icon: <DatabaseZap className="h-4 w-4" />
  },
  {
    title: "Compact route hints",
    text: "Agents receive selected skills, exclusions, and reasons without loading broad catalogs or full bodies.",
    icon: <Route className="h-4 w-4" />
  },
  {
    title: "Policy receipts",
    text: "Operators can see which skills were held, preferred, blocked, reviewed, or marked explicit-only.",
    icon: <ShieldCheck className="h-4 w-4" />
  },
  {
    title: "Redacted snapshot handoff",
    text: "The dashboard can load a redacted local export in read-only mode; it cannot execute commands or mutate skill roots.",
    icon: <LockKeyhole className="h-4 w-4" />
  },
  {
    title: "Reusable operating model",
    text: "Skill curation becomes an auditable local workflow today, with shared control-plane features reserved for later phases.",
    icon: <Workflow className="h-4 w-4" />
  }
];

export function LandingPage() {
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
      label: "Inspect trust state",
      group: "Trust",
      icon: ShieldCheck,
      onSelect: () => {
        window.location.href = "/dashboard#trust";
      }
    }
  ];

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commands} />
      <SiteHeader onOpenPalette={() => setPaletteOpen(true)} />

      <section className="border-b border-border">
        <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
          <div className="max-w-2xl">
            <AnimatedBadge status="info" size="md" className="mb-5">
              Local-first skill intelligence
            </AnimatedBadge>
            <h1 className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-normal text-foreground sm:text-5xl lg:text-6xl">
              The skill layer agents should not hold in context.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Index, rank, and govern local skill libraries while agents receive only compact, evidence-backed route hints.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                icon={<Gauge className="h-4 w-4" />}
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                Open dashboard
              </Button>
              <Button
                size="lg"
                variant="secondary"
                icon={<Command className="h-4 w-4" />}
                onClick={runRecordedDemo}
              >
                Run recorded demo
              </Button>
            </div>
          </div>

          <HeroRoutePreview trace={demoTrace} onPalette={() => setPaletteOpen(true)} />
        </div>
      </section>

      <section className="border-b border-border bg-card/36">
        <div className="mx-auto grid max-w-7xl gap-px px-4 py-6 sm:px-6 lg:grid-cols-4 lg:px-8">
          <ProofMetric value={17.5} decimals={1} label="avg route hint tokens" note="recorded fixture audit" />
          <ProofMetric value={185} label="eval prompts" note="recorded fixture sample" />
          <ProofMetric value={100} suffix="%" label="top-3 route hit" note="fixture sample only" />
          <ProofMetric value={0} label="avoid hits" note="recorded fixture sample" />
        </div>
      </section>

      <section className="border-b border-border" id="product">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionIntro
            title="A working local product with explicit evidence boundaries."
            text="SkillMap reduces context load, makes curation auditable, and keeps every route tied to the snapshot that produced it."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {serviceCells.map((cell, index) => (
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
                <h3 className="text-lg font-semibold text-foreground">{cell.title}</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {cell.text}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card/44" id="router">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              Route the job. Keep the body outside.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The router returns a narrow recommendation set with why it matched, which skills were excluded, and how much context was avoided.
            </p>
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
      </section>

      <section className="border-b border-border" id="trust">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionIntro
            title="Built around trust boundaries."
            text="The UI should show what is verified, redacted, stale, risky, local-only, or blocked before anyone treats a skill as safe."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <DashboardPreview />
            <Card className="p-5">
              <h3 className="text-lg font-semibold text-foreground">Product value today</h3>
              <div className="mt-5 grid gap-3">
                <ValueRow icon={<Zap />} title="Token estimates visible in each selected snapshot" />
                <ValueRow icon={<GitBranch />} title="Policy curation instead of private-folder guesses" />
                <ValueRow icon={<TerminalSquare />} title="Read-only snapshot handoff keeps operator control" />
                <ValueRow icon={<BookOpen />} title="Source provenance and review receipts" />
                <ValueRow icon={<Braces />} title="Raw prompt and path redaction by default" />
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 rounded-lg border border-border bg-foreground p-6 text-background sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Make skills a governed local layer.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-background/72">
              This hosted page is a recorded demo or redacted snapshot viewer. Live local routing is served separately by the foreground <code>skillmap dashboard</code> command; accounts, team sync, billing, and hosted command execution are not features of this build.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-background px-5 text-sm font-semibold text-foreground transition hover:bg-background/90"
          >
            Open dashboard
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
      <footer className="border-t border-border px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground" aria-label="Product information">
          <Link href="/getting-started" className="hover:text-foreground">Getting started</Link>
          <Link href="/security" className="hover:text-foreground">Security</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/release-status" className="hover:text-foreground">Release status</Link>
          <Link href="/support" className="hover:text-foreground">Support</Link>
        </nav>
      </footer>
    </main>
  );
}

function SiteHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
            <Route className="h-4 w-4" />
          </span>
          SkillMap
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <a href="#product" className="hover:text-foreground">
            Product
          </a>
          <a href="#router" className="hover:text-foreground">
            Router
          </a>
          <a href="#trust" className="hover:text-foreground">
            Trust
          </a>
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
          <Button
            className="hidden sm:inline-flex"
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            Dashboard
          </Button>
        </div>
      </div>
    </header>
  );
}

function HeroRoutePreview({
  trace,
  onPalette
}: {
  trace: (typeof snapshot.recentRouteTraces)[number] | undefined;
  onPalette: () => void;
}) {
  if (!trace) return null;
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,hsl(var(--accent)),transparent)]" />
      <div className="relative mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Router Lab</p>
            <AnimatedBadge status="warning">recorded fixture</AnimatedBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {trace.promptPreview}
          </p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Search routes"
          onClick={onPalette}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative rounded-lg border border-border bg-background p-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Recommended skills
        </div>
        <div className="space-y-2">
          {trace.recommendations.map((skill) => (
            <div key={skill.name} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {skill.name}
                </p>
                <AnimatedBadge status="success">{Math.round(skill.score * 100)}%</AnimatedBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skill.reasons.slice(0, 2).map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-semibold text-muted-foreground">Hook text</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{trace.hookText}</p>
        </div>
        <div className="rounded-lg border border-primary/25 bg-primary/10 p-3">
          <p className="text-xs font-semibold text-primary">Token estimate</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            <AnimatedNumber value={snapshot.tokenMetrics.hookTokensMean ?? 0} decimals={1} />
          </p>
          <p className="text-xs text-muted-foreground">avg route hint tokens</p>
        </div>
      </div>
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

function DashboardPreview() {
  const trace = snapshot.recentRouteTraces[1];

  return (
    <Card className="overflow-hidden">
      <div className="grid border-b border-border md:grid-cols-4">
        <PreviewMetric label="Fixture status" value={snapshot.status.label} status="success" />
        <PreviewMetric
          label="Token impact"
          value={`${snapshot.tokenMetrics.tokensAvoidedVsCatalog?.toLocaleString()} avoided`}
          status="info"
        />
        <PreviewMetric label="Confidence" value={snapshot.productivity.evalConfidence} />
        <PreviewMetric label="Top-3" value={percent(snapshot.productivity.top3Rate)} />
      </div>
      <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Recorded fixture trace</p>
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="font-semibold text-foreground">{trace.promptPreview}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {trace.recommendations.map((candidate) => (
                <AnimatedBadge key={candidate.name} status="info">
                  {candidate.name}
                </AnimatedBadge>
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-card p-3 text-sm leading-6 text-muted-foreground">
              {trace.hookText}
            </div>
          </div>
        </div>
        <div className="border-t border-border bg-accent/26 p-5 lg:border-l lg:border-t-0">
          <p className="mb-3 text-sm font-semibold text-foreground">Trust state</p>
          <div className="space-y-3">
            <TrustLine icon={<CheckCircle2 />} label="Redaction enabled" value="true" />
            <TrustLine icon={<BookOpen />} label="Model label" value="user-reported" />
            <TrustLine icon={<Braces />} label="Raw prompt stored" value="false" />
          </div>
        </div>
      </div>
    </Card>
  );
}

function PreviewMetric({
  label,
  value,
  status = "neutral"
}: {
  label: string;
  value: string;
  status?: "neutral" | "success" | "info";
}) {
  return (
    <div className="border-b border-border p-4 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-semibold",
          status === "success" && "text-emerald-700 dark:text-emerald-300",
          status === "info" && "text-primary",
          status === "neutral" && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function TrustLine({
  icon,
  label,
  value
}: {
  icon: JSX.Element;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="mono shrink-0 text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ValueRow({ icon, title }: { icon: JSX.Element; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
    </div>
  );
}
