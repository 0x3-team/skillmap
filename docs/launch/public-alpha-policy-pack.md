# SkillMap public alpha policy pack

Status: operational draft. The product owner must approve the final support identity, governing jurisdiction, retention periods, and legal text before public submissions or indexing are enabled. This document is not legal advice and must not be represented as counsel-approved.

## Submission agreement

By submitting a skill, the submitter confirms that:

1. the repository is public and the submitted URL, full commit, and relative `SKILL.md` path identify the intended version;
2. they are authorized to request a public metadata listing and to make the stated license claim;
3. the submission contains no secrets, credentials, private keys, personal data that should not be public, malware payloads, unlawful content, or content that infringes another person's rights;
4. SkillMap may fetch, hash, inspect, cache bounded private evaluation evidence, and display metadata and redacted receipts for review, security, abuse prevention, and publication decisions;
5. SkillMap will not execute the submitted skill or treat its instructions as commands;
6. a submitter license claim is not verified license evidence until the review process confirms the applicable policy;
7. an audit or grade is a bounded evidence-based opinion about one exact version, not a warranty, certification of safety, endorsement, or guarantee of fitness;
8. submission does not guarantee review, publication, placement, grade, availability, or continued listing;
9. SkillMap may request changes, reject, quarantine, deprecate, revoke, or restore a listing under the documented process; and
10. a changed commit is a new immutable version and must be submitted separately.

The metadata-only launch does not transfer ownership and does not grant SkillMap an implied right to redistribute package bytes. Public pages may link to the exact public source and display bounded metadata, digests, findings, and receipts. Mirroring or installation requires a separate explicit policy and confirmed redistribution authority.

## Acceptable use

Do not use SkillMap to:

- submit private repositories, mutable refs, credentialed URLs, or source that the submitter is not authorized to list;
- upload or expose secrets, tokens, private keys, personal data, patient data, or confidential business information;
- distribute malware, credential theft, destructive automation, evasion tooling, unlawful surveillance, or instructions whose primary purpose is harm;
- impersonate a publisher, fabricate license or provenance claims, manipulate grade evidence, or evade a prior rejection or revocation;
- automate submissions, reports, or account creation in a way that bypasses published rate or queue limits;
- probe another user's account, submission, private evidence, or operator systems;
- use reports, appeals, or takedown requests to harass authors or suppress legitimate competition; or
- imply that a SkillMap listing, audit, or grade is an official safety certification.

SkillMap may rate-limit, pause, reject, quarantine, revoke, or block accounts and submissions to protect users, evidence integrity, service availability, or legal rights. Security research must stay within the published security contact and authorization boundary.

## Data and privacy boundary

The launch application processes these categories:

- Supabase Auth account identifier, GitHub identity/provider metadata, email when supplied by the provider, and session records;
- SkillMap profile creation time and saved-skill identifiers;
- submitted public repository URL, immutable commit, source path, version label, optional license claim, workflow state, and timestamps;
- bounded audit, compatibility, grade, review, worker, report, lifecycle, and publication receipts;
- privacy-safe aggregate operational metrics and redacted error codes when enabled.

The launch application must not collect raw local prompts, private skill bodies, repository credentials, payment data, or full IP addresses as product analytics. Submitted public source bytes may be held as bounded private evaluation evidence only for the documented retention period; public third-party distribution remains metadata-only.

Before launch, the owner must publish exact retention windows for accounts, submissions, private evaluation evidence, security logs, reports, backups, legal holds, and terminal revocation tombstones. Deleting an account removes account-owned profile, saves, submissions, and private ledgers through the reviewed cascade unless a documented legal or security hold applies. A narrow redacted tombstone for terminal consent-withdrawal survives deletion: exact public repository URL, commit, path, the claimed publisher handle, opaque evidence reference, and evidence digests. It contains no auth user ID, email, or OAuth provider identity; it may be retained only under the approved retention period and legal basis to prevent exact revoked source from being reauthorized through another account or publisher handle. Public listings derived from a submission require a separate lifecycle decision: remove or anonymize submitter linkage, then retain or revoke the public evidence history according to the approved policy.

Users must be able to export the SkillMap-owned account projection and request account deletion from the account surface. OAuth provider data outside SkillMap remains governed by the provider and may require separate action with that provider.

## Reports, takedown, and appeals

A report must identify one public skill or version and one category:

- malicious or unsafe behavior;
- secret or personal-data exposure;
- copyright, trademark, license, or ownership dispute;
- impersonation or false provenance;
- broken or misleading source identity;
- inaccurate audit or grade evidence; or
- other policy violation.

The first public alpha requires a free authenticated account to submit a report. Collect only a bounded explanation in the report record; do not copy account email or OAuth metadata into it, and do not ask reporters to paste secrets, private source, or sensitive personal data. Anonymous intake remains deferred until provider-level anti-spam and a privacy-safe case-receipt design are approved.

To keep the free queue operable, one account may hold at most five queued reports and create at most twenty reports in a rolling 24-hour window. An exact version/category cooldown and duplicate suppression also apply. These limits are abuse controls, not a paid entitlement boundary.

Operator workflow:

1. acknowledge the report with an opaque case identifier;
2. preserve the exact version, receipt, and report evidence privately;
3. quarantine immediately when credible harm, secret exposure, or identity compromise could continue;
4. notify the publisher when safe and legally appropriate;
5. record one bounded disposition: no action, corrected, deprecated, quarantined, revoked, restored, or referred for legal review;
6. publish only the public lifecycle state and safe reason codes; and
7. retain the private record for the approved period.

An author or affected person may appeal by identifying the case, exact version, disputed claim, and supporting public evidence. A reviewer who did not make the original disposition should decide the appeal when staffing permits. Appeals do not automatically restore a listing. Every restore requires a new receipt and must not erase the prior history.

## No billing

The public alpha has no price, checkout, subscription, trial, entitlement, publisher payment, paid placement, or Stripe integration. Capacity, submission, and review limits exist to keep a free service operable and must not be described as a paywall. Any future billing proposal requires a separate product, policy, data, and implementation decision.

## Required owner decisions before publication

- public operator/legal identity and contact route;
- governing law and venue, if terms require them;
- minimum user age and geographic availability;
- exact retention, deletion, backup, and legal-hold periods;
- copyright/takedown agent and process where applicable;
- security contact and response target;
- accessibility/support response target;
- provider subprocessor list and privacy notice links; and
- version/date of the approved policy displayed at submission time.
