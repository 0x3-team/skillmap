import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const releaseCandidate = '918a5015bcb8c264f9fe39c6cdd7940e67aef02e';
const releaseMergedMain = 'a4f97fa0d32b1abaaf29bc38f81d81cbc593b04b';
const releaseTree = '29aba50561cbb9f79d15a8b8257076ff671fd1ee';
const sources = Object.fromEntries([
  'README.md',
  'HANDOFF.md',
  'CHANGELOG.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/plans/2026-07-12-skillmap-release-ledger.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl',
  'apps/web/app/release-status/page.tsx',
  'apps/web/lib/supabase/database.runtime.types.ts',
  'apps/worker/README.md',
  'docs/operations/free-public-alpha-runbook.md'
].map(file => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')]));

test('canonical release truth binds the merged source and scoped CI receipts', () => {
  for (const file of [
    'HANDOFF.md',
    'CHANGELOG.md',
    'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
    'docs/plans/2026-07-12-skillmap-release-ledger.md'
  ]) {
    assert.match(sources[file], new RegExp(releaseMergedMain), file);
  }
  assert.match(sources['HANDOFF.md'], new RegExp(releaseCandidate));
  assert.match(sources['HANDOFF.md'], new RegExp(releaseTree));
  assert.match(sources['HANDOFF.md'], /Gitea candidate run `61` passed/i);
  assert.match(sources['HANDOFF.md'], /job `86996452876` passed all fifteen steps in the one-shot self-hosted hosted-web scope/i);
  assert.match(sources['HANDOFF.md'], /post-merge `main` run `64` (?:all )?passed/i);
  assert.match(sources['HANDOFF.md'], /now bound to the fourth release-ledger row/i);
  const releaseLedger = sources['docs/plans/2026-07-12-skillmap-release-ledger.md'];
  assert.match(releaseLedger, new RegExp(releaseCandidate));
  assert.match(releaseLedger, /Completion-audit provider-backpressure source locally validated, pushed, merged, dual-remote reconciled, and verified by the named scoped remote CI/i);
  assert.match(releaseLedger, /overall GitHub workflow remained red only because unrelated GitHub-hosted jobs were blocked by the organization allowance/i);
  const implementationLedger = sources['docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl']
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const releaseReceipt = implementationLedger
    .filter(receipt => receipt.event === 'superseding-source-integration-receipt')
    .find(receipt => receipt.claims?.candidate_commit === releaseCandidate);
  assert.ok(releaseReceipt);
  assert.equal(releaseReceipt.claims.candidate_tree, releaseTree);
  assert.equal(releaseReceipt.claims.merge_commit, releaseMergedMain);
  assert.equal(releaseReceipt.claims.deployed, false);
  assert.equal(releaseReceipt.claims.verified_live, false);
  assert.equal(releaseReceipt.claims.public_launch_verdict, 'NO_GO');
  const completionAudit = implementationLedger
    .find(receipt =>
      receipt.batch === 'completion-audit-provider-backpressure'
      && receipt.event === 'completion-audit-local-acceptance'
    );
  assert.ok(completionAudit);
  assert.equal(completionAudit.status, 'locally-accepted-awaiting-exact-source-receipt');
  assert.equal(completionAudit.claims.validated_locally, true);
  assert.equal(completionAudit.claims.exact_candidate, false);
  assert.equal(completionAudit.claims.pushed, false);
  assert.equal(completionAudit.claims.merged, false);
  assert.equal(completionAudit.claims.deployed, false);
  assert.equal(completionAudit.claims.verified_live, false);
  assert.equal(completionAudit.claims.public_launch_verdict, 'NO_GO');
  assert.match(sources['README.md'], /baseline source-integration receipt is already pushed and merged/i);
});

test('canonical release truth does not collapse source acceptance into deployment or launch', () => {
  for (const file of [
    'HANDOFF.md',
    'CHANGELOG.md',
    'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
    'docs/plans/2026-07-12-skillmap-release-ledger.md',
    'apps/web/app/release-status/page.tsx'
  ]) {
    assert.match(sources[file], /not deployed|deployment[^.]+not|not deployment/i, file);
    assert.match(sources[file], /not[^.]+verified live|verified-live[^.]+not|does not prove[^.]+verified-live|live-verification boundaries/i, file);
  }
  assert.match(sources['HANDOFF.md'], /Launch remains `NO-GO`/i);
  assert.match(sources['docs/plans/2026-07-12-skillmap-release-ledger.md'], /`NO-GO`/i);
  assert.match(sources['CHANGELOG.md'], /Subsequent Unreleased product changes[\s\S]+own candidate and\s+merge receipt/i);
  assert.match(sources['apps/web/app/release-status/page.tsx'], /No remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed/i);
});

test('go-to-market checklist records source integration without claiming external gates', () => {
  const checklist = sources['docs/launch/free-public-alpha-go-to-market.md'];
  assert.match(checklist, /- \[x\].*Baseline-only candidate `67129297d08f7f7bc88800015b336a2a7bb1b139`/i);
  assert.match(checklist, /historical baseline remains independently scoped and is supplemented by the operator read-plane receipt below/i);
  assert.match(checklist, /- \[x\].*operator read-plane candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4`/i);
  assert.match(checklist, /- \[x\].*launch-readiness candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6`/i);
  assert.match(checklist, new RegExp('- \\[x\\].*completion-audit candidate `' + releaseCandidate + '`', 'i'));
  assert.match(checklist, new RegExp(releaseTree));
  assert.match(checklist, new RegExp(releaseMergedMain));
  assert.match(checklist, /post-merge `main` run `64` passed/i);
  assert.doesNotMatch(checklist, /- \[ \].*completion-audit candidate/i);
  assert.match(checklist, /- \[ \].*Production Supabase, web, OAuth/i);
  assert.match(checklist, /- \[ \].*pilot/i);
  assert.match(checklist, /- \[ \].*index/i);
  assert.match(checklist, /- \[ \].*source\/acquisition channel.*GitHub repository public.*protected Gitea `main`/i);
});

test('operator documentation, commands, and application types bind the final read plane', () => {
  for (const file of ['apps/worker/README.md', 'docs/operations/free-public-alpha-runbook.md']) {
    const source = sources[file];
    assert.match(source, /20260713060000_operator_submission_read_plane[.]sql/, file);
    assert.match(source, /20260714010000_atomic_report_enforcement[.]sql/, file);
    assert.match(source, /hosted:queue:list/, file);
    assert.match(source, /hosted:queue:inspect/, file);
    assert.match(source, /best-effort[^.]+live/i, file);
    assert.match(source, /restart[^.]+no cursor|restart once from no cursor/i, file);
    assert.match(source, /not[^.]+at-least-once/i, file);
    assert.match(source, /after-updated-at/, file);
    assert.match(source, /licref_[0-9a-f]{32}/, file);
    assert.match(source, /sha256:[0-9a-f]{64}/, file);
    const digestTokens = [...source.matchAll(/sha256:[^\s`"'<>]*/gi)].map(match => match[0]);
    assert.ok(digestTokens.length > 0, `${file}: no SHA-256 token found`);
    for (const token of digestTokens) assert.match(token, /^sha256:[0-9a-f]{64}$/i, file);
  }
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const workerScripts = JSON.parse(readFileSync(
    new URL('../apps/worker/package.json', import.meta.url), 'utf8'
  )).scripts;
  assert.match(scripts['hosted:queue:list'], /submission-queue[.]mjs/);
  assert.match(scripts['hosted:queue:inspect'], /submission-detail[.]mjs/);
  assert.match(scripts['hosted:operations:check'], /operations-check[.]mjs/);
  assert.match(workerScripts['queue:list'], /submission-queue[.]mjs/);
  assert.match(workerScripts['queue:inspect'], /submission-detail[.]mjs/);
  assert.match(workerScripts['operations:check'], /operations-check[.]mjs/);
  const runtimeTypes = sources['apps/web/lib/supabase/database.runtime.types.ts'];
  assert.match(runtimeTypes, /Database as GeneratedDatabase.*database[.]types/);
  assert.match(runtimeTypes, /type NullableFields/);
  for (const rpc of [
    'get_skill_submission_operator_detail',
    'get_skill_submission_queue_summary',
    'list_skill_submission_operator_queue'
  ]) {
    assert.match(runtimeTypes, new RegExp(rpc));
  }
  for (const nullableField of ['claimed_at', 'oldest_queued_at', 'audit_receipt']) {
    assert.match(runtimeTypes, new RegExp(nullableField));
  }
  assert.match(runtimeTypes, /OperatorSubmissionDetailNonNullableJsonKey/);
  assert.match(runtimeTypes, /ExpectedOperatorSubmissionQueueSummaryNullableKey/);
  assert.match(runtimeTypes, /ExpectedOperatorSubmissionQueueNullableKey/);
  assert.match(runtimeTypes, /ExpectedOperatorSubmissionDetailNullableKey/);
  assert.match(runtimeTypes, /OperatorSubmissionExactNullabilityAssertions/);
  for (const row of [
    'OperatorSubmissionQueueSummary',
    'OperatorSubmissionQueueRow',
    'OperatorSubmissionDetail'
  ]) {
    assert.match(runtimeTypes, new RegExp(`NullableKeys<${row}>`));
    assert.match(runtimeTypes, new RegExp(`NonNullableKeys<${row}>`));
  }
});
