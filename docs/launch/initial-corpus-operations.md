# Initial public-alpha corpus operations

Status: 20 exact source candidates are prepared locally across five comparison groups and six repository owners. They are not submitted, published, or counted toward launch. Publisher consent, production receipts, and public visibility remain required.

## Canonical inputs

- Candidate manifest: `docs/launch/initial-corpus-v1.json`
- Deterministic preparer: `scripts/initial-corpus-prepare.mjs`
- Inert batch audit: `scripts/initial-corpus-audit.mjs`
- Submission, collision, review, publication, and lifecycle authority: `docs/operations/free-public-alpha-runbook.md`

The candidate set contains exactly four versions in each launch comparison group:

1. frontend design and UI implementation;
2. code review, security review, and acceptance testing;
3. research, documentation, and technical writing;
4. deployment, infrastructure, and production operations; and
5. skill authoring, discovery, routing, and maintenance.

The six repository owners are Anthropic, Cloudflare, GitHub, Hugging Face, Supabase, and `obra`. Every coordinate is a full immutable commit and a canonical `SKILL.md` path. Apache-2.0 or MIT evidence is bound to the same repository and commit. Vercel's currently unlicensed skill repository, proprietary Anthropic document skills, deprecated OpenAI skills, conflicting proprietary plugin scopes, and CC-only or unclear paths are excluded from this candidate.

## Preparation gate

Run preparation outside the repository so the owner-only artifact is not accidentally committed:

```bash
rm -f /tmp/skillmap-initial-corpus-prepared.json
npm run corpus:prepare -- \
  --input docs/launch/initial-corpus-v1.json \
  --output /tmp/skillmap-initial-corpus-prepared.json
```

The command must report 20 entries, five groups, `prepared-only`, and `pending-publisher-consent`. It does not use the network, mutate a database, submit a row, run an audit, assign a grade, or publish anything. It intentionally emits no mutating command.

Public repository visibility and an open-source license do not imply publisher endorsement or consent to the SkillMap submission workflow. The manifest therefore keeps every candidate blocked. Before a publisher's versions enter the authenticated queue, retain a redacted consent/reference receipt outside the public repository. Never store private messages, email addresses, tokens, or personal data in the manifest or implementation ledger.

## Inert source and audit gate

Build the exact candidate, then run the batch audit into a private temporary receipt:

```bash
rm -f /tmp/skillmap-initial-corpus-audit.json
npm run corpus:audit -- \
  --input docs/launch/initial-corpus-v1.json \
  --output /tmp/skillmap-initial-corpus-audit.json
```

The auditor may contact only the exact public GitHub sources. It treats every fetched file as inert bytes, rejects redirects, mutable refs, symlinks, submodules, oversized trees, source drift, and incomplete fetches, and never executes submitted scripts. It does not contact Supabase or the hosted product. Its grade output is static and may be only `provisional` or `blocked`; it cannot mint a current letter grade or publication receipt.

Any failed fetch, blocked audit, unresolved license, publisher mismatch, collision, unsafe permission surface, or materially stale source keeps that version out of the initial catalog. Replace a rejected candidate only through a reviewed manifest change that preserves the five-group/four-version balance and reruns the complete preparation and audit gates.

## Authorized ingestion sequence

After publisher consent and the external hosting/policy owner gates close:

1. The authorized publisher or submitter signs in and submits the manifest's exact repository, commit, path, version label, and license claim through the normal account workflow. Never create rows by hand.
2. Respect the enforced per-account active and rolling limits. Process accepted versions sequentially; do not weaken quotas to seed the catalog.
3. Run the service-role worker for exactly one submission with the reviewed license disposition.
4. Inspect the bounded audit and provisional-grade receipts. A static score is not a safety badge or current letter.
5. Load collision evidence. If a match exists, record one immutable reviewed disposition before publication.
6. Record current publisher authorization with the service-only `hosted:publisher:authorization` command. Bind the exact submission and publisher handle to the retained consent reference and evidence digest, choose an expiry no more than 366 days ahead, and use one fresh canonical operation UUID. An approver must first record the exact action envelope; capture the returned `opa_...` approval ID, unload that credential, and have a distinct executor repeat the byte-identical action arguments and operation UUID before the 30-minute expiry. Never copy credentials, private consent text, or contact details into the command, logs, or ledger.
7. Prepare public metadata from reviewed evidence. Treat upstream names and descriptions as untrusted source material; verify the publisher handle, skill slug/display name, summary, capabilities, license state, script presence, network domains, and tool requirements.
8. Publish through the receipt-backed service RPC, then verify the account result, public listing, exact source link, audit route, grade route, lifecycle state, authorization expiry, and timestamps.
9. Reproduce one source/audit digest before advancing to the next version.

Authorization is not implied by an open-source license or a submitter acknowledgement. Expiry hides the listing until fresh evidence renews the exact active version. A publisher revocation is terminal for the exact repository, commit, and path across accounts and publisher handles, blocks every matching published version, and cannot be bypassed by resubmission; a future identity-transfer exception requires a separate reviewed authority design.

Use this mutation-explicit template for step 6, replacing every placeholder from the retained consent receipt and generating a fresh operation UUID for each version. Run the first command with only the approver credential loaded. Capture its returned approval ID as `APPROVAL_ID`, unload the approver credential, and run the second command with only a distinct executor credential loaded. Except for the mode and required approval ID, the action payload below is byte-identical:

```bash
npm run hosted:publisher:authorization -- \
  --approve --submission-id "$SUBMISSION_ID" --publisher-handle "$REVIEWED_PUBLISHER_HANDLE" \
  --decision authorized --basis publisher-owner-approval \
  --evidence-reference "$AUTHORIZATION_REFERENCE" \
  --evidence-digest "$AUTHORIZATION_EVIDENCE_DIGEST" \
  --expires-at "$AUTHORIZATION_EXPIRES_AT" \
  --operation-id "$FRESH_OPERATION_UUID"

# Set APPROVAL_ID to the opa_... value returned above. A distinct executor then
# repeats the exact action arguments and operation UUID before approval expiry.
npm run hosted:publisher:authorization -- \
  --execute --approval-id "$APPROVAL_ID" --submission-id "$SUBMISSION_ID" --publisher-handle "$REVIEWED_PUBLISHER_HANDLE" \
  --decision authorized --basis publisher-owner-approval \
  --evidence-reference "$AUTHORIZATION_REFERENCE" \
  --evidence-digest "$AUTHORIZATION_EVIDENCE_DIGEST" \
  --expires-at "$AUTHORIZATION_EXPIRES_AT" \
  --operation-id "$FRESH_OPERATION_UUID"
```

Do not bulk-approve, fabricate consent, copy private evidence into public metadata, bypass collision review, or hand-edit rows. The free launch has no checkout, subscription, billing, paid placement, or paid fast path.

## Corpus acceptance receipt

The launch corpus gate closes only when all of these are true for 20 versions:

- publisher consent/authority is reviewed and redacted references are retained;
- exact source and license evidence still resolve;
- each submission completed through the normal worker path;
- each public listing has a receipt-backed audit and truthful provisional/blocked grade state;
- every collision was absent or explicitly dispositioned;
- all five groups still contain four useful alternatives or complements;
- public list/detail/audit/grade routes expose the exact version and no private evidence;
- no candidate is quarantined, revoked, restricted, or pending remediation; and
- the exact deployed commit, authoritative CI, live browser, restore/rollback, policy, support, operator, and pilot gates also pass.

Until then, the corpus is locally prepared evidence and the public launch verdict remains `NO-GO`.
