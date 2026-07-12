import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Release status | SkillMap" };

export default function ReleaseStatusPage() {
  return (
    <TrustPage eyebrow="Experimental alpha" title="Private hosted alpha is not public release." intro="This checkout contains a deterministic local runtime and a separately gated hosted catalog/account spine. A deployment is a private alpha only when its exact commit, provider configuration, migration, backup, OAuth, and live acceptance receipts are recorded; no build or page copy alone proves that state.">
      <TrustSection title="Implemented locally">
        <BoundaryList items={["Qualified identity, canonical duplicate decisions, safe sharing, eval anti-cheat gates, and hardened source reads.", "Revision-bound route, hook, MCP, local API, redacted route events, feedback, and allowlisted jobs.", "A Supabase-backed public catalog, truthful first-party records, free saved-skill accounts, and responsive list/detail/account surfaces validated against local Supabase."]} />
      </TrustSection>
      <TrustSection title="Still required before public beta">
        <BoundaryList items={["A provisioned production Supabase project, configured GitHub OAuth, approved web host and domain, backups, monitoring, and rollback evidence.", "Package loading, declared-source ingestion, auditable updates, grading, compatibility evidence, and hosted routing completed through their launch gates.", "Online new-user and publisher pilots that prove search, save, route, and verified loading without a P1 defect.", "An explicit version/tag decision and owner approval before any publish, tag, release, migration, or deploy."]} />
      </TrustSection>
      <TrustSection title="Deployment boundary">
        <p>The hosted spine may operate online only as an unlisted private alpha with first-party records and free accounts. The current live or blocked state belongs to the implementation ledger, not this static page. No public beta, connector pairing, team sync, billing, production SLO, or Stripe integration is claimed.</p>
      </TrustSection>
    </TrustPage>
  );
}
