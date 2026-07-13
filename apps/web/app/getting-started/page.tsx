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
      <TrustSection title="Hosted library: inspect the current evidence boundary">
        <p>
          {hosted
            ? "Browse source-bound records without signing in, inspect why provenance, audit, compatibility, license, and grade states remain separate, or use a free GitHub account to save and submit exact public versions."
            : "Browse the local hosted-catalog candidate without signing in, then inspect why provenance, audit, compatibility, license, and grade states remain separate. No live hosted service is claimed from this checkout."}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/skills" className="font-semibold text-primary underline underline-offset-4">Browse skills</Link>
          <Link href="/submit" className="font-semibold text-primary underline underline-offset-4">Submit a skill</Link>
          <Link href="/trust/auditing" className="font-semibold text-primary underline underline-offset-4">Audit methodology</Link>
          <Link href="/trust/grading" className="font-semibold text-primary underline underline-offset-4">Grade methodology</Link>
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
