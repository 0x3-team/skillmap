begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

select plan(39);

select has_function('api', 'get_skill_submission_queue_summary', array[]::text[],
  'operator queue summary RPC exists');
select has_function('api', 'list_skill_submission_operator_queue',
  array['text', 'integer', 'timestamp with time zone', 'text'],
  'operator queue list RPC exists');
select has_function('api', 'get_skill_submission_operator_detail', array['text'],
  'operator exact-detail RPC exists');
select has_index('api', 'skill_submissions', 'skill_submissions_operator_queue_idx',
  'operator queue has a state and update-order index');

select ok(has_function_privilege('service_role', 'api.get_skill_submission_queue_summary()', 'execute'),
  'service role can read the queue summary');
select ok(not has_function_privilege('anon', 'api.get_skill_submission_queue_summary()', 'execute'),
  'anonymous clients cannot read the queue summary');
select ok(not has_function_privilege('authenticated', 'api.get_skill_submission_queue_summary()', 'execute'),
  'authenticated clients cannot read the queue summary');
select ok(has_function_privilege('service_role',
  'api.list_skill_submission_operator_queue(text,integer,timestamp with time zone,text)', 'execute'),
  'service role can read the bounded queue');
select ok(not has_function_privilege('authenticated',
  'api.list_skill_submission_operator_queue(text,integer,timestamp with time zone,text)', 'execute'),
  'authenticated clients cannot read the bounded queue');
select ok(has_function_privilege('service_role', 'api.get_skill_submission_operator_detail(text)', 'execute'),
  'service role can read exact submission detail');
select ok(not has_function_privilege('authenticated', 'api.get_skill_submission_operator_detail(text)', 'execute'),
  'authenticated clients cannot read exact submission detail');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok(
  $$select * from api.get_skill_submission_queue_summary()$$,
  42501, null, 'authenticated callers fail closed at the summary RPC');
select throws_ok(
  $$select * from api.list_skill_submission_operator_queue(null, 20, null, null)$$,
  42501, null, 'authenticated callers fail closed at the list RPC');
select throws_ok(
  $$select * from api.get_skill_submission_operator_detail('sub_f1000000000000000000000000000001')$$,
  42501, null, 'authenticated callers fail closed at the detail RPC');
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select queued_count from api.get_skill_submission_queue_summary()), 0::bigint,
  'an empty queue still returns one zero-valued summary row');
reset role;

insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, license_claim, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted, created_at
) values
  (
    'f1000000-0000-4000-8000-000000000001', 'sub_f1000000000000000000000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/operator-owner/queue-one',
    repeat('1', 40), 'skills/one/SKILL.md', '1.0.0', 'MIT',
    'f1000000-0000-4000-8000-000000000011', 'public-alpha-draft/v1', true, true,
    '2026-07-13T20:00:00Z'
  ),
  (
    'f1000000-0000-4000-8000-000000000002', 'sub_f1000000000000000000000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/operator-owner/queue-two',
    repeat('2', 40), 'skills/two/SKILL.md', '1.0.1', null,
    'f1000000-0000-4000-8000-000000000012', 'public-alpha-draft/v1', true, true,
    '2026-07-13T20:00:00Z'
  ),
  (
    'f1000000-0000-4000-8000-000000000003', 'sub_f1000000000000000000000000000003',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'https://github.com/operator-owner/queue-three',
    repeat('3', 40), 'skills/three/SKILL.md', '2.0.0', 'Apache-2.0',
    'f1000000-0000-4000-8000-000000000013', 'public-alpha-draft/v1', true, true,
    '2026-07-13T20:01:00Z'
  ),
  (
    'f1000000-0000-4000-8000-000000000004', 'sub_f1000000000000000000000000000004',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'https://github.com/operator-owner/withdrawn',
    repeat('4', 40), 'skills/four/SKILL.md', '2.0.1', null,
    'f1000000-0000-4000-8000-000000000014', 'public-alpha-draft/v1', true, true,
    '2026-07-13T20:02:00Z'
  );

update api.skill_submissions
set state = 'processing',
  active_claim_id = 'f1000000-0000-4000-8000-000000000023',
  current_worker_version = 'skillmap-worker/0.1.0',
  attempt_count = 5,
  claimed_at = statement_timestamp() - interval '2 minutes',
  claim_expires_at = statement_timestamp() - interval '1 minute'
where id = 'f1000000-0000-4000-8000-000000000003';

update api.skill_submissions
set state = 'withdrawn', completed_at = statement_timestamp()
where id = 'f1000000-0000-4000-8000-000000000004';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is((select queued_count || ':' || processing_count || ':' || expired_processing_count
  from api.get_skill_submission_queue_summary()), '2:1:1',
  'summary counts queued, processing, and expired processing states exactly');
select is((select dead_letter_ready_count from api.get_skill_submission_queue_summary()), 1::bigint,
  'summary identifies an expired fifth attempt as dead-letter ready');
select is((select retryable_count from api.get_skill_submission_queue_summary()), 0::bigint,
  'summary does not mislabel active or terminal rows as retryable remediation');
select is((select oldest_queued_at::text from api.get_skill_submission_queue_summary()),
  '2026-07-13 20:00:00+00', 'summary retains the oldest FIFO queue timestamp');

