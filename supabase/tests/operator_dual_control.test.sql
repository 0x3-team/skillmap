begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

select plan(38);

select has_table('private', 'operator_principals', 'operator principals table exists');
select has_table('private', 'operator_action_approvals', 'immutable operator approvals table exists');
select has_table('private', 'operator_action_executions', 'immutable operator executions table exists');
select ok((
  select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname in (
      'operator_principals', 'operator_action_approvals', 'operator_action_executions'
    )
), 'all operator authority tables force RLS');
select is((select count(*) from private.operator_principals), 0::bigint,
  'migration never auto-seeds an operator credential');
select ok(not has_table_privilege('service_role', 'private.operator_principals', 'select')
  and not has_table_privilege('service_role', 'private.operator_action_approvals', 'select')
  and not has_table_privilege('service_role', 'private.operator_action_executions', 'select'),
  'service role has no direct operator authority table access');
select ok(has_function_privilege('service_role',
  'api.approve_operator_action(text,text,text,jsonb,text,uuid)', 'execute'),
  'service role can reach only the bounded approval RPC');
select ok(not has_function_privilege('authenticated',
  'api.approve_operator_action(text,text,text,jsonb,text,uuid)', 'execute'),
  'browser role cannot approve operator actions');
select ok(
  not has_function_privilege('service_role',
    'private.record_skill_submission_publisher_authorization_unchecked(text,text,text,text,text,text,timestamptz,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.review_skill_submission_collisions_unchecked(text,text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.publish_skill_submission_unchecked(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[])', 'execute')
  and not has_function_privilege('service_role',
    'private.disposition_skill_report_unchecked(text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.control_catalog_lifecycle_unchecked(text,text,text,text,text)', 'execute'),
  'service role cannot execute any relocated unchecked authority body');
select is((
  select count(*)
  from pg_proc function_row
  join pg_namespace namespace on namespace.oid = function_row.pronamespace
  where namespace.nspname = 'api'
    and function_row.proname in (
      'record_skill_submission_publisher_authorization',
      'review_skill_submission_collisions', 'publish_skill_submission',
      'disposition_skill_report', 'control_catalog_lifecycle'
    )
    and position('begin_operator_execution' in pg_get_functiondef(function_row.oid)) > 0
), 5::bigint, 'all five exposed consequential RPCs require the execution helper');
select ok(position('pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 7461))'
  in pg_get_functiondef('api.approve_operator_action(text,text,text,jsonb,text,uuid)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock(hashtextextended(p_action_digest, 7462))'
  in pg_get_functiondef('api.approve_operator_action(text,text,text,jsonb,text,uuid)'::regprocedure)) > 0,
  'approval RPC serializes operation and action replay identities in a fixed order');
select ok((
  select count(*) = 1
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'private.operator_action_approvals'::regclass
    and constraint_row.contype = 'u'
    and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (operation_id)'
), 'operation UUID is globally unique across approvers and actions');

insert into private.operator_principals (
  id, public_id, handle, authority_role, credential_digest, revoked_at
) values
  ('a1000000-0000-4000-8000-000000000001', 'opr_a1000000000000000000000000000001',
    'approver-one', 'approver', 'sha256:' || encode(extensions.digest(
      convert_to('smo_v1_' || repeat('a', 64), 'UTF8'), 'sha256'), 'hex'), null),
  ('e1000000-0000-4000-8000-000000000001', 'opr_e1000000000000000000000000000001',
    'executor-one', 'executor', 'sha256:' || encode(extensions.digest(
      convert_to('smo_v1_' || repeat('e', 64), 'UTF8'), 'sha256'), 'hex'), null),
  ('e2000000-0000-4000-8000-000000000002', 'opr_e2000000000000000000000000000002',
    'executor-two', 'executor', 'sha256:' || encode(extensions.digest(
      convert_to('smo_v1_' || repeat('f', 64), 'UTF8'), 'sha256'), 'hex'), null),
  ('a2000000-0000-4000-8000-000000000002', 'opr_a2000000000000000000000000000002',
    'revoked-approver', 'approver', 'sha256:' || encode(extensions.digest(
      convert_to('smo_v1_' || repeat('b', 64), 'UTF8'), 'sha256'), 'hex'), clock_timestamp());

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{}'::jsonb::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill-version','skv_00000000000000000000000000000001',
  '{"schemaVersion":1}'::jsonb,'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '11111111-1111-4111-8111-111111111111')$$,
  42501, 'operator credential is invalid', 'service credential alone cannot approve');
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('0', 64))::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill-version','skv_00000000000000000000000000000001',
  '{"schemaVersion":1}'::jsonb,'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '11111111-1111-4111-8111-111111111111')$$,
  42501, 'operator credential is invalid', 'forged approver credential is rejected');
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('e', 64))::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill-version','skv_00000000000000000000000000000001',
  '{"schemaVersion":1}'::jsonb,'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '11111111-1111-4111-8111-111111111111')$$,
  42501, 'operator credential is invalid', 'executor credential cannot approve');
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('b', 64))::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill-version','skv_00000000000000000000000000000001',
  '{"schemaVersion":1}'::jsonb,'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '11111111-1111-4111-8111-111111111111')$$,
  42501, 'operator credential is invalid', 'revoked approver credential is rejected');

