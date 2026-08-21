begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(25);

select has_table('private','import_analysis_jobs','import analysis job table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_analysis_jobs'::regclass),
  'analysis jobs force RLS'
);
select ok(
  not has_table_privilege('anon','private.import_analysis_jobs','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.import_analysis_jobs','select,insert,update,delete')
  and not has_table_privilege('service_role','private.import_analysis_jobs','select,insert,update,delete'),
  'application roles have no analysis job table grants'
);
select ok(
  has_function_privilege('service_role','analysis_worker_adapter.claim_import_analysis_jobs(text,integer,integer)','execute')
  and has_function_privilege('service_role','analysis_worker_adapter.renew_import_analysis_job(text,text,uuid,integer)','execute')
  and has_function_privilege('service_role','analysis_worker_adapter.complete_import_analysis_job(text,text,uuid,text)','execute')
  and has_function_privilege('service_role','analysis_worker_adapter.fail_import_analysis_job(text,text,uuid,text,integer)','execute'),
  'service role has exact analysis worker function grants'
);
select ok(
  not has_function_privilege('authenticated','analysis_worker_adapter.claim_import_analysis_jobs(text,integer,integer)','execute')
  and not has_function_privilege('anon','analysis_worker_adapter.complete_import_analysis_job(text,text,uuid,text)','execute'),
  'browser roles cannot execute analysis worker functions'
);
select ok(
  not has_function_privilege('service_role','private.enqueue_import_analysis_job(uuid,uuid,uuid)','execute'),
  'service role cannot bypass the finalization trigger through private enqueue'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000','a4200000-0000-4420-8420-000000000001',
  'authenticated','authenticated','m4-analysis@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''
);
insert into private.managed_skills(id,public_id,account_id,display_name) values (
  'a4200000-0000-4420-8420-000000000101','msk_'||repeat('a',32),
  'a4200000-0000-4420-8420-000000000001','Analysis Alpha'
);
insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values (
  'a4200000-0000-4420-8420-000000000102','dev_'||repeat('d',32),
  'a4200000-0000-4420-8420-000000000001','Analysis worker','macos','1.0.0','en-US'
);
create temporary table m4_analysis_manifest(
  manifest_projection bytea not null,
  manifest_digest text not null,
  content_digest text not null
) on commit drop;
with fixture as (
  select
    pg_catalog.jsonb_build_object(
      'schema_version','1.0',
      'identity',pg_catalog.jsonb_build_object('logical_id','analysis-alpha','public_id','fixture.analysis_alpha'),
      'display',pg_catalog.jsonb_build_object('name','Analysis Alpha','description',''),
      'source',pg_catalog.jsonb_build_object(
        'authority','local-owner','kind','skill-directory','namespace','skillmap','source_id','analysis-alpha','revision','r1'
      ),
      'files',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'path','SKILL.md','media_type','text/markdown','utf8_bytes',3,
        'digest','sha256:'||repeat('9',64),'executable',false
      )),
      'provenance',pg_catalog.jsonb_build_object(
        'publisher_id','local-owner','ingest_id','m4-analysis','created_at','2026-08-20T00:00:00.000Z'
      ),
      'compatibility',pg_catalog.jsonb_build_object('manifest_major',1,'minimum_consumer_major',1)
    ) as manifest,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'relative_path','SKILL.md','media_type','text/markdown','byte_size',3,
      'file_digest','sha256:'||repeat('9',64),'executable',false,'ordinal',0
    )) as files
), canonical as (
  select pg_catalog.convert_to(private.canonical_managed_import_manifest(manifest),'UTF8') as bytes, files
  from fixture
), digests as (
  select bytes, 'sha256:'||pg_catalog.encode(extensions.digest(bytes,'sha256'),'hex') as manifest_digest, files
  from canonical
)
insert into m4_analysis_manifest
select bytes, manifest_digest, private.compute_import_content_digest(manifest_digest,files)
from digests;
insert into private.managed_skill_versions(
  id,public_id,account_id,managed_skill_id,manifest_schema_version,manifest_projection,
  manifest_digest,content_digest,canonical_metadata,source,provenance_state,analysis_state
) select
  'a4200000-0000-4420-8420-000000000201','msv_'||repeat('b',32),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000101',
  '1.0',manifest_projection,manifest_digest,content_digest,
  '{"logical_id":"analysis-alpha","display_name":"Analysis Alpha"}',
  '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"analysis-alpha","revision":"r1"}',
  'verified','pending'
