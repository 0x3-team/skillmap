import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const checkpointParent = '5b9fb6e49ee3fcbcfc63336c810cbb1cc3bff93a';
const releaseCandidate = '33e66c4175676355c275db091eb876bae81e29cf';
const releaseMergedMain = '72ce471f378db36dfeb4faa31ec52c05e2e57654';
const releaseTree = 'c0fc2ce7e8d4584ee2f7ed5ae2fb72e54b69ade6';
const sources = Object.fromEntries([
  'README.md',
  'HANDOFF.md',
  'CHANGELOG.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/plans/2026-07-12-skillmap-release-ledger.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan-implementation-ledger.jsonl',
  'docs/plans/2026-07-15-skillmap-product-checkpoint-implementation-plan-implementation-ledger.jsonl',
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
  assert.match(sources['HANDOFF.md'], /Gitea candidate run ID `78` \(UI run `61`\)/i);
  assert.match(sources['HANDOFF.md'], /job `87267621311`[^.]+passed all fifteen target steps/i);
  assert.match(sources['HANDOFF.md'], /post-merge `main` run ID `81` \(UI `64`\)[^.]+passed both required jobs/i);
  assert.match(sources['HANDOFF.md'], /moving branch heads must still be verified live/i);
  const releaseLedger = sources['docs/plans/2026-07-12-skillmap-release-ledger.md'];
  assert.match(releaseLedger, new RegExp(releaseCandidate));
  assert.match(releaseLedger, /Product checkpoint source locally validated, pushed, merged, protected-dual-remote reconciled, and accepted by the named scoped CI/i);
  assert.match(releaseLedger, /sixteen other failed jobs and two skipped jobs executed zero steps[^.]+acceptance is scoped only to that named job/i);
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
  assert.equal(releaseReceipt.claims.candidate_parent, checkpointParent);
  assert.equal(releaseReceipt.claims.merge_parent, checkpointParent);
  assert.equal(releaseReceipt.claims.merge_tree, releaseTree);
  assert.equal(releaseReceipt.claims.dual_remote_reconciled, true);
  assert.equal(releaseReceipt.claims.moving_heads_require_live_verification, true);
  assert.equal(releaseReceipt.claims.deployed, false);
  assert.equal(releaseReceipt.claims.verified_live, false);
  assert.equal(releaseReceipt.claims.public_launch_verdict, 'NO_GO');
  assert.deepEqual(releaseReceipt.evidence, {
    local_candidate_receipt: 'sha256:46ce7276a7e4c8206245651182376e615c1878d168fff1daa002cc4400f39dcf',
    gitea_candidate_static_receipt: 'sha256:c65091486359bc69286b0a65fd2e4935be57cc2535125e3a527250550eeb7ae1',
    gitea_candidate_database_receipt: 'sha256:8f94a6b39c6f3a60686b24da2b62a99d9a619e08d1bed06a301b24dd14d3a4bf',
    github_run: '29388840669',
    github_job: '87267621311',
    github_artifact: '8332525171',
    github_pr: '19',
    github_target_steps_passed: 15,
    github_other_failed_jobs_zero_steps: 16,
    github_other_skipped_jobs_zero_steps: 2,
    accepted_runner: '32',
    gitea_candidate_run: '78',
    gitea_candidate_run_index: '61',
    gitea_sync_run: '79',
    gitea_sync_run_index: '62',
    gitea_sync_static_receipt: 'sha256:a57e2a3ae06ebf11fdbf12961d6fe54c79fabb991dc6b4331ecab35eb5fc75d6',
    gitea_sync_database_receipt: 'sha256:7c87664fb58ed70ff9f1dffedf11a7e849600a479d44fe5cb132bfe1e6218832',
    gitea_pr: '9',
    gitea_pr_run: '80',
    gitea_pr_run_index: '63',
    gitea_pr_static_receipt: 'sha256:33a61e8733bcf889a4693118715147030582496e3fb1b96b6f5758be84b6de65',
    gitea_pr_database_receipt: 'sha256:b3c54294ff9a27101a940ae3d46631b0204d280169ca9722e95a7b1df4259b33',
    gitea_main_run: '81',
    gitea_main_run_index: '64',
    gitea_main_static_receipt: 'sha256:f718f5cde176c4b5260808f2c228a4bf19541d7c4a61f10451d19c436cc5c50e',
    gitea_main_database_receipt: 'sha256:fb26de51345999ddce4f85a5bff4d42b9c6a9b854e874349546b34b714116a34',
    github_merge_at: '2026-07-15T04:32:15Z',
    gitea_merge_at: '2026-07-15T04:46:15Z',
    cleanup: {
      registered_github_runners: 0,
      isolated_runner_resources: 0,
      temporary_gitea_credentials: 0,
      remote_release_branches: 0
    }
  });

  const checkpointLedger = sources['docs/plans/2026-07-15-skillmap-product-checkpoint-implementation-plan-implementation-ledger.jsonl']
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const checkpointReceipt = checkpointLedger.find(receipt =>
    receipt.event === 'exact-source-integration-receipt'
    && receipt.claims?.candidate_commit === releaseCandidate
  );
  assert.ok(checkpointReceipt);
  assert.deepEqual(checkpointReceipt.evidence, releaseReceipt.evidence);
  assert.equal(checkpointReceipt.claims.validated_locally, 'PASS_WITH_ACCEPTED_RISKS');
  assert.equal(checkpointReceipt.claims.merge_commit, releaseMergedMain);
  assert.equal(checkpointReceipt.claims.dual_remote_reconciled, true);
  assert.equal(checkpointReceipt.claims.deployed, false);
  assert.equal(checkpointReceipt.claims.verified_live, false);
  assert.equal(checkpointReceipt.claims.public_launch_verdict, 'NO_GO');

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
  assert.match(sources['CHANGELOG.md'], /Subsequent Unreleased product changes[\s\S]+own\s+candidate and\s+merge receipt/i);
  assert.match(sources['apps/web/app/release-status/page.tsx'], /No remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed/i);
});