select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('a', 64))::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill','skl_00000000000000000000000000000001',
  jsonb_build_object('schemaVersion',1,'reasonCode','smo_v1_' || repeat('a',64)),
  'sha256:1010101010101010101010101010101010101010101010101010101010101010',
  '10101010-1010-4010-8010-101010101010')$$,
  22023, 'operator approval request is invalid',
  'raw operator credential patterns cannot enter an approval payload');
select approval_id, action_digest, expires_at
from api.approve_operator_action(
  'catalog.lifecycle', 'skill-version', 'skv_00000000000000000000000000000001',
  jsonb_build_object(
    'schemaVersion', 1,
    'skillId', 'skl_00000000000000000000000000000001',
    'versionId', 'skv_00000000000000000000000000000001',
    'action', 'quarantine-version',
    'reasonCode', 'dual-control-test'
  ),
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '22222222-2222-4222-8222-222222222222'
) \gset
select matches(:'approval_id'::text, '^opa_[0-9a-f]{32}$', 'valid approver creates an opaque approval');
select is((select approval_id from api.approve_operator_action(
  'catalog.lifecycle', 'skill-version', 'skv_00000000000000000000000000000001',
  jsonb_build_object(
    'schemaVersion', 1,
    'skillId', 'skl_00000000000000000000000000000001',
    'versionId', 'skv_00000000000000000000000000000001',
    'action', 'quarantine-version',
    'reasonCode', 'dual-control-test'
  ),
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '22222222-2222-4222-8222-222222222222'
)), :'approval_id', 'exact approval replay returns the retained approval');
reset role;
select is((select count(*) from private.operator_action_approvals
  where operation_id = '22222222-2222-4222-8222-222222222222'), 1::bigint,
  'exact approval replay retains one immutable row');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('a', 64))::text, true);
select throws_ok($$select * from api.approve_operator_action(
  'catalog.lifecycle','skill','skl_00000000000000000000000000000001',
  '{"schemaVersion":1,"action":"deprecate-skill"}'::jsonb,
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '22222222-2222-4222-8222-222222222222')$$,
  23505, 'operator approval operation conflicts with retained evidence',
  'global operation UUID replay cannot change action or payload');

select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('e', 64),
  'x-skillmap-operator-approval', :'approval_id')::text, true);
select throws_ok($$select * from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',
  'skv_00000000000000000000000000000001',
  'quarantine-version','changed-reason',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222')$$,
  23514, 'operator approval does not match the exact action envelope',
  'executor cannot alter one approved field');
select is((select version_quarantined from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',
  'skv_00000000000000000000000000000001',
  'quarantine-version','dual-control-test',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222')),
  true, 'distinct executor performs the exact approved lifecycle action');
reset role;
select is((select count(*) from private.operator_action_executions
  where action_digest = 'sha256:' || repeat('2', 64)), 1::bigint,
  'successful action creates one immutable execution receipt');
select ok((select operator_attribution_required
    and operator_approval_id is not null
    and approver_operator_id = 'a1000000-0000-4000-8000-000000000001'
    and executor_operator_id = 'e1000000-0000-4000-8000-000000000001'
  from private.audit_events
  where idempotency_digest = 'sha256:' || repeat('2', 64)),
  'consequential audit event binds approval, approver, and executor');
select is((select count(*) from private.audit_events
  where idempotency_digest = 'sha256:' || repeat('2', 64)), 1::bigint,
  'successful action creates one consequential audit event');
select throws_ok(format(
  'update private.operator_action_approvals set subject_id = %L where public_id = %L',
  'skv_' || repeat('9', 32), :'approval_id'
), 55000, null, 'operator approval rows are append-only');
select throws_ok($$update private.operator_action_executions
  set action_digest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999'$$,
  55000, null, 'operator execution rows are append-only');
select throws_ok($$update private.operator_principals
  set authority_role = 'approver' where public_id = 'opr_e1000000000000000000000000000001'$$,
  55000, 'operator principal identity is immutable; only one-way revocation is allowed',
  'operator role cannot be changed after provisioning');

alter table private.operator_action_approvals disable trigger operator_action_approvals_append_only;
update private.operator_action_approvals
set created_at = clock_timestamp() - interval '1 hour',
  expires_at = clock_timestamp() - interval '30 minutes'
where public_id = :'approval_id';
alter table private.operator_action_approvals enable trigger operator_action_approvals_append_only;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('e', 64),
  'x-skillmap-operator-approval', :'approval_id')::text, true);
