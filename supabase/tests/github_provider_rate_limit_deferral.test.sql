begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(42);

select has_column('api', 'skill_submissions', 'provider_retry_after_at', 'provider retry timing is retained');
select has_column('api', 'skill_submissions', 'provider_defer_count', 'provider deferrals have separate telemetry');
select ok(has_function_privilege('service_role', 'api.peek_skill_submission_candidate(text)', 'execute'), 'service role can peek one exact candidate');
select ok(has_function_privilege('service_role', 'api.defer_skill_submission_provider_limit(text,uuid,text,integer,text)', 'execute'), 'service role can defer one exact claim');
select ok(not has_function_privilege('authenticated', 'api.peek_skill_submission_candidate(text)', 'execute'), 'browser users cannot peek the worker queue');
select ok(not has_function_privilege('authenticated', 'api.defer_skill_submission_provider_limit(text,uuid,text,integer,text)', 'execute'), 'browser users cannot defer worker claims');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'provider_retry_after_at', 'select'), 'browser users cannot read provider timing internals');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'provider_retry_after_at', 'update'), 'browser users cannot update provider timing internals');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  'authenticated', 'authenticated', 'provider-gate@skillmap.invalid', '', clock_timestamp(),
  '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp(), '', '', '', ''
);

insert into api.skill_submissions (
  submitter_user_id, repository_url, source_commit, source_path, version_label,
  idempotency_key, authority_confirmed, untrusted_processing_accepted, created_at,
  attempt_count, provider_retry_after_at, provider_defer_count
) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/cooldown', repeat('1', 40), 'skills/cooldown/SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000001', true, true, '2026-07-14T01:00:00Z', 0, null, 0),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/eligible', repeat('2', 40), 'SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000002', true, true, '2026-07-14T01:01:00Z', 0, clock_timestamp() - interval '1 minute', 1),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/evidence', repeat('3', 40), 'SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000003', true, true, '2026-07-14T01:02:00Z', 0, null, 0),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/stale', repeat('4', 40), 'SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000004', true, true, '2026-07-14T01:03:00Z', 0, null, 0),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/expired-current', repeat('5', 40), 'SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000005', true, true, '2026-07-14T01:04:00Z', 0, null, 0),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://github.com/provider-owner/high-count', repeat('6', 40), 'SKILL.md', '1.0.0', '10000000-0000-4000-8000-000000000006', true, true, '2026-07-14T01:05:00Z', 4, null, 10000);

select public_id as cooldown_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/cooldown' \gset
select public_id as eligible_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/eligible' \gset
select public_id as evidence_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/evidence' \gset
select public_id as stale_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/stale' \gset
select public_id as expired_current_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/expired-current' \gset
select public_id as high_submission_id from api.skill_submissions
where repository_url = 'https://github.com/provider-owner/high-count' \gset

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', true);
select throws_ok(
  $$select * from api.peek_skill_submission_candidate(null)$$,
  42501, null, 'browser authority cannot invoke the candidate peek'
);
select throws_ok(
  $$select * from api.defer_skill_submission_provider_limit(
      'sub_11111111111111111111111111111111', gen_random_uuid(),
      'skillmap-worker/0.2.0', 60, 'sha256:' || repeat('1', 64))$$,
  42501, null, 'browser authority cannot invoke provider deferral'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select submission_id from api.peek_skill_submission_candidate(:'cooldown_submission_id')),
  :'cooldown_submission_id',
  'the read-only peek returns the exact eligible candidate before claim'
);
select claim_id as cooldown_claim_id, attempt_number as cooldown_attempt
from api.claim_skill_submission('skillmap-worker/0.2.0', :'cooldown_submission_id', 300) \gset
select ok(:'cooldown_claim_id'::uuid is not null, 'the exact candidate is claimed');
select is(:'cooldown_attempt'::integer, 1, 'the first claim reserves audit attempt one');
select throws_ok(
  format($sql$select * from api.defer_skill_submission_provider_limit(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 59, 'sha256:%s')$sql$,
    :'cooldown_submission_id', :'cooldown_claim_id', repeat('1', 64)),
  22023, null, 'provider retry timing is bounded'
);
select submission_state as deferred_state, attempt_count as deferred_attempt,
  provider_retry_after_at as deferred_retry, provider_defer_count as deferred_count
from api.defer_skill_submission_provider_limit(
  :'cooldown_submission_id', :'cooldown_claim_id'::uuid,
  'skillmap-worker/0.2.0', 3600, 'sha256:' || repeat('2', 64)
) \gset
select is(:'deferred_state'::text, 'queued'::text, 'provider exhaustion returns processing to queued');
select is(:'deferred_attempt'::integer, 0, 'provider exhaustion refunds the audit attempt');
select is(:'deferred_count'::integer, 1, 'provider exhaustion increments separate telemetry');
select ok(:'deferred_retry'::timestamptz > clock_timestamp(), 'provider exhaustion retains a future retry time');

