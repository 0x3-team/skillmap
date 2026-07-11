import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Privacy | SkillMap" };

export default function PrivacyPage() {
  return (
    <TrustPage eyebrow="Data handling" title="Private input stays local by default." intro="The local product separates raw operator material from the redacted evidence needed to understand routing and recovery.">
      <TrustSection title="Not retained by default">
        <BoundaryList items={["Raw Route Lab and hook prompts.", "Prompt fingerprints or guessed hashes.", "Raw skill bodies in route, event, dashboard, and safe-export payloads.", "Absolute paths, secrets, hook tokens, or free-form private comments in redacted events."]} />
      </TrustSection>
      <TrustSection title="Stored locally">
        <BoundaryList items={["Approved root paths in local-sensitive workspace state.", "Qualified skill metadata and complete-tree content revisions.", "Policy, identity, source-review, migration, rollback, and job receipts.", "Redacted route events with selected skill IDs, machine reason codes, latency bucket, revision, and outcome."]} />
      </TrustSection>
      <TrustSection title="Hosted account boundary">
        <BoundaryList items={["The SkillMap application schema stores the authenticated account identifier, profile timestamps, and the IDs of skills that account saves.", "Supabase Auth retains the account email, GitHub identity/provider metadata, and session records needed to authenticate the account. SkillMap does not request or store a GitHub password.", "Hosted catalog browsing does not upload local skill bodies or Route Lab prompts.", "No billing profile, payment method, entitlement, or Stripe record exists in this release."]} />
      </TrustSection>
      <TrustSection title="Sharing and telemetry">
        <p>Default export is a closed, verified, shareable-redacted allowlist. Local-sensitive backup requires a separate explicit flag and confined destination. Product telemetry and local-workspace cloud sync are off; no training use is implied.</p>
      </TrustSection>
    </TrustPage>
  );
}
