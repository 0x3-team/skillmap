begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

select plan(55);

select has_table('api', 'skill_submissions', 'the exposed submission intent table exists');
select has_view('api', 'my_skill_submissions', 'the owner-safe submission projection exists');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname, c.relname) in (
      ('api', 'skill_submissions'),
      ('private', 'submission_events'),
      ('private', 'skill_audit_receipts'),
      ('private', 'skill_grade_receipts'),
      ('private', 'review_cases'),
      ('private', 'worker_runs')
    ) and c.relrowsecurity and c.relforcerowsecurity),
  6::bigint,
  'every Batch 1 table enables and forces RLS'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'api' and c.relname = 'my_skill_submissions'
      and c.reloptions @> array['security_invoker=true', 'security_barrier=true']),
  1::bigint,
  'the owner projection is security-invoker and security-barrier'
);

select ok(not has_table_privilege('anon', 'api.skill_submissions', 'select'), 'anonymous users cannot read submission rows');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'public_id', 'select'), 'owners can select the public submission identity');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'submitter_user_id', 'select'), 'account identifiers are not selectable through PostgREST');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'repository_url', 'insert'), 'authenticated users can insert a source coordinate');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'state', 'insert'), 'browser users cannot insert workflow state');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'state', 'update'), 'browser users receive only the state update needed for withdrawal');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'repository_url', 'update'), 'browser users cannot update immutable source coordinates');
select ok(not has_table_privilege('service_role', 'api.skill_submissions', 'select'), 'service role has no direct submission-table read grant');
select ok(has_function_privilege('service_role', 'api.claim_skill_submission(text,text,integer)', 'execute'), 'service role can execute only the narrow claim RPC');
select ok(not has_function_privilege('authenticated', 'api.claim_skill_submission(text,text,integer)', 'execute'), 'authenticated users cannot execute the claim RPC');
select ok(not has_table_privilege('authenticated', 'private.skill_audit_receipts', 'select'), 'browser roles cannot read private audit receipts');
select ok(not has_table_privilege('service_role', 'private.skill_audit_receipts', 'select'), 'service role receives no direct private receipt grant');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'api' and table_name = 'my_skill_submissions'
      and column_name = 'submitter_user_id'),
  0::bigint,
  'the owner view omits the account identifier'
);
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'api' and table_name = 'my_skill_submissions'
      and column_name in ('active_claim_id', 'current_worker_version', 'claim_expires_at')),
  0::bigint,
  'the owner view omits worker claim authority'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);

select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/example-repository',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'skills/example/SKILL.md', '1.0.0', 'MIT',
      '11111111-1111-4111-8111-111111111111', 'public-alpha-draft/v1', true, true
    )$$,
  'user A can queue an exact immutable source'
);
select is((select count(*) from api.my_skill_submissions), 1::bigint, 'user A sees exactly their queued submission');

reset role;
select is((select count(*) from private.submission_events), 1::bigint, 'queue insertion emits one append-only event');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/example-repository',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'skills/example/SKILL.md', '1.0.0', 'MIT',
      '22222222-2222-4222-8222-222222222222', 'public-alpha-draft/v1', true, true
    )$$,
  23505,
  null,
  'the same owner and immutable source tuple is deterministic and cannot duplicate'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key, state,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/forged-state',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'SKILL.md', '1.0.0', 'MIT',
      '33333333-3333-4333-8333-333333333333', 'processing', 'public-alpha-draft/v1', true, true
    )$$,
  42501,
  null,
  'a browser user cannot forge processing state on insert'
);
select throws_ok(
  $$update api.skill_submissions
    set repository_url = 'https://github.com/example-owner/rewritten'
    where source_commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$$,
  42501,
  null,
  'a browser user cannot rewrite source coordinates'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/double-slash',
      'cccccccccccccccccccccccccccccccccccccccc',
      'skills//example/SKILL.md', '1.0.0',
      '55555555-5555-4555-8555-555555555555', 'public-alpha-draft/v1', true, true
    )$$,
  22023,
  null,
  'submission paths reject empty double-slash segments'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/dot-segment',
      'dddddddddddddddddddddddddddddddddddddddd',
      'skills/./example/SKILL.md', '1.0.0',
      '66666666-6666-4666-8666-666666666666', 'public-alpha-draft/v1', true, true
    )$$,
  22023,
  null,
  'submission paths reject dot segments'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/control-label',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'SKILL.md', E'1.0.0\nforged',
      '77777777-7777-4777-8777-777777777777', 'public-alpha-draft/v1', true, true
    )$$,
  22023,
  null,
  'version labels reject control characters'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/Example-Owner/Example-Repository',
      'ffffffffffffffffffffffffffffffffffffffff',
      'SKILL.md', '1.0.0',
      '99999999-9999-4999-8999-999999999999', 'public-alpha-draft/v1', true, true
    )$$,
  22023,
  null,
  'GitHub repository identity must use canonical lowercase coordinates'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select is((select count(*) from api.my_skill_submissions), 0::bigint, 'user B cannot read user A submission');
