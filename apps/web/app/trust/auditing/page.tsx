import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";

export const metadata = buildPublicPageMetadata({
  title: "Skill auditing methodology | SkillMap",
  description: "How SkillMap separates bounded static audit evidence from claims about safety, execution, compatibility, and grades.",
  path: "/trust/auditing"
});

export default function AuditingMethodologyPage() {
  return (
    <TrustPage
      eyebrow="Audit methodology"
      title="Inspect untrusted skill material without executing it."
      intro="SkillMap is building a bounded static-audit workflow for a curated free trust alpha. The current hosted catalog can display an audit state, but its checked-in seed versions are still marked not run. No remote audit service or public submission queue is claimed to be live."
    >
      <TrustSection title="What the audit will inspect">
        <BoundaryList
          items={[
            "An exact public GitHub repository, immutable commit, and relative SKILL.md path supplied by the submitter.",
            "Source and entrypoint digests, frontmatter shape, referenced-file inventory, file counts, sizes, and path safety.",
            "Declared and detected license evidence, redistribution limits, scripts, binaries, network needs, tools, and permissions.",
            "Static indicators for secrets, prompt injection, unsafe control-plane instructions, unsupported active content, and ambiguous provenance.",
            "Version-bound findings, reason codes, policy version, and a reproducible public receipt summary."
          ]}
        />
      </TrustSection>

      <TrustSection title="The no-execution boundary">
        <p>
          Submitted text, code, links, and instructions are inert evidence. The audit does not follow instructions found in a skill, run bundled scripts, install dependencies, invoke lifecycle hooks, or grant the source network or filesystem authority.
        </p>
        <p>
          A static audit can identify reviewable risk; it cannot prove that a skill is safe in every host, environment, or future dependency state.
        </p>
      </TrustSection>

      <TrustSection title="Public audit states">
        <BoundaryList
          items={[
            "Not run: no canonical audit receipt exists for this immutable version.",
            "Passed: the named audit policy completed without a blocking finding; this is not a universal safety guarantee.",
            "Warnings: the audit completed and published bounded findings that require user judgment.",
            "Stale: a bound source, policy, dependency, or advisory input changed after the receipt was issued.",
            "Blocked: a hard gate failed or required evidence was unavailable, so the version cannot receive a positive audit claim."
          ]}
        />
      </TrustSection>

      <TrustSection title="Current alpha boundary">
        <p>
          Audit automation, receipt publication, publisher submissions, and operator review are implementation work in progress. Until those gates pass locally and against an exact live deployment, catalog pages must continue to show truthful states such as “not run.”
        </p>
      </TrustSection>
    </TrustPage>
  );
}
