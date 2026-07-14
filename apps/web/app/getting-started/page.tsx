import type { Metadata } from "next";
import Link from "next/link";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";
import { getReleaseStage, isHostedReleaseStage } from "@/lib/security/policy";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Getting started | SkillMap",
  description: "Choose the truthful hosted-library or local SkillMap workflow and understand the current alpha boundaries.",
  path: "/getting-started"
});

export default function GettingStartedPage() {
  const releaseStage = getReleaseStage();
  const hosted = isHostedReleaseStage(releaseStage);
  return (
    <TrustPage eyebrow="Choose a workflow" title="Start from the capability that exists today." intro={hosted
      ? "SkillMap combines a hosted trust alpha for discovery, saving, exact-source submission, bounded audit evidence, and operator-reviewed publication with a separate local-first CLI and loopback application."
      : "SkillMap has a mature local-first alpha and a complete hosted trust-alpha candidate. Catalog, account, exact-source submission, bounded audit, provisional grade, reporting, and operator workflows are validated locally; deployment and live OAuth remain separate acceptance gates."}>
      <TrustSection title="Hosted visitor workflow">
        <p>
          {hosted
            ? "Browse source-bound records without signing in. Sign in only when you want to save a skill or send a private suspicious-listing report."
            : "Walk through the locally validated hosted-catalog candidate without signing in. No live hosted service is claimed from this checkout."}
        </p>
        <WorkflowSteps items={[
          ["Search the library", "Search by skill name, summary, or description, then open a result instead of relying on a popularity claim."],
          ["Confirm the exact source", "Check the publisher, version label, immutable commit, relative SKILL.md path, license, and lifecycle before using the listing."],
          ["Read each evidence state", "Treat provenance, static audit, compatibility, grade, and recorded freshness signals separately. No single badge is a permanent safety guarantee."],
          ["Choose an account action", "Browsing and evidence stay public. A free GitHub account is required only to save a skill or send a private report."]
        ]} />
        <p className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/skills" className="font-semibold text-primary underline underline-offset-4">Browse skills</Link>
          <Link href="/trust/auditing" className="font-semibold text-primary underline underline-offset-4">Audit methodology</Link>
          <Link href="/trust/grading" className="font-semibold text-primary underline underline-offset-4">Grade methodology</Link>
        </p>
      </TrustSection>
      <TrustSection title="Hosted submitter workflow">
        <p>
          Submission is free and creates an account-owned review request, not a public listing, endorsement, or current grade.
        </p>
        <WorkflowSteps items={[
          ["Sign in with GitHub", hosted
            ? "Use the configured hosted sign-in path. SkillMap does not ask for a GitHub password and has no billing or entitlement step."
            : "The hosted source flow starts with GitHub sign-in, but live OAuth remains a deployment acceptance gate. This checkout does not substitute a fixture account."],
          ["Pin one public version", "Provide the canonical GitHub repository URL, full immutable commit, relative SKILL.md path, version label, and optional license claim."],
          ["Review and queue", "Confirm your authority and the untrusted-content boundary. The worker may inspect exact source bytes but never executes submitted instructions or scripts."],
          ["Follow the owner receipt", "Track status, timestamps, bounded remediation, and any public result in submission history. You may withdraw while queued; only the reviewed operator workflow can publish."]
        ]} />
        <p className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/submit" className="font-semibold text-primary underline underline-offset-4">Submit one exact version</Link>
          <Link href="/account/submissions" className="font-semibold text-primary underline underline-offset-4">Track your submissions</Link>
        </p>
      </TrustSection>
      <TrustSection title="Local workflow 1. Build and approve scope" command={'npm ci\nnpm run build\nnode dist/cli.js init --root ~/.agents/skills --dry-run\nnode dist/cli.js init --root ~/.agents/skills\nnode dist/cli.js scan'}>
        <p>Use the exact directories you own. SkillMap assigns opaque root IDs and scans metadata without executing skill scripts.</p>
      </TrustSection>
      <TrustSection title="Local workflow 2. Review before routing" command={'skillmap doctor\nskillmap doctor-pack --summary\nskillmap curate codex --prepare\nskillmap policy migrate --confirm\nskillmap apply-policy --strict'}>
        <p>Duplicate names, moved identities, unmatched policy, or missing canonical decisions block approval. Review receipts are part of the state, not comments around it.</p>
      </TrustSection>
      <TrustSection title="Local workflow 3. Open the working application" command="skillmap dashboard">
        <BoundaryList items={["Open only the one-time 127.0.0.1 URL printed by the foreground process.", "Run a real Route Lab request; the prompt stays in memory and is not written to route history.", "Use Activity to inspect redacted events and durable job receipts.", "Stop with Ctrl-C; background mode is intentionally unavailable."]} />
      </TrustSection>
      <TrustSection title="Local workflow 4. Earn evidence; do not manufacture it" command="skillmap eval --file .skillmap/real-evals.json --save-report\nskillmap status --json">
        <p>Release evidence needs disjoint natural, multi-skill, and negative cases, a frozen holdout, provenance, a baseline, zero target leakage, zero avoid hits, and matching dataset/effective digests.</p>
      </TrustSection>
    </TrustPage>
  );
}

function WorkflowSteps({ items }: { items: Array<[title: string, body: string]> }) {
  return (
    <ol className="grid gap-4 pt-1">
      {items.map(([title, body], index) => (
        <li key={title} className="flex gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{index + 1}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
