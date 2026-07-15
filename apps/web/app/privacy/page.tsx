import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Privacy | SkillMap",
  description: "Understand which SkillMap data stays local and which account, save, submission, and report data the hosted service stores.",
  path: "/privacy"
});

export default function PrivacyPage() {
  return (
    <TrustPage eyebrow="Data handling" title="Know what stays local and what the hosted service stores." intro="Raw local operator material stays on-device by default. Hosted accounts, saves, submissions, and private reports cross a separate, explicitly disclosed service boundary.">
      <TrustSection title="Not retained by default">
        <BoundaryList items={["Raw Route Lab and hook prompts.", "Prompt fingerprints or guessed hashes.", "Raw skill bodies in route, event, dashboard, and safe-export payloads.", "Absolute paths, secrets, hook tokens, or free-form private comments in redacted events."]} />
      </TrustSection>
      <TrustSection title="Stored locally">
        <BoundaryList items={["Approved root paths in local-sensitive workspace state.", "Qualified skill metadata and complete-tree content revisions.", "Policy, identity, source-review, migration, rollback, and job receipts.", "Redacted route events with selected skill IDs, machine reason codes, latency bucket, revision, and outcome."]} />
      </TrustSection>
      <TrustSection title="Hosted account boundary">
        <BoundaryList items={["The SkillMap application schema stores the authenticated account identifier, profile timestamps, and the IDs of skills that account saves.", "A submission stores public GitHub source coordinates, version and license claims, immutable acknowledgement fields, workflow state, and bounded worker/review evidence. The browser does not upload or execute repository bodies. Accounts are limited to 3 active submissions and 10 new submission rows per rolling 24 hours.", "A suspicious-listing report stores the exact public skill/version IDs, one category, the account's bounded message, request ID, state, and public operator resolution. Reports require authentication, are owner-readable, cannot be edited or withdrawn, and are limited to 5 queued and 20 new reports per rolling 24 hours, plus one queued report and a 24-hour cooldown for the same account/version/category.", "Supabase Auth retains the account email, GitHub identity/provider metadata, and session records needed to authenticate the account. SkillMap does not request or store a GitHub password.", "The account export is owner-filtered and bounded. Account deletion removes the auth account and cascades account-owned profile, saves, submissions, submission evidence, and suspicious-listing reports. One narrow terminal consent-withdrawal tombstone survives: exact public repository URL, commit, path, claimed publisher handle, opaque evidence reference, and evidence digests. It is not linked to the auth user, email, or OAuth provider identity and is retained only under the approved retention and legal basis to prevent revoked exact source from being resubmitted through another account or handle. Published catalog metadata may remain with its submission-backed evidence detached and reset. The current browser session is cleared, while already-issued JWTs on other devices may remain cryptographically valid until expiry without the deleted account rows. Source repositories and provider backup retention are outside that deletion RPC.", "Public audit and grade pages expose only bounded current-version evidence views. They exclude private evidence, submitter identity, worker internals, operator notes, and full receipt envelopes; the canonical evidence digest is not a public projectionDigest.", "Hosted catalog browsing does not upload local skill bodies or Route Lab prompts.", "No billing profile, payment method, entitlement, or Stripe record exists in this release."]} />
      </TrustSection>
      <TrustSection title="Sharing and telemetry">
        <p>Default export is a closed, verified, shareable-redacted allowlist. Local-sensitive backup requires a separate explicit flag and confined destination. Product telemetry and local-workspace cloud sync are off; no training use is implied.</p>
      </TrustSection>
    </TrustPage>
  );
}