from m4_analysis_manifest;
insert into private.managed_skill_files(
  id,public_id,account_id,managed_skill_id,version_id,relative_path,media_type,
  byte_size,file_digest,storage_key,executable,ordinal
) values (
  'a4200000-0000-4420-8420-000000000202','msf_'||repeat('e',32),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000101',
  'a4200000-0000-4420-8420-000000000201','SKILL.md','text/markdown',3,
  'sha256:'||repeat('9',64),'v1/msv_'||repeat('b',32)||'/msf_'||repeat('e',32),false,0
);
insert into private.managed_skill_releases(
  id,public_id,account_id,managed_skill_id,version_id,lifecycle_state,eligibility_reasons
) values (
  'a4200000-0000-4420-8420-000000000301','msr_'||repeat('c',32),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000101',
  'a4200000-0000-4420-8420-000000000201','needs-review',array['analysis_pending']::text[]
);

create temporary table m4_job_receipt(response jsonb not null) on commit drop;
create temporary table m4_claim_one(
  job_public_id text, skill_public_id text, version_public_id text, reason text,
  priority integer, attempt_count integer, max_attempts integer,
  lease_token uuid, lease_expires_at timestamp with time zone
) on commit drop;
create temporary table m4_claim_two(
  job_public_id text, skill_public_id text, version_public_id text, reason text,
  priority integer, attempt_count integer, max_attempts integer,
  lease_token uuid, lease_expires_at timestamp with time zone
) on commit drop;
grant select on m4_job_receipt to service_role;
grant select, insert on m4_claim_one, m4_claim_two to service_role;

select lives_ok($$insert into m4_job_receipt(response)
  select private.enqueue_import_analysis_job(
    'a4200000-0000-4420-8420-000000000001',
    'a4200000-0000-4420-8420-000000000101',
    'a4200000-0000-4420-8420-000000000201'
  )$$, 'reviewable finalized version can enqueue one bounded job');
select ok(
  (select response @> '{"reason":"import_finalized","priority":50,"max_attempts":5,"attempt_count":0,"state":"queued"}'
     and (response->>'job_public_id') ~ '^iaj_[0-9a-f]{32}$'
   from m4_job_receipt),
  'enqueue returns a bounded public job projection'
);
select is(
  private.enqueue_import_analysis_job(
    'a4200000-0000-4420-8420-000000000001',
    'a4200000-0000-4420-8420-000000000101',
    'a4200000-0000-4420-8420-000000000201'
  )->>'job_public_id',
  (select response->>'job_public_id' from m4_job_receipt),
  'exact enqueue replay returns the same job'
);
select is((select count(*) from private.import_analysis_jobs),1::bigint,'enqueue replay leaves exactly one job');

insert into private.import_sessions(
  id,imp_,account_id,device_id,managed_skill_id,version_id,manifest_schema_version,
  manifest_digest,content_digest,expected_file_count,expected_byte_total,
  accepted_file_count,accepted_byte_total,idempotency_key,state,expiry_at,
  verified_at,verification_digest,revision
)
select
  'a4200000-0000-4420-8420-000000000401','imp_'||repeat('f',32),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000102',
  'a4200000-0000-4420-8420-000000000101','a4200000-0000-4420-8420-000000000201',
  '1.0',manifest_digest,content_digest,1,3,1,3,
  'a4200000-0000-4420-8420-000000000402','verified',now()+interval '2 hours',
  pg_catalog.clock_timestamp(),'sha256:'||repeat('8',64),3
