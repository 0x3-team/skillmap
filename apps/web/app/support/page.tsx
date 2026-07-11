import type { Metadata } from "next";
import { BoundaryList, TrustPage, TrustSection } from "@/components/skillmap/trust-page";

export const metadata: Metadata = { title: "Support | SkillMap" };

export default function SupportPage() {
  return (
    <TrustPage
      eyebrow="Experimental alpha support"
      title="Start with bounded, redacted local evidence."
      intro="SkillMap has a locally validated free-account flow, but no deployed production incident desk or response-time SLA. A useful report identifies the exact package and local state without sending private prompts, skill bodies, paths, credentials, or workspace artifacts."
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
      <TrustSection title="Report an alpha issue">
        <p>
          If the project issue tracker is available to you, submit the redacted reproduction there. This is an alpha feedback channel, not a production support commitment. {" "}
          <a
            href="https://github.com/0x3-team/skillmap/issues"
            className="font-semibold text-primary underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            Open the SkillMap issue tracker
          </a>
          .
        </p>
      </TrustSection>
    </TrustPage>
  );
}