test('checkpoint truth binds the accepted product merge without freezing moving remote heads', () => {
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
    assert.match(source, new RegExp(checkpointParent), `${file}: product parent is absent`);
    assert.match(source, new RegExp(releaseCandidate), `${file}: accepted candidate is absent`);
    assert.match(source, new RegExp(releaseTree), `${file}: accepted tree is absent`);
    assert.match(source, new RegExp(releaseMergedMain), `${file}: accepted merge is absent`);
    assert.match(source, /Gitea candidate run ID `78` \(UI(?: run)? `61`\)/i,
      `${file}: candidate Gitea receipt is absent`);
    assert.match(source, /GitHub Actions\s+run `29388840669`/i,
      `${file}: scoped GitHub receipt is absent`);
    assert.match(source, /post-merge `main` run ID `81` \(UI `64`\)/i,
      `${file}: post-main Gitea receipt is absent`);
    assert.match(source, /moving (?:branch |remote )?heads?[^.]+(?:live\s+verification|verified\s+live)/i,
      `${file}: moving-head verification boundary is absent`);
    assert.match(source, /no deployment|not deployed|not deployment|nothing[^.]+claims deployment/i,
      `${file}: source truth is collapsed into deployment truth`);
    assert.doesNotMatch(source,
      new RegExp(`current dual-remote(?: repository)?[^.]{0,160}${releaseMergedMain}`, 'i'),
      `${file}: accepted product merge is misreported as an immutable current head`);
    assert.doesNotMatch(source, /present product-checkpoint[^.]+local, uncommitted, unpushed/i,
      `${file}: superseded local-only checkpoint claim remains current`);
  }

  assert.match(threatModel, /20260715010000_hosted_evidence_version_authority[.]sql/);
  assert.match(threatModel, /20260715020000_hosted_report_idempotency_recovery[.]sql/);
  assert.match(threatModel, /pgTAP `621\/621` across ten files/i);
  assert.match(plan, /Thirteen ordered migrations[^|]+`621\/621` pgTAP assertions across ten files/i);
  assert.match(handoff, /latest accepted product-code merge/i);
  assert.match(goToMarket, /later documentation\/tests-only receipt descendant[^.]+not a new product candidate/i);
  for (const source of [plan, threatModel, handoff, goToMarket]) {
    assert.doesNotMatch(source, /exact-current GitHub acceptance remains open/i);
    assert.doesNotMatch(source, /remains local, uncommitted, unpushed, undeployed, and not remotely accepted/i);
  }
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
  assert.match(checklist, /- \[x\].*go-to-market\/dual-control candidate `413d8759e244005406280cd8d7c2fe2ec01b84bf`/i);
  assert.match(checklist, new RegExp('- \\[x\\].*product-checkpoint candidate `' + releaseCandidate + '`', 'i'));
  assert.match(checklist, new RegExp(releaseTree));
  assert.match(checklist, new RegExp(releaseMergedMain));
  assert.match(checklist, /post-merge `main` run ID `81` \(UI `64`\) passed/i);
  assert.match(checklist, /unexpired artifact `8332525171`/i);
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
  assert.match(workerScripts['typecheck'], /tsc -p tsconfig[.]json/);
  const runtimeTypes = sources['apps/web/lib/supabase/database.runtime.types.ts'];
  assert.match(runtimeTypes, /Database as GeneratedDatabase.*database[.]types/);
  assert.match(runtimeTypes, /Omit<GeneratedDatabase, "__InternalSupabase" \| "api" \| "private">/);
  assert.match(
    runtimeTypes,
    /export type RuntimeDatabaseSchemaAssertion = AssertTrue<\s*IsExact<keyof Database, "api">\s*>/
  );
  assert.match(runtimeTypes, /api: Omit<ApiSchema, "Functions"> & \{ Functions: RuntimeFunctions \};/);
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