reset role;
select is((select count(*) from private.worker_runs where submission_id = (
  select id from api.skill_submissions where public_id = :'cooldown_submission_id'
)), 0::bigint, 'a refunded provider deferral does not consume a worker-run attempt');
select is((select count(*) from private.submission_events where submission_id = (
  select id from api.skill_submissions where public_id = :'cooldown_submission_id'
) and from_state = 'processing' and to_state = 'queued'), 1::bigint, 'provider deferral appends an exact state event');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.peek_skill_submission_candidate(:'cooldown_submission_id')), 0::bigint, 'peek skips a candidate during provider cooldown');
select is((select count(*) from api.claim_skill_submission('skillmap-worker/0.2.0', :'cooldown_submission_id', 300)), 0::bigint, 'claim skips a candidate during provider cooldown');
select is((select provider_defer_count from api.defer_skill_submission_provider_limit(
  :'cooldown_submission_id', :'cooldown_claim_id'::uuid,
  'skillmap-worker/0.2.0', 3600, 'sha256:' || repeat('2', 64)
)), 1, 'an exact idempotent replay does not refund twice');
reset role;
select is((select count(*) from private.submission_events where submission_id = (
  select id from api.skill_submissions where public_id = :'cooldown_submission_id'
)), 3::bigint, 'an idempotent replay does not append a second event');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  format($sql$select * from api.defer_skill_submission_provider_limit(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 3600, 'sha256:%s')$sql$,
    :'cooldown_submission_id', :'cooldown_claim_id', repeat('3', 64)),
  55000, null, 'the same stale claim with a different digest cannot mutate again'
);
select is(
  (select submission_id from api.peek_skill_submission_candidate(:'eligible_submission_id')),
  :'eligible_submission_id',
  'a past provider retry time restores exact eligibility'
);
select is((select attempt_number from api.claim_skill_submission(
  'skillmap-worker/0.2.0', :'eligible_submission_id', 300
)), 1, 'claim clears an elapsed provider retry time');

select claim_id as evidence_claim_id, attempt_number as evidence_attempt
from api.claim_skill_submission('skillmap-worker/0.2.0', :'evidence_submission_id', 300) \gset
select is(:'evidence_attempt'::integer, 1, 'the evidence fixture receives attempt one');
reset role;
select lives_ok(
  format($sql$insert into private.worker_runs (
    id, submission_id, worker_version, attempt_number, outcome, disposition_state,
    input_digest, result_digest, error_code, public_error_message, started_at, completed_at
  ) select %L::uuid, id, 'skillmap-worker/0.2.0', 1, 'failed', 'failed',
    'sha256:%s', 'sha256:%s', 'WORKER_FAILED', 'A durable test run exists.',
    claimed_at, clock_timestamp()
  from api.skill_submissions where public_id = %L$sql$,
    :'evidence_claim_id', repeat('4', 64), repeat('5', 64), :'evidence_submission_id'),
  'the evidence fixture has a durable worker run'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  format($sql$select * from api.defer_skill_submission_provider_limit(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 60, 'sha256:%s')$sql$,
    :'evidence_submission_id', :'evidence_claim_id', repeat('6', 64)),
  55000, null, 'a claim with durable audit evidence cannot be refunded'
);
reset role;
select is((select row(state, attempt_count)::text from api.skill_submissions
  where public_id = :'evidence_submission_id'), '(processing,1)', 'a rejected evidence refund leaves claim state unchanged');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as stale_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0', :'stale_submission_id', 300
) \gset
select ok(:'stale_claim_id'::uuid is not null, 'the stale-claim fixture receives its first claim');
reset role;
update api.skill_submissions
set claimed_at = clock_timestamp() - interval '10 minutes',
  claim_expires_at = clock_timestamp() - interval '1 minute'
where public_id = :'stale_submission_id';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission(
  'skillmap-worker/0.2.0', :'stale_submission_id', 300
)), 1::bigint, 'an expired exact claim can be reclaimed');
select throws_ok(
  format($sql$select * from api.defer_skill_submission_provider_limit(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 60, 'sha256:%s')$sql$,
    :'stale_submission_id', :'stale_claim_id', repeat('7', 64)),
  55000, null, 'a stale claim ID cannot refund the replacement claim'
);
reset role;
select ok((select active_claim_id <> :'stale_claim_id'::uuid from api.skill_submissions
  where public_id = :'stale_submission_id'), 'claim replacement preserves exact ownership');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as expired_current_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0', :'expired_current_submission_id', 300
) \gset
reset role;
update api.skill_submissions
set claimed_at = clock_timestamp() - interval '10 minutes',
  claim_expires_at = clock_timestamp() - interval '1 minute'
where public_id = :'expired_current_submission_id';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select submission_state from api.defer_skill_submission_provider_limit(
  :'expired_current_submission_id', :'expired_current_claim_id'::uuid,
  'skillmap-worker/0.2.0', 60, 'sha256:' || repeat('9', 64)
)), 'queued', 'an expired-but-still-current exact claim can defer safely');
reset role;
select is((select attempt_count from api.skill_submissions
  where public_id = :'expired_current_submission_id'), 0, 'expired current-claim deferral still refunds its attempt');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as high_claim_id, attempt_number as high_attempt
from api.claim_skill_submission('skillmap-worker/0.2.0', :'high_submission_id', 300) \gset
select is(:'high_attempt'::integer, 5, 'provider deferral works at the final audit-attempt boundary');
select attempt_count as high_deferred_attempt, provider_defer_count as high_deferred_count
from api.defer_skill_submission_provider_limit(
  :'high_submission_id', :'high_claim_id'::uuid,
  'skillmap-worker/0.2.0', 60, 'sha256:' || repeat('8', 64)
) \gset
select is(:'high_deferred_attempt'::integer, 4, 'attempt five refunds to four instead of dead-lettering');
select is(:'high_deferred_count'::integer, 10001, 'provider deferral telemetry remains practical beyond ten thousand outages');
reset role;
select is((select count(*) from private.worker_runs where submission_id = (
  select id from api.skill_submissions where public_id = :'high_submission_id'
)), 0::bigint, 'the final-attempt provider refund still creates no worker run');
select throws_ok(
  format($sql$update api.skill_submissions set state = 'queued' where public_id = %L$sql$,
    :'evidence_submission_id'),
  23514, null, 'processing to queued remains impossible outside the exact deferral RPC'
);

select * from finish();
rollback;