select is_empty(
  $$update api.skill_submissions set state = 'withdrawn'
    where repository_url = 'https://github.com/example-owner/example-repository'
    returning 1$$,
  'user B cannot withdraw user A submission'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select results_eq(
  $$update api.skill_submissions set state = 'withdrawn'
    where repository_url = 'https://github.com/example-owner/example-repository'
    returning 1$$,
  $$values (1)$$,
  'user A can withdraw only their queued submission'
);
select is((select state from api.my_skill_submissions limit 1), 'withdrawn', 'the owner projection reports the truthful withdrawn state');

reset role;
select is((select count(*) from private.submission_events), 2::bigint, 'withdrawal appends a second state event');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/second-repository',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'SKILL.md', '2.0.0', null,
      '44444444-4444-4444-8444-444444444444', 'public-alpha-draft/v1', true, true
    )$$,
  'a second immutable source can be queued independently'
);
select throws_ok(
  $$select * from api.claim_skill_submission('skillmap-worker/0.1.0', null, 300)$$,
  42501,
  null,
  'an authenticated browser user cannot claim queued work'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select count(*) from api.claim_skill_submission('skillmap-worker/0.1.0', null, 300)),
  1::bigint,
  'the service role can atomically claim one queued submission'
);

reset role;
select is(
  (select state from api.skill_submissions
    where repository_url = 'https://github.com/example-owner/second-repository'),
  'processing',
  'claim transitions exactly one queued submission to processing'
);
select is(
  (select attempt_count from api.skill_submissions
    where repository_url = 'https://github.com/example-owner/second-repository'),
  1,
  'claim records the first bounded attempt'
);
select is((select count(*) from private.submission_events), 4::bigint, 'second queue and claim each append an event');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select * from api.claim_skill_submission('skillmap-worker/0.1.0', null, 1)$$,
  22023,
  null,
  'the claim RPC rejects an unsafe lease duration'
);

reset role;
select lives_ok(
  $$insert into private.skill_audit_receipts (
      submission_id, state, receipt_digest, source_content_digest, normalized_content_digest,
      policy_version, host_profile_version, worker_version, finding_counts, public_checks,
      reason_codes, private_evidence_digest
    ) select
      id, 'warnings',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'static-audit/v1', 'codex/v1', 'skillmap-worker/0.1.0',
      '{"critical":0,"high":0,"medium":1,"low":0,"info":0}'::jsonb,
      '[{"code":"frontmatter-valid","outcome":"passed","severity":"info","evidenceDigest":null}]'::jsonb,
      array['broad-trigger-language'],
      'sha256:4444444444444444444444444444444444444444444444444444444444444444'
    from api.skill_submissions
    where repository_url = 'https://github.com/example-owner/second-repository'$$,
  'a trusted database authority can append a bounded audit receipt'
);
select throws_ok(
  $$update private.skill_audit_receipts set state = 'passed'$$,
  55000,
  null,
  'audit receipts are append-only'
);
select throws_ok(
  $$insert into private.skill_grade_receipts (
      submission_id, audit_receipt_id, state, band, total_score, confidence,
      receipt_digest, normalized_content_digest, audit_receipt_digest,
      compatibility_evidence_digest, evaluation_suite_digest, rubric_version,
      host_profile_version, evaluator_version, hard_gates, dimensions, reason_codes
    ) select
      audit.submission_id, audit.id, 'current', null, 88, 0.9,
      'sha256:5555555555555555555555555555555555555555555555555555555555555555',
      audit.normalized_content_digest, audit.receipt_digest,
      'sha256:6666666666666666666666666666666666666666666666666666666666666666',
      'sha256:7777777777777777777777777777777777777777777777777777777777777777',
      'skillmap-rubric/v1', 'codex/v1', 'skillmap-grader/0.1.0',
      '[{"code":"source-identity","passed":true}]'::jsonb,
      '[{"code":"instruction-quality","weight":1,"score":88}]'::jsonb,
      array['fabricated-current-grade']
    from private.skill_audit_receipts audit$$,
  23514,
  null,
  'Batch 1 structurally rejects current grade promotion'
);
select lives_ok(
  $$insert into private.skill_grade_receipts (
      submission_id, audit_receipt_id, state, band, total_score, confidence,
      receipt_digest, normalized_content_digest, audit_receipt_digest,
      compatibility_evidence_digest, evaluation_suite_digest, rubric_version,
      host_profile_version, evaluator_version, hard_gates, dimensions, reason_codes
    ) select
      audit.submission_id, audit.id, 'provisional', null, 78, 0.62,
      'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      audit.normalized_content_digest, audit.receipt_digest,
      'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'skillmap-rubric/v1', 'codex/v1', 'skillmap-grader/0.1.0',
      '[{"code":"source-identity","passed":true}]'::jsonb,
      '[{"code":"instruction-quality","weight":1,"score":78}]'::jsonb,
      array['behavioral-evidence-incomplete']
    from private.skill_audit_receipts audit$$,
  'a provisional grade receipt can be appended without a letter band'
);
select throws_ok(
  $$insert into private.skill_grade_receipts (
      submission_id, audit_receipt_id, state, band, total_score, confidence,
      receipt_digest, normalized_content_digest, audit_receipt_digest,
      compatibility_evidence_digest, evaluation_suite_digest, rubric_version,
      host_profile_version, evaluator_version, hard_gates, dimensions, reason_codes
    ) select
      audit.submission_id, audit.id, 'provisional', null, 78, 0.62,
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      audit.receipt_digest,
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'skillmap-rubric/v1', 'codex/v1', 'skillmap-grader/0.1.0',
      '[{"code":"source-identity","passed":true}]'::jsonb,
      '[{"code":"instruction-quality","weight":1,"score":78}]'::jsonb,
      array['behavioral-evidence-incomplete']
    from private.skill_audit_receipts audit
    limit 1$$,
  23514,
  null,
  'grade receipts must bind the exact normalized audit subject digest'
);
select throws_ok(
  $$delete from private.skill_grade_receipts$$,
  55000,
  null,
  'grade receipts are append-only'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/example-owner/second-repository',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'SKILL.md', '2.0.0', null,
      '88888888-8888-4888-8888-888888888888', 'public-alpha-draft/v1', true, true
    )$$,
  'a second account may submit the same exact public source without digest collision'
);

