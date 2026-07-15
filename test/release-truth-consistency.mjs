import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const releaseCandidate = '413d8759e244005406280cd8d7c2fe2ec01b84bf';
const releaseMergedMain = '8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7';
const releaseTree = '00273fce90c0294f4f3aea2407d4ba0c65aec1f9';
const checkpointRemoteMain = '5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a';
const checkpointRemoteTree = '8d74d820235657a0060bcca7b514392c073bb3b1';
const sources = Object.fromEntries([
  'README.md',
  'HANDOFF.md',
  'CHANGELOG.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/plans/2026-07-12-skillmap-release-ledger.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl',
  'docs/security/hosted-threat-model.md',
  'apps/web/app/release-status/page.tsx',
  'apps/web/lib/supabase/database.runtime.types.ts',
  'apps/worker/README.md',
  'docs/operations/free-public-alpha-runbook.md',
  'docs/operations/hosted-alpha-deploy.md',
  'docs/launch/initial-corpus-operations.md',
  'supabase/seed.sql'
].map(file => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')]));

test('canonical release truth binds the merged source and scoped CI receipts', () => {
  for (const file of [
    'HANDOFF.md',
    'CHANGELOG.md',
    'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
    'docs/plans/2026-07-12-skillmap-release-ledger.md',
    'docs/security/hosted-threat-model.md'
  ]) {
    assert.match(sources[file], new RegExp(releaseMergedMain), file);
  }
  assert.match(sources['HANDOFF.md'], new RegExp(releaseCandidate));
  assert.match(sources['HANDOFF.md'], new RegExp(releaseTree));
  assert.match(sources['HANDOFF.md'], /Gitea candidate run ID `70` \(UI run `53`\) passed/i);
  assert.match(sources['HANDOFF.md'], /job `87033792983` passed all fifteen steps in the one-shot self-hosted hosted-web scope/i);
  assert.match(sources['HANDOFF.md'], /post-merge `main` run ID `73` \(UI `56`\) (?:all )?passed/i);
  assert.match(sources['HANDOFF.md'], /historical receipt is retained in the append-only release-ledger product row/i);
  const releaseLedger = sources['docs/plans/2026-07-12-skillmap-release-ledger.md'];
  assert.match(releaseLedger, new RegExp(releaseCandidate));
  assert.match(releaseLedger, /Go-to-market hardening and five-RPC dual-control source locally validated, pushed, merged, dual-remote reconciled, and accepted by the named scoped CI/i);
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
  assert.equal(releaseReceipt.claims.dual_remote_reconciled, true);
  assert.equal(releaseReceipt.claims.deployed, false);
  assert.equal(releaseReceipt.claims.verified_live, false);
  assert.equal(releaseReceipt.claims.public_launch_verdict, 'NO_GO');
  assert.deepEqual(releaseReceipt.evidence, {
    local_candidate_receipt: 'sha256:578cf9554fe6c9f4d61575cad8f968be49bb1299e1abe1f8d9339c30afce345f',
    gitea_static_receipt: 'sha256:dd791b2c316a1117e4b73081a842192a2e4cbc1eafdf1428110b35c73ef90821',
    gitea_database_receipt: 'sha256:d9ca6aa7cf806645ea425c1950facf1fbf2eaa22f00630d365844ebee4fcdd56',
    github_run: '29317179590',
    github_job: '87033792983',
    github_artifact: '8304546847',
    github_pr: '17',
    gitea_candidate_run: '70',
    gitea_candidate_run_index: '53',
    gitea_sync_run: '71',
    gitea_sync_run_index: '54',
    gitea_pr: '7',
    gitea_pr_run: '72',
    gitea_pr_run_index: '55',
    gitea_main_run: '73',
    gitea_main_run_index: '56'
  });
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

test('checkpoint truth distinguishes historical product acceptance from the current remote head', () => {
  const plan = sources['docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md'];
  const threatModel = sources['docs/security/hosted-threat-model.md'];
  const handoff = sources['HANDOFF.md'];
  const goToMarket = sources['docs/launch/free-public-alpha-go-to-market.md'];

  for (const [file, source] of [
    ['implementation plan', plan],
    ['threat model', threatModel],
    ['operator handoff', handoff],
    ['go-to-market kit', goToMarket]
  ]) {
    assert.match(source, new RegExp(checkpointRemoteMain), `${file}: current checkpoint head is absent`);
    assert.match(source, new RegExp(checkpointRemoteTree), `${file}: current checkpoint tree is absent`);
    assert.match(source, new RegExp(releaseCandidate), `${file}: historical accepted candidate is absent`);
    assert.match(source, new RegExp(releaseMergedMain), `${file}: historical accepted merge is absent`);
    assert.match(source, /Gitea runs? `75` through `77`/i, `${file}: current Gitea receipt is absent`);
    assert.match(source, /GitHub (?:workflow|Actions) run `29320562416`/i,
      `${file}: exact-current GitHub failure receipt is absent`);
    assert.match(source, /exact-current GitHub[^.]+(?:still|remains) open/i,
      `${file}: missing GitHub acceptance is not kept open`);
    assert.match(source, /no deployment|not deployed|neither pushed nor remotely accepted/i,
      `${file}: source truth is collapsed into deployment truth`);
  }

  assert.doesNotMatch(threatModel, /not yet an exact remotely accepted candidate/i,
    'threat model reintroduced the stale pre-8bb source-acceptance claim');
  assert.doesNotMatch(threatModel, /^## Current locally accepted candidate posture$/im,
    'threat model relabeled historical acceptance evidence as the current checkpoint');
  assert.match(threatModel, /Those `440\/440`, `45\/45`, `585\/585`, and thirteen-baseline results are the\s+historical candidate's acceptance record/i);
  assert.match(threatModel, /20260715010000_hosted_evidence_version_authority[.]sql/);
  assert.match(threatModel, /20260715020000_hosted_report_idempotency_recovery[.]sql/);
  assert.match(threatModel, /remains\s+local, uncommitted, unpushed, undeployed, and not remotely accepted/i);
  assert.doesNotMatch(plan,
    /Latest dual-remote repository-main truth:[\s\S]{0,240}`8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7`/i,
    'implementation plan reintroduced 8bb as the current remote head');
  assert.doesNotMatch(plan,
    /\| Quality \|[^\n]+\| GitHub and Gitea `main` both resolve to `8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7`/i,
    'readiness table reintroduced the historical merge as current remote truth');
  assert.doesNotMatch(handoff, /Current status: the go-to-market\/dual-control candidate was/i,
    'operator handoff reintroduced the historical product candidate as current status');
  assert.match(handoff, /present `codex\/product-checkpoint` remediation is local, uncommitted, unpushed, and not remotely accepted/i);
  assert.match(goToMarket, /present product-checkpoint\s+patch is local, uncommitted, unpushed, and not remotely accepted/i);
  assert.match(goToMarket, /historical source-integration proof[\s\S]{0,80}not the\s+current remote head/i);
  assert.doesNotMatch(goToMarket,
    /current integrated repository head is\s+`8bb2b1d25befeb53e13d0e05a6934dacc9d45cd7`/i,
    'go-to-market kit reintroduced the historical product merge as current truth');
});

test('production deployment excludes local seed data and requires the normal corpus path', () => {
  const seed = sources['supabase/seed.sql'];
  const runbook = sources['docs/operations/hosted-alpha-deploy.md'];
  const handoff = sources['HANDOFF.md'];

  assert.match(seed, /LOCAL DEVELOPMENT AND TEST DATA ONLY/i);
  assert.match(seed, /Never apply this seed to a hosted or\s+(?:--\s*)?production project/i);
  assert.doesNotMatch(runbook, /^supabase db push[^\n]*--include-seed/gm,
    'production migration commands must never include local seed data');
  assert.doesNotMatch(runbook, /reapply[^.\n]*migration[^.\n]*and seed/i,
    'database recovery must not reintroduce the local seed');
  assert.doesNotMatch(handoff, /apply[^.\n]*migrations? and seed/i,
    'operator handoff must not instruct a hosted seed application');
  assert.match(runbook, /checked-in `supabase\/seed[.]sql` is local development and test data only/i);
  assert.match(runbook, /Never apply the checked-in local seed/i);
  assert.match(handoff, /migrations without the local development seed/i);
  assert.doesNotMatch(runbook, /each first-party detail/i);
  assert.match(runbook, /each reviewed public-corpus detail/i);
  assert.match(runbook, /authenticated account submission[^.]+worker and evidence gates[^.]+distinct approver\/executor dual-control publication/i);
  assert.match(runbook, /Public launch remains blocked until 20 owner-authorized listings resolve to their exact anonymous public sources/i);
});

test('initial corpus authorization documents an exact approval and distinct execution pair', () => {
  const source = sources['docs/launch/initial-corpus-operations.md'];
  const templateSection = source.slice(source.indexOf('Use this mutation-explicit template'));
  const bashBlock = templateSection.match(/```bash\n([\s\S]*?)\n```/)?.[1] ?? '';
  const commands = bashBlock.match(/npm run hosted:publisher:authorization -- \\\n(?:  .*\n?)+/g) ?? [];

  assert.equal(commands.length, 2, 'authorization template must contain one approval and one execution command');
  assert.match(commands[0], /--approve --submission-id "\$SUBMISSION_ID"/);
  assert.doesNotMatch(commands[0], /--approval-id/);
  assert.match(commands[1], /--execute --approval-id "\$APPROVAL_ID" --submission-id "\$SUBMISSION_ID"/);
  assert.equal((bashBlock.match(/--operation-id "\$FRESH_OPERATION_UUID"/g) ?? []).length, 2,
    'both authorization modes must use the same explicit operation UUID variable');
  const actionPayload = command => command
    .replace('--approve ', '')
    .replace('--execute --approval-id "$APPROVAL_ID" ', '')
    .trimEnd();
  assert.equal(actionPayload(commands[0]), actionPayload(commands[1]),
    'approval and execution action arguments must remain byte-identical');
  assert.match(source, /distinct executor[^.]+byte-identical action arguments and operation UUID[^.]+30-minute expiry/i);
  assert.match(source, /Never copy credentials[^.]+logs, or ledger/i);
});

test('go-to-market checklist records source integration without claiming external gates', () => {
  const checklist = sources['docs/launch/free-public-alpha-go-to-market.md'];
  assert.match(checklist, /- \[x\].*Baseline-only candidate `67129297d08f7f7bc88800015b336a2a7bb1b139`/i);
  assert.match(checklist, /historical baseline remains independently scoped and is supplemented by the operator read-plane receipt below/i);
  assert.match(checklist, /- \[x\].*operator read-plane candidate `69e7d1e7f2042ae996c1bed379891ec65ece84a4`/i);
  assert.match(checklist, /- \[x\].*launch-readiness candidate `e6fc09e9d8300fbd5bb974899cb18b5d1b2d8af6`/i);
  assert.match(checklist, new RegExp('- \\[x\\].*go-to-market/dual-control candidate `' + releaseCandidate + '`', 'i'));
  assert.match(checklist, new RegExp(releaseTree));
  assert.match(checklist, new RegExp(releaseMergedMain));
  assert.match(checklist, /post-merge `main` run ID `73` \(UI `56`\) passed/i);
  assert.doesNotMatch(checklist, /- \[ \].*Freeze and push that working slice/i);
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
    assert.match(source, /20260714030000_github_provider_rate_limit_deferral[.]sql/, file);
    assert.match(source, /20260714050000_report_authorization_enforcement[.]sql/, file);
    assert.match(source, /20260714060000_operator_dual_control[.]sql/, file);
    assert.match(source, /20260715010000_hosted_evidence_version_authority[.]sql/, file);
    assert.match(source, /20260715020000_hosted_report_idempotency_recovery[.]sql/, file);
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
