import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Release status | SkillMap" };

export default function ReleaseStatusPage() {
  return (
    <TrustPage eyebrow="Experimental alpha" title="Locally implemented is not publicly released." intro="This checkout contains a deterministic CLI, immutable workspace state, a secured loopback connector, and a packaged local application. That does not mean the public-beta or hosted-product gates have passed.">
      <TrustSection title="Implemented locally">
        <BoundaryList items={["Qualified identity, canonical duplicate decisions, safe sharing, eval anti-cheat gates, and hardened source reads.", "Revision-bound route, hook, MCP, local API, redacted route events, feedback, and allowlisted jobs.", "A Supabase-backed public catalog, truthful first-party records, free saved-skill accounts, and responsive list/detail/account surfaces validated against local Supabase."]} />
      </TrustSection>
      <TrustSection title="Still required before public beta">
        <BoundaryList items={["A provisioned production Supabase project, configured GitHub OAuth, approved web host and domain, backups, monitoring, and rollback evidence.", "Package loading, declared-source ingestion, auditable updates, grading, compatibility evidence, and hosted routing completed through their launch gates.", "Online new-user and publisher pilots that prove search, save, route, and verified loading without a P1 defect.", "An explicit version/tag decision and owner approval before any publish, tag, release, migration, or deploy."]} />
      </TrustSection>
      <TrustSection title="Not yet live">
        <p>No remote SkillMap database, live OAuth configuration, organization roles, connector pairing, team sync, billing, production SLO, or deployment is claimed. Accounts remain free and no Stripe integration exists.</p>
      </TrustSection>
    </TrustPage>
  );
}