select is((select count(*) from api.list_skill_submission_operator_queue(null, 20, null, null)),
  3::bigint, 'default operator queue excludes withdrawn terminal rows');
select is((select string_agg(submission_id, ',' order by updated_at, submission_id)
  from api.list_skill_submission_operator_queue(null, 20, null, null)),
  'sub_f1000000000000000000000000000001,sub_f1000000000000000000000000000002,sub_f1000000000000000000000000000003',
  'queue ordering is deterministic across timestamp ties');
select is((select string_agg(submission_id, ',' order by updated_at, submission_id)
  from api.list_skill_submission_operator_queue(null, 2, null, null)),
  'sub_f1000000000000000000000000000001,sub_f1000000000000000000000000000002',
  'first bounded cursor page contains only its requested rows');
select is((select string_agg(submission_id, ',' order by updated_at, submission_id)
  from api.list_skill_submission_operator_queue(
    null, 2, (select updated_at from api.list_skill_submission_operator_queue(null, 20, null, null)
      where submission_id = 'sub_f1000000000000000000000000000002'),
    'sub_f1000000000000000000000000000002'
  )), 'sub_f1000000000000000000000000000003',
  'second live update-order cursor page is non-overlapping');
select is((select count(*) from api.list_skill_submission_operator_queue('withdrawn', 20, null, null)),
  1::bigint, 'an exact terminal-state filter remains available to operators');

select throws_ok(
  $$select * from api.list_skill_submission_operator_queue('unknown', 20, null, null)$$,
  22023, 'submission queue state is invalid', 'unknown state filters fail closed');
select throws_ok(
  $$select * from api.list_skill_submission_operator_queue(null, 0, null, null)$$,
  22023, 'submission queue limit must be between 1 and 32', 'zero limit fails closed');
select throws_ok(
  $$select * from api.list_skill_submission_operator_queue(null, 33, null, null)$$,
  22023, 'submission queue limit must be between 1 and 32', 'oversized limit fails closed');
select throws_ok(
  $$select * from api.list_skill_submission_operator_queue(null, 20, statement_timestamp(), null)$$,
  22023, 'submission queue cursor is invalid', 'half a cursor fails closed');
select throws_ok(
  $$select * from api.list_skill_submission_operator_queue(null, 20, statement_timestamp(), 'bad')$$,
  22023, 'submission queue cursor is invalid', 'malformed cursor identity fails closed');

select is((select submission_state from api.get_skill_submission_operator_detail(
  'sub_f1000000000000000000000000000001')), 'queued',
  'exact detail returns the requested queued submission');
select is((select audit_receipt from api.get_skill_submission_operator_detail(
  'sub_f1000000000000000000000000000001')), null::jsonb,
  'pre-audit detail exposes an explicit null receipt');
select is((select jsonb_array_length(worker_runs) || ':' || jsonb_array_length(transition_events)
  from api.get_skill_submission_operator_detail('sub_f1000000000000000000000000000001')),
  '0:1', 'detail returns bounded empty worker history and the initial transition event');
select ok((select claim_expired and dead_letter_ready
  from api.get_skill_submission_operator_detail('sub_f1000000000000000000000000000003')),
  'detail derives expired and dead-letter-ready flags from one snapshot');
select ok((select position('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' in to_jsonb(detail)::text) = 0
    and position('phase1-a@skillmap.invalid' in to_jsonb(detail)::text) = 0
    and position('f1000000-0000-4000-8000-000000000023' in to_jsonb(detail)::text) = 0
    and position('private_evidence_digest' in to_jsonb(detail)::text) = 0
  from api.get_skill_submission_operator_detail(
    'sub_f1000000000000000000000000000003') detail),
  'detail excludes account identity, claim authority, and private evidence fields');
select ok((select pg_column_size(to_jsonb(detail)) < 262144
  from api.get_skill_submission_operator_detail(
    'sub_f1000000000000000000000000000003') detail),
  'detail remains below the client response cap for the exercised row');
select throws_ok(
  $$select * from api.get_skill_submission_operator_detail('bad')$$,
  22023, 'submission id is invalid', 'malformed exact detail identity fails closed');
select throws_ok(
  $$select * from api.get_skill_submission_operator_detail('sub_ffffffffffffffffffffffffffffffff')$$,
  'P0002', 'submission was not found', 'missing exact detail identity fails closed');

reset role;
select set_config('skillmap.read_plane_event_count',
  (select count(*)::text from private.submission_events), true);
select set_config('skillmap.read_plane_attempt_count',
  (select sum(attempt_count)::text from api.skill_submissions), true);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('skillmap.read_plane_summary_observed_at',
  (select observed_at::text from api.get_skill_submission_queue_summary()), true);
select set_config('skillmap.read_plane_list_count',
  (select count(*)::text from api.list_skill_submission_operator_queue(null, 20, null, null)), true);
select set_config('skillmap.read_plane_detail_id',
  (select submission_id from api.get_skill_submission_operator_detail(
    'sub_f1000000000000000000000000000003')), true);
reset role;
select is((select count(*) from private.submission_events),
  current_setting('skillmap.read_plane_event_count')::bigint,
  'all operator reads leave transition history unchanged');
select is((select sum(attempt_count) from api.skill_submissions),
  current_setting('skillmap.read_plane_attempt_count')::bigint,
  'all operator reads leave worker attempts unchanged');

select * from finish();
rollback;
