begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(27);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_finalization_receipts'::regclass),
  'finalization receipts force RLS'
);
select ok(
  has_function_privilege('service_role','device_adapter.adapter_begin_import_session_v2(text,text,text,text,text,text,text,integer,bigint,uuid,timestamptz)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_prepare_import_upload(text,text,text,bigint,text,timestamptz)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_list_import_file_receipts(text,text,text)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_accept_import_file_v2(text,text,text,bigint,text)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_expire_import_session(text,text,text)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_finalize_import_session_v2(text,text,text,bigint,uuid)','execute'),
  'service role has the exact M4 upload and finalization adapter grants'
);
select ok(
  not has_function_privilege('authenticated','device_adapter.adapter_prepare_import_upload(text,text,text,bigint,text,timestamptz)','execute')
  and not has_function_privilege('anon','device_adapter.adapter_finalize_import_session_v2(text,text,text,bigint,uuid)','execute'),
  'browser roles cannot execute M4 upload or finalization adapters'
);
select ok(
  not has_table_privilege('anon','private.import_finalization_receipts','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.import_finalization_receipts','select,insert,update,delete')
  and not has_table_privilege('service_role','private.import_finalization_receipts','select,insert,update,delete'),
  'application roles have no finalization receipt table grants'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values (
  '00000000-0000-0000-0000-000000000000','a4100000-0000-4410-8410-000000000001',
  'authenticated','authenticated','m4-upload@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''
);
insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values (
  'a4100000-0000-4410-8410-000000000101','dev_'||repeat('7',32),
  'a4100000-0000-4410-8410-000000000001','M4 upload','macos','1.0.0','en-US'
);

create temporary table m4_upload_target(response jsonb not null) on commit drop;
create temporary table m4_upload_session(public_id text not null) on commit drop;
create temporary table m4_upload_final(response jsonb not null) on commit drop;
grant select, insert on m4_upload_target, m4_upload_session, m4_upload_final to service_role;

set local role service_role;
select lives_ok($$insert into m4_upload_target(response)
  select device_adapter.adapter_prepare_import_target(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    'Upload Alpha',null,'1.0',pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('8',64),
    '{"logical_id":"upload-alpha","display_name":"Upload Alpha"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"upload-alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:9999999999999999999999999999999999999999999999999999999999999999","executable":false,"ordinal":0}]',
    'a4100000-0000-4410-8410-000000000301'
  )$$, 'upload fixture target is prepared');

select lives_ok($$insert into m4_upload_session(public_id)
  select device_adapter.adapter_begin_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select response->>'skill_public_id' from m4_upload_target),
    (select response->>'version_public_id' from m4_upload_target),
    '1.0',
    (select response->>'manifest_digest' from m4_upload_target),
    (select response->>'content_digest' from m4_upload_target),
    1,3,'a4100000-0000-4410-8410-000000000302',now()+interval '2 hours'
  )->>'session_id'$$, 'bounded M3-authenticated import session begins');

select is(
  device_adapter.adapter_begin_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select response->>'skill_public_id' from m4_upload_target),
    (select response->>'version_public_id' from m4_upload_target),
    '1.0',
    (select response->>'manifest_digest' from m4_upload_target),
    (select response->>'content_digest' from m4_upload_target),
    1,3,'a4100000-0000-4410-8410-000000000302',now()+interval '2 hours'
  )->>'session_id',
  (select public_id from m4_upload_session),
  'exact M3-authenticated begin replay returns the same public session'
);
select throws_ok($$select device_adapter.adapter_begin_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select response->>'skill_public_id' from m4_upload_target),
    (select response->>'version_public_id' from m4_upload_target),
    '1.0',
    (select response->>'manifest_digest' from m4_upload_target),
    (select response->>'content_digest' from m4_upload_target),
    1,3,'a4100000-0000-4410-8410-000000000302',now()+interval '3 hours'
  )$$, 22023, 'conflicting import session idempotency reuse',
  'changed begin-session expiry conflicts on idempotent replay');

select ok(
  device_adapter.adapter_prepare_import_upload(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),1,
    (select response->'files'->0->>'file_public_id' from m4_upload_target),
    now()+interval '2 minutes'
  ) @> pg_catalog.jsonb_build_object(
    'session_id',(select public_id from m4_upload_session),
    'session_revision',1,
    'bucket_id','skill-vault-private',
    'purpose','upload',
    'declared_size',3,
    'file_digest','sha256:'||repeat('9',64)
  ),
  'upload preparation returns one exact immutable object projection'
);
select throws_ok($$select device_adapter.adapter_prepare_import_upload(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),1,
    (select response->'files'->0->>'file_public_id' from m4_upload_target),
    now()+interval '6 minutes'
  )$$, 22023, 'invalid import upload expiry',
  'upload preparation rejects expiry beyond five minutes');
