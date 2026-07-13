import Link from "next/link";
import { ArrowUpRight, Bookmark, ShieldAlert } from "lucide-react";
import type { HostedSkillSummaryV1 } from "@/lib/contracts/generated/types";

export function SkillCard({ skill }: { skill: HostedSkillSummaryV1 }) {
  return (
    <article className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{skill.publisher.handle}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{skill.displayName}</h2>
        </div>
        <GradePill state={skill.currentVersion.grade.state} band={skill.currentVersion.grade.band} />
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{skill.summary}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {skill.capabilities.slice(0, 4).map((capability) => (
          <span key={capability} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{capability}</span>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" />
          Compatibility {humanize(skill.currentVersion.compatibilityState)}
        </span>
        <Link href={`/skills/${skill.publisher.handle}/${skill.slug}`} prefetch={false} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          Inspect <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

export function GradePill({ state, band }: { state: string; band: string | null }) {
  if (state === "current" && band) {
    return <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">Grade {band}</span>;
  }
  return <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{humanize(state)}</span>;
}

export function SaveHint() {
  return <Bookmark className="h-4 w-4" />;
}

export function humanize(value: string) {
  return value.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}
