import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";
import { getReleaseStage, isHostedReleaseStage } from "@/lib/security/policy";

export const metadata = buildPublicPageMetadata({
  title: "Skill auditing methodology | SkillMap",
  description: "How SkillMap separates bounded static audit evidence from claims about safety, execution, compatibility, and grades.",
  path: "/trust/auditing"
});

export default function AuditingMethodologyPage() {
  const hosted = isHostedReleaseStage(getReleaseStage());
  return (
    <TrustPage
      eyebrow="Audit methodology"
      title="Inspect untrusted skill material without executing it."
      intro={hosted
        ? "SkillMap performs a bounded static audit over one exact public source version and publishes only operator-reviewed evidence. A version without a canonical receipt remains marked not run."
        : "SkillMap has a locally validated bounded static-audit workflow for a curated free trust alpha. Checked-in seed versions remain marked not run, and no remote audit service or public submission queue is claimed live from this checkout."}
    >
      <TrustSection title="What the audit inspects">
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
          {hosted
            ? "A submission creates no public listing or safety claim. The constrained worker fetches exact public bytes without credentials or execution; an operator must review license, findings, and publication metadata before any public evidence appears."
            : "Audit automation, receipt publication, publisher submission, and operator review pass local acceptance. Until an exact hosted deployment passes its own live gates, catalog pages must continue to show only the evidence actually present, including “not run.”"}
        </p>
      </TrustSection>
    </TrustPage>
  );
}