from m4_analysis_manifest;
insert into private.import_file_receipts(
  id,account_id,device_id,session_id,file_id,managed_skill_id,version_id,
  relative_path,media_type,accepted_byte_size,file_digest,ordinal
) values (
  'a4200000-0000-4420-8420-000000000403','a4200000-0000-4420-8420-000000000001',
  'a4200000-0000-4420-8420-000000000102','a4200000-0000-4420-8420-000000000401',
  'a4200000-0000-4420-8420-000000000202','a4200000-0000-4420-8420-000000000101',
  'a4200000-0000-4420-8420-000000000201','SKILL.md','text/markdown',3,
  'sha256:'||repeat('9',64),0
);
insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata,user_metadata) values (
  'a4200000-0000-4420-8420-000000000404','skill-vault-private',
  'v1/msv_'||repeat('b',32)||'/msf_'||repeat('e',32),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000001',
  '{"mimetype":"text/markdown","size":3}','{}'
);
insert into private.import_finalization_receipts(
  id,account_id,device_id,session_id,idempotency_key,expected_session_revision,request_digest,response
) values (
  'a4200000-0000-4420-8420-000000000405','a4200000-0000-4420-8420-000000000001',
  'a4200000-0000-4420-8420-000000000102','a4200000-0000-4420-8420-000000000401',
  'a4200000-0000-4420-8420-000000000406',2,'sha256:'||repeat('7',64),
  '{"state":"verified"}'
);

set local role service_role;
select lives_ok($$insert into m4_claim_one
  select * from analysis_worker_adapter.claim_import_analysis_jobs('worker-a',1,60)$$,
  'worker claims one bounded job');
select ok(
  (select job_public_id=(select response->>'job_public_id' from m4_job_receipt)
     and skill_public_id='msk_'||repeat('a',32)
     and version_public_id='msv_'||repeat('b',32)
     and reason='import_finalized'
     and attempt_count=1 and max_attempts=5 and lease_token is not null
   from m4_claim_one),
  'claim projection binds the exact public skill and version without account IDs'
);
select throws_ok($$select analysis_worker_adapter.complete_import_analysis_job(
    (select job_public_id from m4_claim_one),'worker-b',(select lease_token from m4_claim_one),
    'skillmap-import-analysis/0.1.0'
  )$$, '42501', 'import analysis lease unavailable', 'different worker cannot complete the lease');
select ok(
  analysis_worker_adapter.renew_import_analysis_job(
    (select job_public_id from m4_claim_one),'worker-a',(select lease_token from m4_claim_one),120
  ) > (select lease_expires_at from m4_claim_one),
  'lease owner can renew the exact live lease'
);
select throws_ok($$select analysis_worker_adapter.complete_import_analysis_job(
    (select job_public_id from m4_claim_one),'worker-a',(select lease_token from m4_claim_one),
    'caller-supplied-digest'
  )$$, '22023', 'invalid import analysis result',
  'worker cannot substitute a caller-derived digest for database-owned analysis');
select is(
  analysis_worker_adapter.fail_import_analysis_job(
    (select job_public_id from m4_claim_one),'worker-a',(select lease_token from m4_claim_one),
    'transient_failure',0
  )->>'state',
  'queued',
  'bounded failure requeues below the attempt limit'
);
select lives_ok($$insert into m4_claim_two
  select * from analysis_worker_adapter.claim_import_analysis_jobs('worker-b',1,60)$$,
  'second worker can claim the requeued job');
select is((select attempt_count from m4_claim_two),2,'reclaim advances the bounded attempt count');
select is(
  analysis_worker_adapter.complete_import_analysis_job(
    (select job_public_id from m4_claim_two),'worker-b',(select lease_token from m4_claim_two),
    'skillmap-import-analysis/0.1.0'
  )->>'state',
  'completed',
  'exact lease completion is terminal'
);
select is((select count(*) from analysis_worker_adapter.claim_import_analysis_jobs('worker-c',1,60)),0::bigint,'completed job cannot be claimed again');
select throws_ok($$select * from private.import_analysis_jobs$$,'42501',null,'service role cannot list private analysis jobs');
reset role;

select ok(
  (select state='completed' and attempt_count=2 and result_digest ~ '^sha256:[0-9a-f]{64}$'
   from private.import_analysis_jobs),
  'completed job stores the database-derived result digest and attempt count'
);
select is(
  (select analysis_state from private.managed_skill_versions
    where account_id='a4200000-0000-4420-8420-000000000001'),
  'passed',
  'analysis completion persists the verdict on the immutable version adjunct state'
);
select ok(
  (select lifecycle_state='needs-review' and revoked_at is null
   from private.managed_skill_releases where account_id='a4200000-0000-4420-8420-000000000001'),
  'analysis completion does not activate the managed release'
);
select throws_ok($$update private.import_analysis_jobs
  set version_id='a4200000-0000-4420-8420-000000000202' where true$$,
  22023, 'import analysis job binding is immutable', 'job binding trigger rejects version rewrites');

select * from finish();
rollback;
