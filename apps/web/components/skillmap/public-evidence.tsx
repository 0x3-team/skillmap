import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSearch, ShieldAlert, XCircle } from "lucide-react";
import type {
  PublicAuditCheck,
  PublicFindingCounts,
  PublicGradeDimension,
  PublicGradeHardGate
} from "@/lib/evidence/projection";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

const EVIDENCE_CODE_EXPLANATIONS: Readonly<Record<string, string>> = {
  "audit-acceptable": "The linked static-audit outcome satisfies this rubric gate.",
  "behavioral-evidence-bound": "A frozen behavioral evaluation suite must be bound before a current letter grade is possible.",
  "behavioral-evidence-incomplete": "Required behavioral evaluation evidence is incomplete, so this result remains provisional and letterless.",
  "compatibility-evidence-bound": "The receipt is bound to the named host compatibility evidence.",
  "instruction-quality": "Clarity, frontmatter validity, workflow completeness, and bounded instructions.",
  "license-confirmed": "Reviewed license evidence permits this metadata-only publication state.",
  "maintenance-and-provenance": "Source pinning, license evidence, freshness, and maintenance signals.",
  reproducibility: "Immutable inputs, deterministic evidence, and safe path behavior.",
  "routing-quality": "Trigger specificity, exclusions, and description quality.",
  "safety-and-permissions": "Static risk findings plus disclosed script, network, and tool needs.",
  "source-identity": "The repository, immutable commit, relative path, and content identity are bound.",
  "source-integrity": "The published evidence matches the retained exact-source identity."
};

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

export function AuditFindingSummary({ value }: { value: PublicFindingCounts }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Finding counts</h3>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SEVERITIES.map((severity) => (
          <div key={severity} className="rounded-lg bg-muted/55 p-3 text-center">
            <dt className="text-xs font-medium capitalize text-muted-foreground">{severity}</dt>
            <dd className="mt-1 text-lg font-semibold">{value[severity]}</dd>
          </div>
        ))}
      </dl>
      <MachineEvidence title="finding counts" value={value} />
    </section>
  );
}

export function AuditCheckList({ checks }: { checks: PublicAuditCheck[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Public checks</h3>
      <ul className="mt-3 grid gap-2">
        {checks.map((check) => (
          <li key={check.code} className="rounded-lg border border-border bg-muted/35 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{humanizeEvidenceCode(check.code)}</p>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${outcomeTone(check.outcome)}`}>{humanizeEvidenceCode(check.outcome)}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Severity: {check.severity}. {explainEvidenceCode(check.code)}</p>
          </li>
        ))}
      </ul>
      <MachineEvidence title="public checks" value={checks} />
    </section>
  );
}

export function GradeGateList({ gates }: { gates: PublicGradeHardGate[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Hard gates</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Every gate must pass before this version can receive a current letter grade.</p>
      <ul className="mt-3 grid gap-2">
        {gates.map((gate) => (
          <li key={gate.code} className="flex gap-3 rounded-lg border border-border bg-muted/35 p-3">
            {gate.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
            <div>
              <p className="text-sm font-semibold">{humanizeEvidenceCode(gate.code)} · {gate.passed ? "Passed" : "Not passed"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{explainEvidenceCode(gate.code)}{gate.passed ? "" : " This prevents a current letter grade."}</p>
            </div>
          </li>
        ))}
      </ul>
      <MachineEvidence title="hard gates" value={gates} />
    </section>
  );
}

export function GradeDimensionList({ dimensions }: { dimensions: PublicGradeDimension[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Rubric dimensions</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Dimension scores are evidence summaries, not independent safety guarantees.</p>
      <ul className="mt-3 grid gap-2">
        {dimensions.map((dimension) => (
          <li key={dimension.code} className="rounded-lg border border-border bg-muted/35 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{humanizeEvidenceCode(dimension.code)}</p>
              <p className="text-sm font-semibold">{dimension.score.toFixed(0)} / 100 · {Math.round(dimension.weight * 100)}% weight</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{explainEvidenceCode(dimension.code)}</p>
          </li>
        ))}
      </ul>
      <MachineEvidence title="rubric dimensions" value={dimensions} />
    </section>
  );
}

export function ReasonCodeList({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) return <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="mt-3 grid gap-2">
      {values.map((value) => (
        <li key={value} className="rounded-lg border border-border bg-muted/35 p-3">
          <p className="text-sm font-semibold">{humanizeEvidenceCode(value)}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{explainEvidenceCode(value)}</p>
          <p className="mono mt-2 break-all text-[11px] text-muted-foreground">Code: {value}</p>
        </li>
      ))}
    </ul>
  );
}

function MachineEvidence({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-primary">Show machine {title}</summary>
      <pre className="mono mt-3 max-h-[30rem] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/55 p-3 text-[11px] leading-5 text-foreground">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function humanizeEvidenceCode(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function explainEvidenceCode(value: string): string {
  return EVIDENCE_CODE_EXPLANATIONS[value] ?? "This bounded receipt code records one reviewed evidence outcome for the exact published version.";
}

function outcomeTone(outcome: PublicAuditCheck["outcome"]): string {
  if (outcome === "passed") return "border-success/30 bg-success/10 text-success";
  if (outcome === "blocked") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (outcome === "warning") return "border-warning/35 bg-warning/10 text-foreground";
  return "border-border bg-muted text-muted-foreground";
}
