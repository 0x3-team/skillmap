begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(12);

select has_function('private', 'my_owner_import_dashboard', array[]::text[], 'owner dashboard projection helper exists');
select has_view('api', 'my_import_dashboard', 'owner dashboard projection view exists');
select ok(
  has_table_privilege('authenticated', 'api.my_import_dashboard', 'select')
  and not has_table_privilege('anon', 'api.my_import_dashboard', 'select')
  and not has_table_privilege('service_role', 'api.my_import_dashboard', 'select'),
  'only authenticated browser owners can select the dashboard projection'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4000000-0000-4400-8400-000000000011','authenticated','authenticated','m4-dashboard-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4000000-0000-4400-8400-000000000012','authenticated','authenticated','m4-dashboard-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4000000-0000-4400-8400-000000000111','dev_'||repeat('d',32),'a4000000-0000-4400-8400-000000000011','Dashboard connector','macos','1.0.0','en-US');

create function pg_temp.m4_prepare_target(
  p_account_public_id text, p_device_public_id text, p_display_name text, p_description text,
  p_manifest_schema_version text, p_logical_id text, p_source jsonb,
  p_provenance_state text, p_files jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_manifest jsonb;
  v_manifest_bytes bytea;
  v_manifest_digest text;
  v_metadata jsonb;
begin
  v_manifest := pg_catalog.jsonb_build_object(
    'schema_version', p_manifest_schema_version,
    'identity', pg_catalog.jsonb_build_object('logical_id', p_logical_id, 'public_id', 'fixture.' || pg_catalog.replace(p_logical_id, '-', '_')),
    'display', pg_catalog.jsonb_build_object('name', p_display_name, 'description', coalesce(p_description, '')),
    'source', p_source,
    'files', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'path', item.value ->> 'relative_path', 'media_type', item.value ->> 'media_type',
        'utf8_bytes', item.value -> 'byte_size', 'digest', item.value ->> 'file_digest',
        'executable', item.value -> 'executable'
      ) order by (item.value ->> 'ordinal')::integer)
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
    ),
    'provenance', pg_catalog.jsonb_build_object('publisher_id','local-owner','ingest_id','m4-pgtap','created_at','2026-08-20T00:00:00.000Z'),
    'compatibility', pg_catalog.jsonb_build_object('manifest_major',1,'minimum_consumer_major',1)
  );
  v_manifest_bytes := pg_catalog.convert_to(private.canonical_managed_import_manifest(v_manifest), 'UTF8');
  v_manifest_digest := 'sha256:' || pg_catalog.encode(extensions.digest(v_manifest_bytes, 'sha256'), 'hex');
  v_metadata := pg_catalog.jsonb_build_object('logical_id',p_logical_id,'display_name',pg_catalog.btrim(p_display_name));
  if nullif(pg_catalog.btrim(coalesce(p_description, '')), '') is not null then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object('description',pg_catalog.btrim(p_description));
  end if;
  return device_adapter.adapter_prepare_import_target(
    p_account_public_id,p_device_public_id,p_display_name,p_description,p_manifest_schema_version,
    v_manifest_bytes,v_manifest_digest,private.compute_import_content_digest(v_manifest_digest,p_files),
    v_metadata,p_source,p_provenance_state,p_files,p_idempotency_key
  );
end
$function$;
revoke all privileges on function pg_temp.m4_prepare_target(text,text,text,text,text,text,jsonb,text,jsonb,uuid) from public;
grant execute on function pg_temp.m4_prepare_target(text,text,text,text,text,text,jsonb,text,jsonb,uuid) to service_role;

create temporary table m4_dashboard_target(response jsonb not null) on commit drop;
create temporary table m4_dashboard_session(response jsonb not null) on commit drop;
grant select, insert on m4_dashboard_target, m4_dashboard_session to service_role;
grant select on m4_dashboard_target, m4_dashboard_session to authenticated;

set local role service_role;
insert into m4_dashboard_target(response)
select pg_temp.m4_prepare_target(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  'Dashboard Alpha','Dashboard projection fixture','1.0','dashboard-alpha',
  '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"dashboard-alpha","revision":"r1"}',
  'verified',
  '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
  'a4000000-0000-4400-8400-000000000311'
);

insert into m4_dashboard_session(response)
select device_adapter.adapter_begin_import_session_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'skill_public_id' from m4_dashboard_target),
  (select response->>'version_public_id' from m4_dashboard_target),
  '1.0',
  (select response->>'manifest_digest' from m4_dashboard_target),
  (select response->>'content_digest' from m4_dashboard_target),
  1,3,'a4000000-0000-4400-8400-000000000312',
  pg_catalog.statement_timestamp() + interval '30 minutes'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;

