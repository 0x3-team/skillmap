import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Release status | SkillMap",
  description: "The locally validated, implemented, planned, and still-blocked boundaries for the free SkillMap trust alpha.",
  path: "/release-status"
});

export default function ReleaseStatusPage() {
  return (
    <TrustPage eyebrow="Experimental alpha" title="The free curated trust alpha is validated locally and is not deployed." intro="This checkout contains a deterministic local runtime and a separately gated hosted catalog/account spine. Exact-commit submission, bounded static audit, provisional numeric grading, operator review, metadata-only publication, account export, withdrawal, and self-deletion are implemented and exercised locally. No push, remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed.">
      <TrustSection title="Implemented locally">
        <BoundaryList items={["Qualified identity, canonical duplicate decisions, safe sharing, eval anti-cheat gates, and hardened source reads.", "Revision-bound route, hook, MCP, local API, redacted route events, feedback, and allowlisted jobs.", "A Supabase-backed public catalog, free saved-skill accounts, exact-commit submission queue, static audit and provisional score receipts, operator publication, owner status/export/withdrawal, and account deletion validated against local Supabase.", "A repeatable exact-candidate preflight, tracked-file secret canary, CI-bound package evidence, and destructive-explicit local backup/reset/replay rehearsal."]} />
      </TrustSection>
      <TrustSection title="Required before inviting public users">
        <BoundaryList items={["Production-grade global abuse controls and cross-user live acceptance. Provisional numeric grades must remain visibly letterless; any future current letter requires signed behavioral evidence.", "A provisioned production Supabase project, configured GitHub OAuth, approved web host and domain, encrypted off-host backups, monitoring, incident ownership, and hosted rollback evidence.", "A reviewed initial corpus and online visitor and publisher pilots that prove browse, save, submit, review, and evidence inspection without a P1 defect.", "Approved policy and retention text plus an explicit version/tag decision and owner approval before any publish, tag, release, migration, or deploy."]} />
      </TrustSection>
      <TrustSection title="Deployment boundary">
        <p>The current live or blocked state belongs to an exact candidate receipt and the implementation ledger, not this static page. Existing local validation is not push, deployment, live OAuth, backup-retention, external-pilot, indexing, or launch proof. The intended trust alpha remains free to every user and contains no billing, checkout, subscription, entitlement, metering, paywall, or Stripe dependency.</p>
      </TrustSection>
    </TrustPage>
  );
}
