import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";
import { getReleaseStage, isHostedReleaseStage } from "@/lib/security/policy";

export const metadata = buildPublicPageMetadata({
  title: "Skill grading methodology | SkillMap",
  description: "How SkillMap keeps grades version-bound, reproducible, host-specific, explainable, and separate from popularity or payment.",
  path: "/trust/grading"
});

export default function GradingMethodologyPage() {
  const hosted = isHostedReleaseStage(getReleaseStage());
  return (
    <TrustPage
      eyebrow="Grade methodology"
      title="A grade is a receipt, not a popularity badge."
      intro={hosted
        ? "SkillMap produces deterministic, version-bound provisional scores from reviewed evidence. No letter grade is presented until the required package, audit, compatibility, behavioral evaluation, and signed receipt gates pass."
        : "SkillMap has a locally validated deterministic, version-bound provisional grading workflow. Checked-in seed versions remain ungraded, and no letter grade is presented until the required package, audit, compatibility, behavioral evaluation, and signed receipt gates pass."}
    >
      <TrustSection title="Independent evidence, kept separate">
        <BoundaryList
          items={[
            "Publisher identity answers who controls the listing; it does not determine quality.",
            "Provenance binds source coordinates and bytes; it does not replace an audit.",
            "Audit records bounded static findings; it does not prove host compatibility or task effectiveness.",
            "Compatibility names the tested host profile and versions; it is not a generic safety claim.",
            "The grade summarizes rubric evidence for one immutable version and never includes popularity or payment."
          ]}
        />
      </TrustSection>

      <TrustSection title="Hard gates before a current grade">
        <BoundaryList
          items={[
            "Canonical immutable source and normalized package identities.",
            "Acceptable license and redistribution evidence plus declared permissions.",
            "Current provenance, audit, and required Codex compatibility receipts.",
            "No unresolved critical finding or applicable blocking advisory.",
            "A frozen evaluation suite with held-out cases, clean contexts, required baselines, repeated trials, and disclosed confidence.",
            "A receipt bound to the rubric, host profile, evaluator inputs, evidence digests, issue time, and invalidation policy."
          ]}
        />
      </TrustSection>

      <TrustSection title="How to read a grade state">
        <BoundaryList
          items={[
            "Ungraded: no canonical grade receipt exists. It is not a failing score.",
            "Provisional: valid evidence exists, but it is below the stable sample or confidence threshold; no letter band is shown.",
            "Current: every hard gate and currency rule passes, so the receipt may show an A–F band and confidence.",
            "Stale: a bound input changed; the historical band remains visible only with its invalidation time and reason.",
            "Blocked or revoked: a hard gate or consequential trust decision prevents a positive current grade."
          ]}
        />
      </TrustSection>

      <TrustSection title="Free and non-promotional">
        <p>
          Public accounts, submissions, audit summaries, and grade evidence remain free. SkillMap has no billing, checkout, subscription, entitlement, paid-placement, or publisher-payment path in this launch. A publisher cannot buy a better grade, and popularity cannot change one.
        </p>
      </TrustSection>

      <TrustSection title="Current alpha boundary">
        <p>
          {hosted
            ? "The static workflow can issue a provisional integer score with no letter. A current letter remains forbidden unless a trusted signer binds the exact normalized package, audit, compatibility profile, frozen suite, baseline, evaluator, rubric, and repeated behavioral evidence."
            : "The versioned rubric, receipt engine, operator review, and public evidence pages pass local acceptance but are not claimed as a live deployed service. Catalog entries remain visibly ungraded, provisional, or blocked according to the evidence actually present."}
        </p>
      </TrustSection>
    </TrustPage>
  );
}
