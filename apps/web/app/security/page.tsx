import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Security | SkillMap" };

export default function SecurityPage() {
  return (
    <TrustPage eyebrow="Trust boundary" title="Local routing with explicit authority." intro="The deterministic route path is designed to keep working offline. The browser connector is a narrow same-origin control surface—not a shell and not a bridge to arbitrary filesystem access.">
      <TrustSection title="Connector controls">
        <BoundaryList items={["IPv4 loopback only: 127.0.0.1 on a random or operator-selected port.", "The one-time bootstrap exchange returns capability and CSRF tokens only in the redirect fragment; the local app removes that fragment and keeps the pair in origin-scoped sessionStorage.", "Authenticated requests send x-skillmap-capability; mutations also send x-skillmap-csrf. Connector fetches set credentials: omit and do not rely on cookies.", "Every request must use the exact loopback Host; mutations also require the exact same Origin, and cross-site Fetch Metadata is rejected. No permissive CORS headers are emitted.", "Legacy skillmap_cap_* and skillmap_csrf_* cookies are rejected as authorization and selectively expired; unrelated cookies are left untouched.", "Bounded request size, response size, concurrency, and time; graceful foreground shutdown.", "Browser input can invoke only named use cases and allowlisted jobs."]} />
      </TrustSection>
      <TrustSection title="Workspace integrity">
        <BoundaryList items={["One fenced writer lock spans legacy mutation and immutable revision publication.", "Readers capture one pointer, validate a manifest, and consume one revision.", "Unapproved safety changes abstain; derived-only failures may use an explicitly recorded safety-equivalent last-known-good revision.", "Root traversal, symlink escape, identity collisions, manifest tamper, and canonical legacy divergence fail closed."]} />
      </TrustSection>
      <TrustSection title="Deliberate limits">
        <p>SkillMap does not execute skill scripts, apply source updates, install a global hook, publish packages, or upload private skill content automatically. Hosted auth, tenancy, billing, and team sync are not present in this build.</p>
      </TrustSection>
    </TrustPage>
  );
}
