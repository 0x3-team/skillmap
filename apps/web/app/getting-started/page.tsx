import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Getting started | SkillMap" };

export default function GettingStartedPage() {
  return (
    <TrustPage eyebrow="Local workflow" title="From checkout to a trusted route." intro="SkillMap is an experimental local alpha. The complete path is explicit: approve roots, scan, review identity and policy, classify sources, validate a credible suite, then connect an agent host.">
      <TrustSection title="1. Build and approve scope" command={'npm ci\nnpm run build\nnode dist/cli.js init --root ~/.agents/skills --dry-run\nnode dist/cli.js init --root ~/.agents/skills\nnode dist/cli.js scan'}>
        <p>Use the exact directories you own. SkillMap assigns opaque root IDs and scans metadata without executing skill scripts.</p>
      </TrustSection>
      <TrustSection title="2. Review before routing" command={'skillmap doctor\nskillmap doctor-pack --summary\nskillmap curate codex --prepare\nskillmap policy migrate --confirm\nskillmap apply-policy --strict'}>
        <p>Duplicate names, moved identities, unmatched policy, or missing canonical decisions block approval. Review receipts are part of the state, not comments around it.</p>
      </TrustSection>
      <TrustSection title="3. Open the working local application" command="skillmap dashboard">
        <BoundaryList items={["Open only the one-time 127.0.0.1 URL printed by the foreground process.", "Run a real Route Lab request; the prompt stays in memory and is not written to route history.", "Use Activity to inspect redacted events and durable job receipts.", "Stop with Ctrl-C; background mode is intentionally unavailable."]} />
      </TrustSection>
      <TrustSection title="4. Earn evidence; do not manufacture it" command="skillmap eval --file .skillmap/real-evals.json --save-report\nskillmap status --json">
        <p>Release evidence needs disjoint natural, multi-skill, and negative cases, a frozen holdout, provenance, a baseline, zero target leakage, zero avoid hits, and matching dataset/effective digests.</p>
      </TrustSection>
    </TrustPage>
  );
}