select is((select count(*) from api.my_import_dashboard), 1::bigint, 'owner sees exactly its import dashboard row');
select ok(
  (select projection ?& array['sessionId','state','device','summary','skills','uploadProgress','createdAt','expiresAt','revision']
     and projection->>'state' = 'preview'
     and projection->'device'->>'name' = 'Dashboard connector'
     and projection->'skills'->0->>'skillName' = 'Dashboard Alpha'
     and projection->'skills'->0->'files'->0->>'relativePath' = 'SKILL.md'
   from api.my_import_dashboard),
  'dashboard row is the expected safe workflow projection'
);
select ok(
  (select projection::text !~ 'account_id|managed_skill_id|version_id|device_id|storage_key'
     and projection::text not like '%a4000000-0000-4400-8400-000000000011%'
   from api.my_import_dashboard),
  'dashboard projection contains no internal identifiers or storage keys'
);

reset role;
insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata,user_metadata) values (
  'a4000000-0000-4400-8400-000000000411','skill-vault-private',
  (select response->'files'->0->>'storage_key' from m4_dashboard_target),
  'a4000000-0000-4400-8400-000000000011','a4000000-0000-4400-8400-000000000011',
  '{"mimetype":"text/markdown","size":3}','{}'
);
set local role service_role;
select device_adapter.adapter_accept_import_file_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'session_id' from m4_dashboard_session),1,
  (select response->'files'->0->>'file_public_id' from m4_dashboard_target),
  'sha256:'||repeat('6',64),3
);
reset role;

-- More than one page of newer preview sessions must not hide the older owner
-- action. These disposable rows share the same immutable target but have
-- distinct idempotency keys and later creation times.
insert into private.import_sessions (
  account_id, device_id, managed_skill_id, version_id,
  manifest_schema_version, manifest_digest, content_digest,
  expected_file_count, expected_byte_total, idempotency_key,
  expiry_at, created_at, updated_at
)
select
  sessions.account_id, sessions.device_id, sessions.managed_skill_id, sessions.version_id,
  sessions.manifest_schema_version, sessions.manifest_digest, sessions.content_digest,
  sessions.expected_file_count, sessions.expected_byte_total, pg_catalog.gen_random_uuid(),
  pg_catalog.statement_timestamp() + interval '2 days',
  pg_catalog.statement_timestamp() + (series.n * interval '1 minute'),
  pg_catalog.statement_timestamp() + (series.n * interval '1 minute')
from private.import_sessions as sessions
cross join pg_catalog.generate_series(1, 21) as series(n)
where sessions.imp_ = (select response ->> 'session_id' from m4_dashboard_session);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;
select is((select count(*) from api.my_import_dashboard), 20::bigint, 'dashboard remains bounded to twenty rows');
select ok(
  exists (
    select 1 from api.my_import_dashboard
    where projection ->> 'sessionId' = (select response ->> 'session_id' from m4_dashboard_session)
      and projection ->> 'state' = 'ready_for_consent'
  ),
  'an older owner-action session is retained ahead of newer preview sessions'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;
select api.authorize_my_import_cutover(
  (select response->>'session_id' from m4_dashboard_session),2,
  (select response->>'manifest_digest' from m4_dashboard_target)
);
select ok(
  exists (
    select 1 from api.my_import_dashboard
    where projection ->> 'sessionId' = (select response ->> 'session_id' from m4_dashboard_session)
      and projection ->> 'state' = 'consented'
  ),
  'active consent is projected from the authoritative dashboard query'
);
reset role;
set local role service_role;
select device_adapter.adapter_finalize_import_session_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'session_id' from m4_dashboard_session),2,
  'a4000000-0000-4400-8400-000000000313'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;
select ok(
  (select projection->>'state' = 'cutover_ready'
     and projection->'cutoverReceipt'->>'receiptId' ~ '^rcpt_[0-9a-f]{32}$'
     and projection->'cutoverReceipt'->>'verificationDigest' ~ '^sha256:[0-9a-f]{64}$'
     and projection->'cutoverReceipt'->>'sessionId' = projection->>'sessionId'
   from api.my_import_dashboard
   where projection ->> 'sessionId' = (select response ->> 'session_id' from m4_dashboard_session)),
  'verified session projects a browser-safe cutover receipt and reachable cutover-ready state'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b4000000-0000-4400-8400-000000000012","is_anonymous":false}', true);
set local role authenticated;
select is((select count(*) from api.my_import_dashboard), 0::bigint, 'another account cannot see the owner dashboard row');
reset role;

set local role anon;
select throws_ok($$select * from api.my_import_dashboard$$, '42501', null, 'anonymous role cannot select the dashboard view');
reset role;

select * from finish();
rollback;
