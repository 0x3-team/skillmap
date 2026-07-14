import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operatorCandidate = '69e7d1e7f2042ae996c1bed379891ec65ece84a4';
const operatorMergedMain = '8a30578520974257a1ab4ee2f6c7442696ee0289';
const operatorReleaseTree = '67235ad3ce1553c4b3ba47a36c8e22f9c53cf89c';
const sources = Object.fromEntries([
  'README.md',
  'HANDOFF.md',
  'CHANGELOG.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/plans/2026-07-12-skillmap-release-ledger.md',
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
    assert.match(sources[file], new RegExp(operatorMergedMain), file);
  }
  assert.match(sources['HANDOFF.md'], new RegExp(operatorCandidate));
  assert.match(sources['HANDOFF.md'], new RegExp(operatorReleaseTree));
  assert.match(sources['HANDOFF.md'], /Gitea candidate run `50` passed/i);
  assert.match(sources['HANDOFF.md'], /job `86964954830` passed the one-shot self-hosted `hosted-web` scope/i);
  assert.match(sources['HANDOFF.md'], /post-merge `main` run `53` (?:all )?passed/i);
  assert.match(sources['HANDOFF.md'], /now bound to the second release-ledger row/i);
  const releaseLedger = sources['docs/plans/2026-07-12-skillmap-release-ledger.md'];
  assert.match(releaseLedger, new RegExp(operatorCandidate));
  assert.match(releaseLedger, /Operator read-plane source locally validated, pushed, merged, and verified by the named scoped remote CI/i);
  assert.match(releaseLedger, /overall GitHub workflow remained red only because unrelated GitHub-hosted jobs were blocked by the organization allowance/i);
  assert.match(sources['README.md'], /baseline source-integration receipt is already pushed and merged/i);
});

test('canonical release truth does not collapse source acceptance into deployment or launch', () => {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\bno push\b|has not been pushed|no authoritative current-commit CI/i, file);
  }
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
  assert.match(checklist, new RegExp('- \\[x\\].*operator read-plane candidate `' + operatorCandidate + '`', 'i'));
  assert.match(checklist, new RegExp(operatorReleaseTree));
  assert.match(checklist, new RegExp(operatorMergedMain));
  assert.match(checklist, /post-merge `main` run `53` passed/i);
  assert.doesNotMatch(checklist, /- \[ \].*operator read-plane/i);
  assert.match(checklist, /- \[ \].*Production Supabase, web, OAuth/i);
  assert.match(checklist, /- \[ \].*pilot/i);
  assert.match(checklist, /- \[ \].*index/i);
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
