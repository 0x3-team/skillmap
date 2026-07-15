import assert from 'node:assert/strict';
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTrackedSecretScanEntries, scanRepositorySecretCanaries } from './repository-secret-canary.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const PROFILES = new Set(['static', 'candidate']);

export function parsePreflightArguments(argv) {
  const options = { profile: 'static', requireClean: false, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--require-clean') {
      assert.equal(options.requireClean, false, '--require-clean may be supplied only once');
      options.requireClean = true;
      continue;
    }
    if (argument === '--profile' || argument === '--output') {
      const key = argument === '--profile' ? 'profile' : 'output';
      assert.ok(index + 1 < argv.length, `${argument} requires a value`);
      assert.equal(seen.has(argument), false, `${argument} may be supplied only once`);
      seen.add(argument);
      options[key] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown preflight argument: ${argument}`);
  }
  assert.equal(PROFILES.has(options.profile), true, '--profile must be static or candidate');
  return options;
}

export function determineLocalVerdict(gates) {
  if (gates.some(gate => gate.status === 'failed')) return 'failed';
  if (gates.some(gate => gate.status === 'blocked')) return 'blocked';
  return 'passed';
}

export function buildReleaseReceipt({ candidate, gates, profile, generatedAt = new Date().toISOString() }) {
  const localVerdict = determineLocalVerdict(gates);
  return {
    schemaVersion: 'skillmap-free-public-alpha-preflight/v1',
    generatedAt,
    profile,
    candidate,
    localVerdict,
    launchVerdict: 'NO_GO',
    launchBoundary: 'Local candidate evidence is not push, deployment, live OAuth, backup retention, external-pilot, indexing, or public-launch proof.',
    gates
  };
}

export function writeExclusiveReceipt(target, receipt) {
  const absolute = path.resolve(target);
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const fd = openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    const stats = fstatSync(fd);
    assert.equal(stats.isFile(), true, 'preflight receipt target must remain a regular file');
  } finally {
    closeSync(fd);
  }
  return absolute;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.visible ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  return result;
}

function gitText(args) {
  const result = run('git', args);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function staticGates(requireClean) {
  const gates = [];
  const porcelain = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  gates.push({
    id: 'exact-candidate-worktree',
    status: requireClean && porcelain ? 'blocked' : 'passed',
    detail: porcelain
      ? (requireClean ? 'The worktree is not clean, so HEAD is not an exact candidate.' : 'Dirty worktree allowed for development-only checks. Commit and tree fields identify HEAD, while static gates inspect current candidate files; this is not exact-candidate evidence.')
      : 'The worktree is clean and HEAD identifies the exact candidate.'
  });

  const candidatePaths = gitText([
    'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    ':(exclude).chunk/**', ':(exclude).claude/**', ':(exclude).codex/**'
  ]).split('\0').filter(Boolean);
  const findings = scanRepositorySecretCanaries(readTrackedSecretScanEntries(repo, candidatePaths));
  gates.push({
    id: 'tracked-secret-canary',
    status: findings.length ? 'failed' : 'passed',
    detail: findings.length ? findings : `No high-confidence credential canary found in ${candidatePaths.length} candidate files.`
  });

  const leaseMigration = readFileSync(path.join(repo, 'supabase/migrations/20260713003000_launch_safety_reports_lifecycle.sql'), 'utf8');
  const completionHardeningMigration = readFileSync(path.join(repo, 'supabase/migrations/20260713020000_backend_completion_hardening.sql'), 'utf8');
  const operatorAuthorityMigration = readFileSync(path.join(repo, 'supabase/migrations/20260712233000_hosted_operator_publication_authority.sql'), 'utf8');
  const authorityCompletionMigration = readFileSync(path.join(repo, 'supabase/migrations/20260713050000_submission_authority_completion.sql'), 'utf8');
  const operatorReadMigration = readFileSync(path.join(repo, 'supabase/migrations/20260713060000_operator_submission_read_plane.sql'), 'utf8');
  const launchReadinessMigration = readFileSync(path.join(repo, 'supabase/migrations/20260714010000_atomic_report_enforcement.sql'), 'utf8');
  const providerDeferralMigration = readFileSync(path.join(repo, 'supabase/migrations/20260714030000_github_provider_rate_limit_deferral.sql'), 'utf8');
  const reportAuthorizationMigration = readFileSync(path.join(repo, 'supabase/migrations/20260714050000_report_authorization_enforcement.sql'), 'utf8');
  const operatorDualControlMigration = readFileSync(path.join(repo, 'supabase/migrations/20260714060000_operator_dual_control.sql'), 'utf8');
  const evidenceAuthorityMigration = readFileSync(path.join(repo, 'supabase/migrations/20260715010000_hosted_evidence_version_authority.sql'), 'utf8');
  const reportIdempotencyMigration = readFileSync(path.join(repo, 'supabase/migrations/20260715020000_hosted_report_idempotency_recovery.sql'), 'utf8');
  const workerSource = readFileSync(path.join(repo, 'apps/worker/src/process-once.mjs'), 'utf8');
  const providerGateSource = readFileSync(path.join(repo, 'apps/worker/src/github-provider-gate.mjs'), 'utf8');
  const githubFetcherSource = readFileSync(path.join(repo, 'src/network/github-source-fetcher.ts'), 'utf8');
  const authorizationSource = readFileSync(path.join(repo, 'apps/worker/src/authorization.mjs'), 'utf8');
  const collisionReviewSource = readFileSync(path.join(repo, 'apps/worker/src/collision-review.mjs'), 'utf8');
  const publicationSource = readFileSync(path.join(repo, 'apps/worker/src/publish-once.mjs'), 'utf8');
  const lifecycleSource = readFileSync(path.join(repo, 'apps/worker/src/lifecycle.mjs'), 'utf8');
  const operatorDualControlSource = readFileSync(path.join(repo, 'apps/worker/src/operator-dual-control.mjs'), 'utf8');
  const submissionQueueSource = readFileSync(path.join(repo, 'apps/worker/src/submission-queue.mjs'), 'utf8');
  const submissionDetailSource = readFileSync(path.join(repo, 'apps/worker/src/submission-detail.mjs'), 'utf8');
  const reportDispositionSource = readFileSync(path.join(repo, 'apps/worker/src/report-disposition.mjs'), 'utf8');
  const reportQueueSource = readFileSync(path.join(repo, 'apps/worker/src/report-queue.mjs'), 'utf8');
  const operationsSource = readFileSync(path.join(repo, 'apps/worker/src/operations-check.mjs'), 'utf8');
  const healthRouteSource = readFileSync(path.join(repo, 'apps/web/app/api/v1/health/route.ts'), 'utf8');
  const rpcSource = readFileSync(path.join(repo, 'apps/worker/src/supabase-rpc.mjs'), 'utf8');
  const workerMigrationBound = /create function api\.renew_skill_submission_claim\s*\(/i.test(leaseMigration)
    && /grant execute on function api\.renew_skill_submission_claim\(text, uuid, text, integer\) to service_role/i.test(leaseMigration)
    && /renewClaimLease\(/.test(workerSource)
    && /'renew_skill_submission_claim'/.test(rpcSource)
    && /create function api\.dead_letter_expired_skill_submission\s*\(/i.test(completionHardeningMigration)
    && /create function api\.list_skill_submission_collisions\s*\(/i.test(completionHardeningMigration)
    && /create function api\.review_skill_submission_collisions\s*\(/i.test(completionHardeningMigration)
    && /grant execute on function api\.dead_letter_expired_skill_submission\(text, text\) to service_role/i.test(completionHardeningMigration)
    && /grant execute on function api\.list_skill_submission_collisions\(text\) to service_role/i.test(completionHardeningMigration)
    && /grant execute on function api\.review_skill_submission_collisions\(text, text, text, text\) to service_role/i.test(completionHardeningMigration)
    && /drop function api\.review_skill_submission_collisions\(text, text, text, text\)/i.test(authorityCompletionMigration)
    && /create function api\.review_skill_submission_collisions\s*\([\s\S]+p_target_publisher_id text[\s\S]+p_target_skill_id text[\s\S]+p_target_version_id text/i.test(authorityCompletionMigration)
    && /grant execute on function api\.review_skill_submission_collisions\(\s*text, text, text, text, text, text, text\s*\) to service_role/i.test(authorityCompletionMigration)
    && /create function api\.record_skill_submission_license_evidence\s*\(/i.test(authorityCompletionMigration)
    && /grant execute on function api\.record_skill_submission_license_evidence\(\s*text, uuid, text, text, text, jsonb, text, text, text\s*\) to service_role/i.test(authorityCompletionMigration)
    && /create function api\.record_skill_submission_publisher_authorization\s*\(/i.test(authorityCompletionMigration)
    && /grant execute on function api\.record_skill_submission_publisher_authorization\(\s*text, text, text, text, text, text, timestamptz, text\s*\) to service_role/i.test(authorityCompletionMigration)
    && /create function private\.version_has_current_publisher_authorization\(version_uuid uuid\)/i.test(authorityCompletionMigration)
    && /receipt\.expires_at > clock_timestamp\(\)/i.test(authorityCompletionMigration)
    && /create function private\.collision_subject_is_complete\(value jsonb\)/i.test(authorityCompletionMigration)
    && /total_matches <> jsonb_array_length\(evidence_value -> 'matches'\)/i.test(authorityCompletionMigration)
    && /partial collision evidence cannot authorize publication/i.test(authorityCompletionMigration)
    && /publication requires complete untruncated collision evidence/i.test(authorityCompletionMigration)
    && /published authorization renewal must match the exact source publisher version/i.test(authorityCompletionMigration)
    && /published authorization renewal requires an active non-revoked exact source version/i.test(authorityCompletionMigration)
    && /create table private\.publisher_authorization_revocation_tombstones/i.test(authorityCompletionMigration)
    && /unique \(repository_url, source_commit, source_path\)/i.test(authorityCompletionMigration)
    && /create function private\.lock_exact_source_authority/i.test(authorityCompletionMigration)
    && /pg_advisory_xact_lock/i.test(authorityCompletionMigration)
    && /publisher authorization revocation is terminal for the exact source/i.test(authorityCompletionMigration)
    && /prior_row\.expires_at <= clock_timestamp\(\)/i.test(authorityCompletionMigration)
    && /authorization_row\.expires_at <= clock_timestamp\(\)/i.test(authorityCompletionMigration)
    && /jsonb_typeof\(item -> 'repositoryUrl'\) is distinct from 'string'/i.test(authorityCompletionMigration)
    && /jsonb_typeof\(item -> 'sourceCommit'\) is distinct from 'string'/i.test(authorityCompletionMigration)
    && /jsonb_typeof\(item -> 'path'\) is distinct from 'string'/i.test(authorityCompletionMigration)
    && /jsonb_typeof\(item -> 'contentDigest'\) is distinct from 'string'/i.test(authorityCompletionMigration)
    && /valid_submission_audit_receipt\(p_audit_receipt, p_worker_version\) is not true/i.test(operatorAuthorityMigration)
    && /valid_submission_grade_receipt\(p_grade_receipt, p_audit_receipt\) is not true/i.test(operatorAuthorityMigration)
    && /jsonb_typeof\(check_row -> 'outcome'\) is distinct from 'string'/i.test(operatorAuthorityMigration)
    && /jsonb_typeof\(check_row -> 'severity'\) is distinct from 'string'/i.test(operatorAuthorityMigration)
    && /jsonb_typeof\(gate_row -> 'evidenceDigest'\) = 'null'[\s\S]+sha256:/i.test(operatorAuthorityMigration)
    && /perform private\.lock_exact_source_authority\([\s\S]+if submission_row\.state = 'published'/i.test(operatorAuthorityMigration)
    && /publication replay no longer has current exact-source authority/i.test(operatorAuthorityMigration)
    && /skill_row\.current_version_id is distinct from version_row\.id/i.test(operatorAuthorityMigration)
    && /skill_row\.visibility_state <> 'public'[\s\S]+skill_row\.lifecycle_state not in \('published', 'deprecated'\)[\s\S]+skill_row\.revoked_at is not null/i.test(operatorAuthorityMigration)
    && /publisher_row\.catalog_state <> 'published'[\s\S]+publisher_row\.revoked_at is not null/i.test(operatorAuthorityMigration)
    && /repository_row\.catalog_state <> 'published'[\s\S]+repository_row\.revoked_at is not null/i.test(operatorAuthorityMigration)
    && /version_row\.source_commit is distinct from submission_row\.source_commit[\s\S]+version_row\.source_path is distinct from submission_row\.source_path/i.test(operatorAuthorityMigration)
    && /set publication_state = 'blocked'[\s\S]+revoked_at = coalesce/i.test(authorityCompletionMigration)
    && /rpc\.call\('record_skill_submission_license_evidence'/.test(workerSource)
    && /businessRpc: 'record_skill_submission_publisher_authorization'/.test(authorizationSource)
    && /create function api\.get_skill_submission_queue_summary\(\)/i.test(operatorReadMigration)
    && /create function api\.list_skill_submission_operator_queue\s*\(/i.test(operatorReadMigration)
    && /create function api\.get_skill_submission_operator_detail\s*\(/i.test(operatorReadMigration)
    && /p_after_updated_at timestamptz/i.test(operatorReadMigration)
    && /p_limit is null or p_limit not between 1 and 32/i.test(operatorReadMigration)
    && /order by submission\.updated_at, submission\.public_id/i.test(operatorReadMigration)
    && /create index skill_submissions_operator_queue_idx[\s\S]+state, updated_at, public_id/i.test(operatorReadMigration)
    && /grant execute on function api\.get_skill_submission_queue_summary\(\) to service_role/i.test(operatorReadMigration)
    && /grant execute on function api\.list_skill_submission_operator_queue\(text, integer, timestamptz, text\)\s+to service_role/i.test(operatorReadMigration)
    && /grant execute on function api\.get_skill_submission_operator_detail\(text\) to service_role/i.test(operatorReadMigration)
    && /\bsubmitter_user_id\b/i.test(operatorReadMigration) === false
    && /private_?evidence_?digest/i.test(operatorReadMigration) === false
    && /create function api\.disposition_skill_report\s*\([\s\S]+p_lifecycle_action text[\s\S]+p_idempotency_digest text/i.test(launchReadinessMigration)
    && /p_disposition_code = 'confirmed'[\s\S]+p_lifecycle_action is null[\s\S]+quarantine-version[\s\S]+revoke-version/i.test(launchReadinessMigration)
    && /update private\.skill_versions[\s\S]+quarantined_at = coalesce/i.test(launchReadinessMigration)
    && /update private\.skill_versions[\s\S]+revoked_at = coalesce/i.test(launchReadinessMigration)
    && /'sourceReportId', report_row\.public_id/i.test(launchReadinessMigration)
    && /create function api\.list_skill_report_queue\s*\([\s\S]+p_after_created_at timestamptz[\s\S]+p_after_report_id text/i.test(launchReadinessMigration)
    && /\(report\.created_at, report\.public_id\) > \(p_after_created_at, p_after_report_id\)/i.test(launchReadinessMigration)
    && /create or replace function private\.enforce_skill_report_insert\s*\(\)/i.test(reportAuthorizationMigration)
    && /private\.version_has_current_publisher_authorization\(version\.id\)/i.test(reportAuthorizationMigration)
    && /create function api\.approve_operator_action\s*\(/i.test(operatorDualControlMigration)
    && /x-skillmap-operator-credential/i.test(operatorDualControlMigration)
    && /x-skillmap-operator-approval/i.test(operatorDualControlMigration)
    && /operator approver and executor must be distinct/i.test(operatorDualControlMigration)
    && /'submission\.publisher-authorization'[\s\S]+'submission\.collision-review'[\s\S]+'submission\.publish'[\s\S]+'catalog\.lifecycle'[\s\S]+'report\.disposition'/i.test(operatorDualControlMigration)
    && /create function private\.supported_submission_evidence_authority\s*\(/i.test(evidenceAuthorityMigration)
    && /skillmap-worker\/0\.2\.0[\s\S]+skillmap-static-audit\/v2[\s\S]+skillmap-grader\/0\.1\.0/i.test(evidenceAuthorityMigration)
    && /create function private\.assert_current_submission_evidence_authority\s*\(/i.test(evidenceAuthorityMigration)
    && /perform private\.assert_current_submission_evidence_authority\(p_submission_id\)/i.test(evidenceAuthorityMigration)
    && /create or replace view api\.my_skill_reports/i.test(reportIdempotencyMigration)
    && /idempotency_key/i.test(reportIdempotencyMigration)
    && /grant select \(idempotency_key\) on api\.skill_reports to authenticated/i.test(reportIdempotencyMigration)
    && /runDualControlledOperatorAction/.test(operatorDualControlSource)
    && /rpc\.call\('approve_operator_action'/.test(operatorDualControlSource)
    && /Exactly one of --approve or --execute/.test(operatorDualControlSource)
    && /x-skillmap-operator-credential/.test(rpcSource)
    && /x-skillmap-operator-approval/.test(rpcSource)
    && /businessRpc: 'review_skill_submission_collisions'/.test(collisionReviewSource)
    && /businessRpc: 'publish_skill_submission'/.test(publicationSource)
    && /operationId: options\.operationId/.test(publicationSource)
    && /businessRpc: 'control_catalog_lifecycle'/.test(lifecycleSource)
    && /businessRpc: 'disposition_skill_report'/.test(reportDispositionSource)
    && /create function api\.peek_skill_submission_candidate\s*\(/i.test(providerDeferralMigration)
    && /create function api\.defer_skill_submission_provider_limit\s*\(/i.test(providerDeferralMigration)
    && /provider_retry_after_at is null[\s\S]+provider_retry_after_at <= clock_timestamp\(\)/i.test(providerDeferralMigration)
    && /attempt_count = submission\.attempt_count - 1/i.test(providerDeferralMigration)
    && /grant execute on function api\.peek_skill_submission_candidate\(text\) to service_role/i.test(providerDeferralMigration)
    && /grant execute on function api\.defer_skill_submission_provider_limit\(text, uuid, text, integer, text\)[\s\S]+to service_role/i.test(providerDeferralMigration)
    && /prepareGithubBudgetedClaim/.test(workerSource)
    && /isGithubProviderRateLimitError\(error\)/.test(workerSource)
    && /deferGithubRateLimitedClaim/.test(workerSource)
    && /CORE_REQUEST_RESERVE = 2/.test(providerGateSource)
    && /requiredCoreRequests > status\.limit/.test(providerGateSource)
    && /result: 'provider-deferred'[\s\S]+mutation: false[\s\S]+github-rate-inspection/.test(providerGateSource)
    && /secondary rate limits/.test(githubFetcherSource)
    && /rpc\.call\('get_skill_submission_queue_summary'/.test(submissionQueueSource)
    && /rpc\.call\('list_skill_submission_operator_queue'/.test(submissionQueueSource)
    && /p_after_updated_at: options\.afterUpdatedAt/.test(submissionQueueSource)
    && /best-effort-live-by-updated-at-restart-required/.test(submissionQueueSource)
    && /reconciliationRequired: true/.test(submissionQueueSource)
    && /MAX_QUEUE_ROWS = 32/.test(submissionQueueSource)
    && /rpc\.call\('get_skill_submission_operator_detail'/.test(submissionDetailSource)
    && /p_lifecycle_action: options\.lifecycleAction/.test(reportDispositionSource)
    && /runReportQueue/.test(reportQueueSource)
    && /best-effort-live-by-created-at-restart-required/.test(reportQueueSource)
    && /runSubmissionQueue/.test(operationsSource)
    && /runReportQueue/.test(operationsSource)
    && /skillmap-hosted-operations-check\/v1/.test(operationsSource)
    && /"Cache-Control": "no-store, max-age=0"/.test(healthRouteSource)
    && /health\.status === "ready" \? 200 : 503/.test(healthRouteSource)
    && /'get_skill_submission_queue_summary'/.test(rpcSource)
    && /'list_skill_submission_operator_queue'/.test(rpcSource)
    && /'get_skill_submission_operator_detail'/.test(rpcSource)
    && /'dead_letter_expired_skill_submission'/.test(rpcSource)
    && /'list_skill_submission_collisions'/.test(rpcSource)
    && /'review_skill_submission_collisions'/.test(rpcSource)
    && /'record_skill_submission_license_evidence'/.test(rpcSource)
    && /'record_skill_submission_publisher_authorization'/.test(rpcSource)
    && /'peek_skill_submission_candidate'/.test(rpcSource)
    && /'defer_skill_submission_provider_limit'/.test(rpcSource);
  gates.push({
    id: 'worker-migration-compatibility',
    status: workerMigrationBound ? 'passed' : 'failed',
    detail: workerMigrationBound
      ? 'Worker mutation authority, atomic report enforcement, current-authorization report intake, consequential-action dual control, cursor-safe operator queues, provider backpressure deferral, exact evidence-version authority, owner-safe report request recovery, and the redacted operations plane are source-bound through migration 20260715020000; applying and verifying every migration remains a database gate before worker start.'
      : 'Worker mutation authority or the redacted operator read plane is not bound to every required migration, RPC, service-role grant, and privacy exclusion.'
  });

  const diffCheck = run('git', ['diff', '--check']);
  gates.push({
    id: 'patch-whitespace',
    status: diffCheck.status === 0 ? 'passed' : 'failed',
    detail: diffCheck.status === 0 ? 'git diff --check passed.' : 'git diff --check failed.'
  });
  return gates;
}

const CANDIDATE_COMMANDS = Object.freeze([
  ['root-typecheck', 'npm', ['run', 'typecheck']],
  ['root-tests', 'npm', ['test']],
  ['contract-generation', 'npm', ['run', 'test:contracts']],
  ['web-check', 'npm', ['run', 'check:web']],
  ['root-production-audit', 'npm', ['audit', '--omit=dev', '--audit-level=high']],
  ['web-production-audit', 'npm', ['--prefix', 'apps/web', 'audit', '--omit=dev', '--audit-level=high']],
  ['release-path', 'npm', ['run', 'test:release-path']],
  ['consumer-install', 'npm', ['run', 'test:consumer-install']],
  ['package-dry-run', 'npm', ['pack', '--dry-run']]
]);

function main(argv) {
  const options = parsePreflightArguments(argv);
  const candidate = {
    commit: gitText(['rev-parse', 'HEAD']),
    tree: gitText(['rev-parse', 'HEAD^{tree}']),
    branch: gitText(['branch', '--show-current']) || null,
    packageVersion: JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version,
    exactWorktree: gitText(['status', '--porcelain=v1', '--untracked-files=all']) === ''
  };
  const gates = staticGates(options.requireClean);
  if (options.profile === 'candidate' && !gates.some(gate => gate.status !== 'passed')) {
    for (const [id, command, args] of CANDIDATE_COMMANDS) {
      process.stderr.write(`[public-alpha-preflight] ${id}\n`);
      const result = run(command, args, { visible: true });
      gates.push({ id, status: result.status === 0 ? 'passed' : 'failed', detail: `${command} ${args.join(' ')} exited ${result.status ?? 1}.` });
      if (result.status !== 0) break;
    }
  } else if (options.profile === 'candidate') {
    gates.push({ id: 'candidate-command-suite', status: 'blocked', detail: 'Candidate commands did not run because a static gate did not pass.' });
  }
  const receipt = buildReleaseReceipt({ candidate, gates, profile: options.profile });
  const output = options.output ? writeExclusiveReceipt(options.output, receipt) : null;
  process.stdout.write(`${JSON.stringify({ ...receipt, ...(output ? { receipt: output } : {}) })}\n`);
  process.exitCode = receipt.localVerdict === 'passed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