select is((select version_quarantined from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',
  'skv_00000000000000000000000000000001',
  'quarantine-version','dual-control-test',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222')),
  true, 'exact lost-response execution replay succeeds after approval expiry');
reset role;
select is((select count(*) from private.operator_action_executions
  where action_digest = 'sha256:' || repeat('2', 64)), 1::bigint,
  'post-expiry replay retains one execution receipt');
select is((select count(*) from private.audit_events
  where idempotency_digest = 'sha256:' || repeat('2', 64)), 1::bigint,
  'post-expiry replay retains one audit consequence');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('f', 64),
  'x-skillmap-operator-approval', :'approval_id')::text, true);
select throws_ok($$select * from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',
  'skv_00000000000000000000000000000001',
  'quarantine-version','dual-control-test',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222')$$,
  23505, 'operator approval was executed by another authority',
  'another executor cannot take over an executed approval');

reset role;
insert into private.operator_action_approvals (
  public_id, action_kind, subject_type, subject_id, action_payload, action_digest,
  operation_id, approver_operator_id, created_at, expires_at
) values (
  'opa_44444444444444444444444444444444', 'catalog.lifecycle', 'skill',
  'skl_00000000000000000000000000000001',
  jsonb_build_object('schemaVersion',1,'skillId','skl_00000000000000000000000000000001',
    'versionId',null,'action','deprecate-skill','reasonCode','same-principal-test'),
  'sha256:' || repeat('4', 64), '44444444-4444-4444-8444-444444444444',
  'e1000000-0000-4000-8000-000000000001', clock_timestamp(),
  clock_timestamp() + interval '30 minutes'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('e', 64),
  'x-skillmap-operator-approval', 'opa_44444444444444444444444444444444')::text, true);
select throws_ok($$select * from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',null,'deprecate-skill',
  'same-principal-test','sha256:4444444444444444444444444444444444444444444444444444444444444444')$$,
  42501, 'operator approver and executor must be distinct',
  'one principal cannot approve and execute the same action');

reset role;
insert into private.operator_action_approvals (
  public_id, action_kind, subject_type, subject_id, action_payload, action_digest,
  operation_id, approver_operator_id, created_at, expires_at
) values (
  'opa_55555555555555555555555555555555', 'catalog.lifecycle', 'skill',
  'skl_00000000000000000000000000000001',
  jsonb_build_object('schemaVersion',1,'skillId','skl_00000000000000000000000000000001',
    'versionId',null,'action','deprecate-skill','reasonCode','expired-test'),
  'sha256:' || repeat('5', 64), '55555555-5555-4555-8555-555555555555',
  'a1000000-0000-4000-8000-000000000001', clock_timestamp() - interval '1 hour',
  clock_timestamp() - interval '30 minutes'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', jsonb_build_object(
  'x-skillmap-operator-credential', 'smo_v1_' || repeat('e', 64),
  'x-skillmap-operator-approval', 'opa_55555555555555555555555555555555')::text, true);
select throws_ok($$select * from api.control_catalog_lifecycle(
  'skl_00000000000000000000000000000001',null,'deprecate-skill',
  'expired-test','sha256:5555555555555555555555555555555555555555555555555555555555555555')$$,
  55000, 'operator approval is expired', 'unexecuted expired approval fails closed');

reset role;
select throws_ok($$insert into private.audit_events (
  event_type, subject_type, subject_id, idempotency_digest, payload
) values (
  'submission.published','submission','sub_99999999999999999999999999999999',
  'sha256:9999999999999999999999999999999999999999999999999999999999999999','{}'
)$$, 23514, null, 'new protected audit event cannot omit dual-control attribution');
select ok(not exists (
  select 1 from private.operator_principals
  where credential_digest like '%smo_v1_%'
) and not exists (
  select 1 from private.operator_action_approvals
  where action_payload::text like '%smo_v1_%'
), 'raw operator credentials are never retained in authority tables');
select lives_ok($$insert into private.audit_events (
  event_type, subject_type, subject_id, idempotency_digest, payload,
  operator_attribution_required
) values (
  'submission.published','submission','sub_88888888888888888888888888888888',
  'sha256:8888888888888888888888888888888888888888888888888888888888888888','{}',false
)$$, 'explicit pre-migration audit rows remain valid without fabricated attribution');

select * from finish();
rollback;
