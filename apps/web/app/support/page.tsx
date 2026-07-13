import type { Metadata } from "next";
import Link from "next/link";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";
import { buildPublicPageMetadata } from "@/lib/metadata";
import {
  getApprovedSupportUrl,
  getReleaseStage,
  isHostedReleaseStage
} from "@/lib/security/policy";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Support | SkillMap",
  description: "How to report bounded, redacted SkillMap alpha issues without exposing prompts, skill bodies, paths, or credentials.",
  path: "/support"
});

export default function SupportPage() {
  const releaseStage = getReleaseStage();
  const hosted = isHostedReleaseStage(releaseStage);
  const supportUrl = getApprovedSupportUrl();
  return (
    <TrustPage
      eyebrow="Experimental alpha support"
      title="Start with bounded, redacted local evidence."
      intro={hosted
        ? "This experimental hosted alpha supports free accounts, exact-source submissions, bounded evidence, and private suspicious-listing reports, but offers no response-time SLA. A useful issue identifies the exact package, skill version, or bounded evidence receipt without sending private prompts, skill bodies, paths, credentials, or workspace artifacts."
        : "This checkout has a locally validated free-account, submission, evidence, and suspicious-listing report spine, but no remote deployment, production incident desk, or response-time SLA is claimed. A useful issue identifies the exact package, skill version, or bounded evidence receipt without sending private prompts, skill bodies, paths, credentials, or workspace artifacts."}
    >
      <TrustSection
        title="Capture the smallest safe diagnostic"
        command={"skillmap --version\nnode --version\nskillmap state status --json\nskillmap status --json\nskillmap doctor --fix-plan"}
      >
        <p>Run these commands in the affected project. Share only the bounded machine codes, revision identifiers, and redacted digest receipts needed to reproduce the problem.</p>
      </TrustSection>
      <TrustSection title="Include and exclude">
        <BoundaryList
          items={[
            "Include the operating system, Node version, SkillMap version, install method, failing command, safe error code, workspace state, and smallest repeatable workflow.",
            "For a reviewed tarball, include its exact filename and reviewer-provided SHA-256 without exposing a private home-directory path.",
            "Do not include raw prompts, skill bodies, absolute paths, secrets, tokens, hook configuration, local-sensitive exports, or private .skillmap files.",
            "Redact any private value already captured before attaching logs or screenshots."
          ]}
        />
      </TrustSection>
      <TrustSection title="Connector and recovery boundary">
        <BoundaryList
          items={[
            "For connector trouble, stop the foreground dashboard, restart skillmap dashboard, and open only the newly printed one-time URL.",
            "Use state repair-projections, recover, or rollback only when the corresponding bounded diagnostic says that action is valid.",
            "Never delete locks, rewrite pointers, edit immutable revisions, or remove .skillmap as a generic troubleshooting step."
          ]}
        />
      </TrustSection>
      <TrustSection title="Catalog, submission, and methodology questions">
        <p>
          Free authenticated exact-source submissions are bounded to 3 active rows and 10 new rows per rolling 24 hours. Suspicious-listing reports require a free authenticated account and the exact current public version, with at most 5 queued and 20 created per rolling 24 hours per account, one queued report per version/category, and a 24-hour cooldown on that tuple. Reports are immutable and move only from queued to operator-resolved; there is no response-time SLA. A report never changes catalog state by itself: only the operator lifecycle authority may deprecate or revoke a skill, quarantine or revoke a version, or restore receipt-backed eligible evidence. Check <Link href="/submit" className="font-semibold text-primary underline underline-offset-4">submission</Link>, <Link href="/account/reports" className="font-semibold text-primary underline underline-offset-4">report history</Link>, <Link href="/trust/auditing" className="font-semibold text-primary underline underline-offset-4">audit methodology</Link>, <Link href="/trust/grading" className="font-semibold text-primary underline underline-offset-4">grade methodology</Link>, and the <Link href="/release-status" className="font-semibold text-primary underline underline-offset-4">release boundary</Link> before treating a missing capability as a live-service failure.
        </p>
      </TrustSection>
      <TrustSection title="Report an alpha issue">
        {supportUrl ? (
          <p>
            Submit the redacted reproduction through the approved public intake page. It covers alpha support, formal appeals, and confidential security-report instructions; do not place a secret or private artifact in a public field. This is an alpha feedback channel, not a response-time SLA. {" "}
            <a href={supportUrl} className="font-semibold text-primary underline underline-offset-4" target="_blank" rel="noreferrer">
              Open the approved SkillMap support intake
            </a>
            .
          </p>
        ) : (
          <p>
            No approved public support, appeal, and security-intake page is configured. A private pilot must give participants a separately recorded contact, and the operator must not enable public alpha or indexing until an approved reachable intake URL is configured.
          </p>
        )}
      </TrustSection>
    </TrustPage>
  );
}
