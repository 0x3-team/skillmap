import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Release status | SkillMap" };

export default function ReleaseStatusPage() {
  return (
    <TrustPage eyebrow="Experimental alpha" title="Locally implemented is not publicly released." intro="This checkout contains a deterministic CLI, immutable workspace state, a secured loopback connector, and a packaged local application. That does not mean the public-beta or hosted-product gates have passed.">
      <TrustSection title="Implemented locally">
        <BoundaryList items={["Qualified identity, canonical duplicate decisions, safe sharing, eval anti-cheat gates, and hardened source reads.", "Revision-bound route, hook, MCP, local API, redacted route events, feedback, and allowlisted jobs.", "Responsive local product shell and a separate, explicitly recorded public demo/snapshot surface."]} />
      </TrustSection>
      <TrustSection title="Still required before public beta">
        <BoundaryList items={["A credible natural held-out eval corpus that passes fixed quality and safety gates.", "Cross-platform clean installs, browser/privacy/migration/failure CI, accessibility and performance acceptance.", "At least five external onboarding pilots, with four reaching a trusted route within 15 minutes and no P1 defect.", "An explicit version/tag decision and explicit owner approval before any publish, tag, release, or deploy."]} />
      </TrustSection>
      <TrustSection title="Not in this build">
        <p>No hosted identity, tenant database, organization roles, connector pairing, team sync, billing, marketplace, production SLO, or deployment is claimed.</p>
      </TrustSection>
    </TrustPage>
  );
}
