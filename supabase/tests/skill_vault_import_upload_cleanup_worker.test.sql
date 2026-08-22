begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private;

select plan(19);

select has_schema('storage_worker_adapter','storage worker adapter schema exists');
select ok(
  has_function_privilege('service_role','storage_worker_adapter.claim_import_upload_cleanup(integer,integer)','execute')
  and has_function_privilege('service_role','storage_worker_adapter.complete_import_upload_cleanup(uuid,uuid)','execute')
  and has_function_privilege('service_role','storage_worker_adapter.fail_import_upload_cleanup(uuid,uuid,integer)','execute'),
  'service role has the exact cleanup worker RPC grants'
);
select ok(
  not has_function_privilege('authenticated','storage_worker_adapter.claim_import_upload_cleanup(integer,integer)','execute')
  and not has_function_privilege('anon','storage_worker_adapter.complete_import_upload_cleanup(uuid,uuid)','execute'),
  'browser roles cannot execute cleanup worker RPCs'
);
select ok(
  not has_function_privilege('service_role','private.claim_skill_vault_incomplete_upload_cleanup(integer,integer)','execute')
  and not has_function_privilege('service_role','private.complete_skill_vault_incomplete_upload_cleanup(uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.fail_skill_vault_incomplete_upload_cleanup(uuid,uuid,integer)','execute'),
  'service role cannot bypass the cleanup worker adapter'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_db_role_setting as settings
    join pg_catalog.pg_roles as roles on roles.oid = settings.setrole
    cross join lateral pg_catalog.unnest(settings.setconfig) as config(value)
    where roles.rolname = 'authenticator'
      and config.value = 'pgrst.db_schemas=public, graphql_public, api, device_adapter, analysis_worker_adapter, storage_worker_adapter'
  ),
  'PostgREST exposes the service-role-only cleanup adapter'
);

insert into private.skill_vault_incomplete_upload_cleanup(
  id,bucket_id,object_name,cleanup_reason
) values (
  'a4300000-0000-4430-8430-000000000001',
  'skill-vault-private',
  'v1/msv_'||repeat('a',32)||'/msf_'||repeat('b',32),
  'stored_object_digest_conflict'
);

set local role service_role;
select throws_ok(
  $$select * from storage_worker_adapter.claim_import_upload_cleanup(65,60)$$,
  '22023','cleanup claim limit must be between 1 and 64',
  'cleanup worker claim retains the private bounded limit'
);
create temporary table m4_cleanup_claim on commit drop as
select * from storage_worker_adapter.claim_import_upload_cleanup(1,60);
select is((select count(*) from m4_cleanup_claim),1::bigint,'worker claims one exact cleanup job');
select is((select attempt_count from m4_cleanup_claim),1,'first claim advances the attempt count');
select ok(
  (select lease_token is not null and lease_expires_at > claimed_at from m4_cleanup_claim),
  'cleanup claim carries one exact expiring lease'
);
select is(
  storage_worker_adapter.fail_import_upload_cleanup(
    (select job_id from m4_cleanup_claim),(select lease_token from m4_cleanup_claim),0
  )->>'state',
  'queued',
  'worker failure requeues the exact claim'
);
reset role;
select is(
  (select claimed_at from private.skill_vault_incomplete_upload_cleanup
   where id=(select job_id from m4_cleanup_claim)),
  null::timestamptz,
  'requeued cleanup clears its prior claim timestamp'
);
set local role service_role;
truncate m4_cleanup_claim;
insert into m4_cleanup_claim select * from storage_worker_adapter.claim_import_upload_cleanup(1,60);
select is((select attempt_count from m4_cleanup_claim),2,'reclaim advances the attempt count');
select throws_ok(
  $$select storage_worker_adapter.complete_import_upload_cleanup(
    (select job_id from m4_cleanup_claim),'00000000-0000-4000-8000-000000000001'
  )$$,
  '42501','cleanup claim unavailable',
  'completion rejects a mismatched lease token'
);
select is(
  storage_worker_adapter.complete_import_upload_cleanup(
    (select job_id from m4_cleanup_claim),(select lease_token from m4_cleanup_claim)
  )->>'state',
  'completed',
  'worker completion records a terminal relational receipt'
);
select is(
  (select count(*) from storage_worker_adapter.claim_import_upload_cleanup(1,60)),
  0::bigint,
  'completed cleanup cannot be claimed again'
);
reset role;

update private.skill_vault_incomplete_upload_cleanup
set state='queued',attempt_count=9,max_attempts=10,claimed_at=null,completed_at=null,
    lease_token=null,lease_expires_at=null,available_at=pg_catalog.statement_timestamp()
where id='a4300000-0000-4430-8430-000000000001';
set local role service_role;
truncate m4_cleanup_claim;
insert into m4_cleanup_claim select * from storage_worker_adapter.claim_import_upload_cleanup(1,60);
select is((select attempt_count from m4_cleanup_claim),10,'final allowed cleanup claim reaches the exact attempt ceiling');
select is(
  storage_worker_adapter.fail_import_upload_cleanup(
    (select job_id from m4_cleanup_claim),(select lease_token from m4_cleanup_claim),0
  )->>'state',
  'dead_lettered',
  'failure at the attempt ceiling records a terminal dead letter'
);
select is(
  (select count(*) from storage_worker_adapter.claim_import_upload_cleanup(1,60)),
  0::bigint,
  'dead-lettered cleanup is not claimable'
);
reset role;

select ok(
  exists (
    select 1 from pg_catalog.pg_default_acl as defaults
    join pg_catalog.pg_roles as owners on owners.oid=defaults.defaclrole
    where owners.rolname='postgres'
      and defaults.defaclnamespace=0
      and defaults.defaclobjtype='f'
  ),
  'postgres functions have an explicit global default-privilege record'
);

select * from finish();
rollback;