select ok(
  device_adapter.adapter_enqueue_import_upload_cleanup(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),
    (select response->'files'->0->>'file_public_id' from m4_upload_target),
    'interrupted_upload'
  ),
  'exact incomplete upload cleanup target is queued idempotently'
);

select throws_ok($$select device_adapter.adapter_accept_import_file_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),1,
    (select response->'files'->0->>'file_public_id' from m4_upload_target)
  )$$, 22023, 'uploaded object does not match the immutable file binding',
  'file cannot be accepted before an exact storage object exists');
reset role;

select lives_ok($$insert into storage.objects(
    id,bucket_id,name,owner,owner_id,metadata,user_metadata
  ) values (
    'a4100000-0000-4410-8410-000000000401','skill-vault-private',
    (select response->'files'->0->>'storage_key' from m4_upload_target),
    'a4100000-0000-4410-8410-000000000001','a4100000-0000-4410-8410-000000000001',
    '{"mimetype":"text/markdown","size":3}','{}'
  )$$, 'exact bound storage object is accepted by persistence guard');

set local role service_role;
select ok(
  device_adapter.adapter_accept_import_file_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),1,
    (select response->'files'->0->>'file_public_id' from m4_upload_target)
  ) @> pg_catalog.jsonb_build_object(
    'session_id',(select public_id from m4_upload_session),
    'state','in_progress',
    'revision',2,
    'accepted_file_count',1,
    'accepted_byte_total',3
  ),
  'exact storage-bound file acceptance returns a public projection and advances the session revision'
);
select ok(
  device_adapter.adapter_list_import_file_receipts(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session)
  ) @> pg_catalog.jsonb_build_object(
    'accepted_file_count',1,
    'accepted_byte_total',3,
    'revision',2
  ),
  'receipt reconciliation reports exact accepted counts and revision'
);
select is(
  pg_catalog.jsonb_array_length(
    device_adapter.adapter_list_import_file_receipts(
      'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
      (select public_id from m4_upload_session)
    )->'receipts'
  ),
  1,
  'receipt reconciliation returns exactly one accepted file'
);
select throws_ok($$select device_adapter.adapter_prepare_import_upload(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),2,
    (select response->'files'->0->>'file_public_id' from m4_upload_target),
    now()+interval '2 minutes'
  )$$, 22023, 'import file is already accepted', 'accepted file cannot mint another upload preparation');
select throws_ok($$select device_adapter.adapter_finalize_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),1,'a4100000-0000-4410-8410-000000000303'
  )$$, '42501', 'import authority unavailable', 'stale session revision cannot finalize');

select lives_ok($$insert into m4_upload_final(response)
  select device_adapter.adapter_finalize_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),2,'a4100000-0000-4410-8410-000000000304'
  )$$, 'exact accepted session finalizes atomically');
select ok(
  (select response @> pg_catalog.jsonb_build_object(
      'session_id',(select public_id from m4_upload_session),
      'state','verified',
      'revision',3,
      'analysis_state','pending'
    ) and response ?& array['verification_digest','version_public_id','release_public_id']
   from m4_upload_final),
  'finalization response is verified and public-ID only'
);
reset role;

select is((select count(*) from private.import_finalization_receipts),1::bigint,'one immutable finalization receipt is stored');

set local role service_role;
select is(
  device_adapter.adapter_finalize_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),2,'a4100000-0000-4410-8410-000000000304'
  ),
  (select response from m4_upload_final),
  'exact finalization replay returns the same receipt'
);
select throws_ok($$select device_adapter.adapter_finalize_import_session_v2(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session),3,'a4100000-0000-4410-8410-000000000304'
  )$$, 22023, 'conflicting import finalization idempotency reuse', 'changed finalization replay conflicts');
select ok(
  device_adapter.adapter_expire_import_session(
    'acct_a4100000000044108410000000000001','dev_'||repeat('7',32),
    (select public_id from m4_upload_session)
  ) @> pg_catalog.jsonb_build_object(
    'session_id',(select public_id from m4_upload_session),
    'state','verified',
    'revision',3
  ),
  'expiry adapter preserves an already verified terminal session'
);
reset role;

select is((select count(*) from private.import_analysis_jobs),1::bigint,'finalization enqueues exactly one analysis job');
select ok(
  (select lifecycle_state='needs-review' and revoked_at is null
   from private.managed_skill_releases where account_id='a4100000-0000-4410-8410-000000000001'),
  'finalization does not activate the release'
);

set local role service_role;
select throws_ok($$select * from private.import_finalization_receipts$$,'42501',null,'service role cannot list private finalization receipts');
reset role;

select * from finish();
rollback;
