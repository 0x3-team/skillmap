# Hosted SkillMap alpha pilot runbook

Status: execution template. This runbook is for the hosted free trust alpha, not the local tarball/dashboard pilot in `docs/external-pilot-runbook.md`.

## Gate before recruiting

Do not invite a participant until all of these are recorded for one exact deployment:

- private-alpha origin, commit, deployment ID, migrations, and GitHub OAuth callback;
- anonymous browse and authenticated two-account smoke receipts;
- worker, report, quarantine/revocation, encrypted restore, and web rollback receipts;
- named pilot operator, incident owner, support contact, and approved retention/policy version; and
- `SKILLMAP_RELEASE_STAGE=private-alpha` with indexing still disabled.

No pilot author should receive a service credential, database access, or an instruction to upload private source, prompts, tokens, patient data, or workspace artifacts.

## Cohort and pass rule

Recruit exactly five initial participants:

- three people who regularly discover or use agent skills; and
- two authors who control a public skill repository and can authorize a metadata listing.

Assign the five seats before recruitment; do not let participants choose whichever workflow is easiest:

| Seat | Required primary workflow |
| --- | --- |
| User A | Browse for a real job, inspect source plus audit/grade evidence, and explain the trust boundary. |
| User B | Save a skill, leave its detail page, then return through the account saved projection. |
| User C | Browse a different real job and distinguish a provisional letterless grade from a current evidence-backed result. |
| Author A | Submit one authorized immutable public skill, return after operator processing, inspect the published listing and receipt-bound audit/grade pages, and explain the resulting status. |
| Author B | Submit a second authorized immutable public skill and interpret queued, review, and final owner-visible status without accessing another author's row. |

The cohort gate passes only when at least four of five finish uncoached **and** at least one uncoached receipt exists for every mandatory workflow: browse/evidence, save/return, submit/status, and author follow-through through receipt-backed publication inspection. A participant may ask what the study is testing, but explaining which button, label, source field, or evidence state to use counts as coaching. If the only assigned seat for a mandatory workflow fails, the cohort cannot pass even when four other people finish.

## Fifteen-minute session

1. Record an opaque session ID, participant role, assigned task, and UTC start time. Store contact consent separately.
2. Read: “SkillMap is a free skill directory and trust workflow. Please use it as you normally would. I am testing the product, not you, and I will stay silent unless safety requires intervention.”
3. Give exactly the preassigned task from the matrix. For Author A, pause elapsed task time after the accepted submission while the operator follows the normal review path; resume in a second uncoached segment only after a receipt-backed publication is available. Record both segments under the same opaque session ID. Do not synthesize, hand-edit, or auto-pass the participant row.
4. Do not guide the participant. Record route names, bounded product error codes, elapsed time, completion state, and any coaching event.
5. Ask the eight questions in `free-public-alpha-go-to-market.md`. Record volunteered feedback without raw prompts, skill bodies, credentials, full IP addresses, email, or GitHub OAuth metadata.
6. End the session, record UTC completion time, and remind the participant how to delete their SkillMap account.

## Redacted session receipt

Store one JSON object per line outside the public repository. Use only this shape:

```json
{
  "schemaVersion": "skillmap-hosted-alpha-pilot/v1",
  "sessionId": "pilot_opaque_id",
  "participantRole": "skill-user",
  "task": "inspect-evidence",
  "startedAt": "2026-07-13T00:00:00Z",
  "completedAt": "2026-07-13T00:12:00Z",
  "outcome": "completed-uncoached",
  "routes": ["/skills", "/skills/publisher/skill", "/skills/publisher/skill/audit"],
  "boundedErrorCodes": [],
  "coachingEvents": 0,
  "feedbackCodes": ["grade-boundary-clear"],
  "followUpConsentRecordedSeparately": true
}
```

Allowed outcomes are `completed-uncoached`, `completed-coached`, `partial`, `abandoned`, and `blocked-by-product`. Route values must omit query strings, receipt IDs, account IDs, repository coordinates, and other participant-linked values when they are not already public catalog paths.

## Operator follow-through

After each session:

1. remove synthetic or test-only rows while preserving authorized participant submissions and their account-owned status;
2. classify every failure as launch blocker, accepted documented limitation, or post-alpha backlog;
3. fix and rerun local plus live affected gates before the next participant when the failure is P0, P1, privacy, auth, data-integrity, or trust-related;
4. never edit a participant submission, receipt, or lifecycle row by hand; use documented owner/operator actions; and
5. pause invitations immediately for secret exposure, cross-account access, forged evidence, unsafe publication, or an uncontained incident.

After the fifth session, publish only aggregate counts: total completed, completed uncoached, median active elapsed time, task mix, mandatory-workflow coverage, bounded failure categories, and fixes. Do not publish individual receipts or feedback text without separate consent.

## Decision

- `PASS`: at least four completed uncoached, every mandatory workflow has an uncoached receipt including one author follow-through through published evidence, and no unresolved P0/P1, privacy, auth, data-integrity, or trust failure exists.
- `REPEAT`: fewer than four completed uncoached because of a fixed product issue; recruit a new five-person cohort after live reacceptance.
- `NO-GO`: any unresolved launch blocker, unsafe evidence claim, cross-account leak, provider incident, failed restore/rollback, or policy/owner gate remains.

Pilot success permits a public-launch review. It does not itself authorize DNS, indexing, announcement, or invitations beyond the approved cohort.