reset role;
select lives_ok(
  $$insert into private.skill_audit_receipts (
      submission_id, state, receipt_digest, source_content_digest, normalized_content_digest,
      policy_version, host_profile_version, worker_version, finding_counts, public_checks,
      reason_codes, private_evidence_digest
    ) select
      id, 'warnings',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'static-audit/v1', 'codex/v1', 'skillmap-worker/0.1.0',
      '{"critical":0,"high":0,"medium":1,"low":0,"info":0}'::jsonb,
      '[{"code":"frontmatter-valid","outcome":"passed","severity":"info","evidenceDigest":null}]'::jsonb,
      array['broad-trigger-language'],
      'sha256:4444444444444444444444444444444444444444444444444444444444444444'
    from api.skill_submissions
    where submitter_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$$,
  'receipt digest uniqueness is scoped to the submission rather than globally'
);
select is(
  (select count(*) from private.skill_audit_receipts
    where receipt_digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
  2::bigint,
  'two independent submissions may bind the same deterministic audit receipt bytes'
);
select lives_ok(
  $$delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$$,
  'account deletion cascades the owned submission and its private ledger rows'
);
select is(
  (select count(*) from api.skill_submissions
    where submitter_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  0::bigint,
  'deleted accounts retain no owned submission row'
);
select is(
  (select count(*)
    from private.submission_events event
    left join api.skill_submissions submission on submission.id = event.submission_id
    where submission.id is null),
  0::bigint,
  'account deletion leaves no orphan submission events'
);
select is(
  (select count(*) from pg_trigger
    where tgname in (
      'submission_events_append_only', 'skill_audit_receipts_append_only',
      'skill_grade_receipts_append_only', 'review_cases_append_only',
      'worker_runs_append_only'
    ) and not tgisinternal),
  5::bigint,
  'all five private authority ledgers have append-only triggers'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef),
  12::bigint,
  'the exposed API contains exactly twelve reviewed security-definer RPCs'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef and p.proname in (
      'claim_skill_submission', 'complete_skill_submission', 'requeue_skill_submission',
      'dead_letter_expired_skill_submission',
      'publish_skill_submission', 'delete_my_account', 'disposition_skill_report',
      'control_catalog_lifecycle', 'renew_skill_submission_claim', 'list_skill_report_queue',
      'list_skill_submission_collisions', 'review_skill_submission_collisions'
    )),
  12::bigint,
  'the reviewed allowlist names every exposed security-definer RPC'
);

select * from finish();
rollback;
