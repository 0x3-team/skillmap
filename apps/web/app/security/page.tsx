import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Security | SkillMap",
  description: "Review SkillMap's local connector controls, hosted evidence boundaries, immutable source identity, and deliberate security limits.",
  path: "/security"
});

export default function SecurityPage() {
  return (
    <TrustPage eyebrow="Trust boundary" title="Explicit authority from local routing to public evidence." intro="The deterministic route path is designed to keep working offline. The hosted trust alpha keeps submitted source inert, pins every public claim to an immutable version, and reserves review, moderation, and publication mutations for bounded server-only operations.">
      <TrustSection title="Connector controls">
        <BoundaryList items={["IPv4 loopback only: 127.0.0.1 on a random or operator-selected port.", "The one-time bootstrap exchange returns capability and CSRF tokens only in the redirect fragment; the local app removes that fragment and keeps the pair in origin-scoped sessionStorage.", "Authenticated requests send x-skillmap-capability; mutations also send x-skillmap-csrf. Connector fetches set credentials: omit and do not rely on cookies.", "Every request must use the exact loopback Host; mutations also require the exact same Origin, and cross-site Fetch Metadata is rejected. No permissive CORS headers are emitted.", "Legacy skillmap_cap_* and skillmap_csrf_* cookies are rejected as authorization and selectively expired; unrelated cookies are left untouched.", "Bounded request size, response size, concurrency, and time; graceful foreground shutdown.", "Browser input can invoke only named use cases and allowlisted jobs."]} />
      </TrustSection>
      <TrustSection title="Workspace integrity">
        <BoundaryList items={["One fenced writer lock spans legacy mutation and immutable revision publication.", "Readers capture one pointer, validate a manifest, and consume one revision.", "Unapproved safety changes abstain; derived-only failures may use an explicitly recorded safety-equivalent last-known-good revision.", "Root traversal, symlink escape, identity collisions, manifest tamper, and canonical legacy divergence fail closed."]} />
      </TrustSection>
      <TrustSection title="Deliberate limits">
        <p>SkillMap does not execute submitted skill scripts, mirror or install third-party package bytes, apply source updates, expose private local skill content, or turn a static audit into a safety certification. The hosted catalog may publish a letterless provisional numeric grade for one exact source version only after its bounded evidence and operator review pass. Current letter grades, public tenancy, billing, team sync, package execution, and hosted routing remain outside this release. The hosted plane may be operated only as the separately evidenced private alpha described by the deployment runbook until every public gate closes.</p>
      </TrustSection>
    </TrustPage>
  );
}
