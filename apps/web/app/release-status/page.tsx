import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";
import {
  getReleaseStage,
  isHostedReleaseStage,
  releaseStageLabel
} from "@/lib/security/policy";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Release status | SkillMap",
  description: "The implemented, locally validated, merged, scoped-CI, deployment, and live-verification boundaries for the free SkillMap trust alpha.",
  path: "/release-status"
});

export default function ReleaseStatusPage() {
  const releaseStage = getReleaseStage();
  const hosted = isHostedReleaseStage(releaseStage);
  const publicAlpha = releaseStage === "public-alpha";
  return (
    <TrustPage eyebrow="Experimental alpha" title={hosted
      ? `This service is configured as a ${releaseStageLabel(releaseStage)}.`
      : "The free curated trust alpha is validated locally and is not deployed."} intro={hosted
      ? `This process declares the ${releaseStageLabel(releaseStage)} release stage. Exact-commit submission, bounded static audit, provisional numeric grading, operator review, metadata-only publication, account export, withdrawal, reporting, and self-deletion are available. The release ledger records pushed, merged, scoped remote-CI acceptance; an operator deployment receipt remains the authority for the exact migration, OAuth, backup, and live-smoke state.`
      : "This checkout contains a deterministic local runtime and a separately gated hosted catalog/account workflow. Exact-commit submission, bounded static audit, provisional numeric grading, operator review, metadata-only publication, account export, withdrawal, reporting, and self-deletion are implemented and exercised locally. The source-integration baseline was pushed, merged, and accepted by scoped remote CI; exact receipts belong to the release ledger, and later Unreleased work requires its own ledger receipt. No remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed."}>
      <TrustSection title={hosted ? "Implemented hosted workflow" : "Implemented locally"}>
        <BoundaryList items={["Qualified identity, canonical duplicate decisions, safe sharing, eval anti-cheat gates, and hardened source reads.", "Revision-bound route, hook, MCP, local API, redacted route events, feedback, and allowlisted jobs.", "A Supabase-backed public catalog, free saved-skill accounts, exact-commit submission queue, static audit and provisional score receipts, operator publication, owner status/export/withdrawal, and account deletion validated against local Supabase.", "A repeatable exact-candidate preflight, tracked-file secret canary, candidate and post-merge scoped remote-CI receipts, and destructive-explicit local backup/reset/replay rehearsal."]} />
      </TrustSection>
      <TrustSection title={publicAlpha ? "Ongoing public-alpha gates" : hosted ? "Required before public indexing" : "Required before inviting public users"}>
        <BoundaryList items={hosted
          ? ["Keep provisional numeric grades visibly letterless; any current letter requires trusted signed behavioral evidence.", "Keep provider-global abuse controls, queue monitoring, incident ownership, encrypted restore evidence, and web rollback receipts current.", "Maintain a reviewed initial corpus and record visitor and publisher pilots that prove browse, save, submit, review, and evidence inspection without a P1 defect.", "Treat this release-stage value as an operator declaration, not proof that migrations, OAuth, backup, pilots, indexing, or live acceptance passed."]
          : ["Production-grade global abuse controls and cross-user live acceptance. Provisional numeric grades must remain visibly letterless; any future current letter requires signed behavioral evidence.", "A provisioned production Supabase project, configured GitHub OAuth, approved web host and domain, encrypted off-host backups, monitoring, incident ownership, and hosted rollback evidence.", "A reviewed initial corpus and online visitor and publisher pilots that prove browse, save, submit, review, and evidence inspection without a P1 defect.", "Approved policy and retention text plus an explicit version/tag decision and owner approval before any publish, tag, release, migration, or deploy."]} />
      </TrustSection>
      <TrustSection title="Deployment boundary">
        <p>{hosted
          ? "The exact verified-live state belongs to a deployment receipt and release ledger, not this page or its environment value. A loaded page and source merge/CI receipts are not backup-retention, cross-account, worker, rollback, pilot, or indexing proof. The trust alpha remains free to every user and contains no billing, checkout, subscription, entitlement, metering, paywall, or Stripe dependency."
          : "The current live or blocked state belongs to exact release and deployment receipts, not this static page. Pushed source, a merge, local validation, and scoped remote CI are not deployment, live OAuth, backup-retention, external-pilot, indexing, or launch proof. The intended trust alpha remains free to every user and contains no billing, checkout, subscription, entitlement, metering, paywall, or Stripe dependency."}</p>
      </TrustSection>
    </TrustPage>
  );
}
