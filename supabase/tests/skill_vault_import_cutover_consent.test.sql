begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(26);

select has_table('private', 'import_cutover_consents', 'cutover consent authority table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'private.import_cutover_consents'::regclass),
  'cutover consents force RLS'
);
select ok(
  has_function_privilege('authenticated', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and not has_function_privilege('service_role', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and has_function_privilege('service_role', 'device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)', 'execute'),
  'browser consent and connector enforcement privileges are separated'
);
select ok(
  has_table_privilege('authenticated', 'api.my_import_cutover_consents', 'select')
  and not has_table_privilege('anon', 'api.my_import_cutover_consents', 'select')
  and not has_table_privilege('service_role', 'api.my_import_cutover_consents', 'select'),
  'only authenticated owners can read the safe consent projection'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4200000-0000-4420-8420-000000000001','authenticated','authenticated','m4-consent-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4200000-0000-4420-8420-000000000002','authenticated','authenticated','m4-consent-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4200000-0000-4420-8420-000000000101','dev_'||repeat('8',32),'a4200000-0000-4420-8420-000000000001','Consent connector','macos','1.0.0','en-US');

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

create temporary table m4_consent_target(response jsonb not null) on commit drop;
create temporary table m4_consent_session(public_id text not null, manifest_digest text not null, revision bigint not null) on commit drop;
create temporary table m4_consent_receipt(response jsonb not null) on commit drop;
create temporary table m4_consent_finalization(response jsonb not null) on commit drop;
grant select, insert on m4_consent_target, m4_consent_session to service_role;
grant select on m4_consent_session to authenticated;
grant select, insert on m4_consent_receipt to authenticated;
grant select on m4_consent_receipt to service_role;
grant select, insert on m4_consent_finalization to service_role;

set local role service_role;
insert into m4_consent_target(response)
select pg_temp.m4_prepare_target(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  'Consent Alpha','Consent fixture','1.0','consent-alpha',
  '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"consent-alpha","revision":"r1"}',
  'verified',
  '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
  'a4200000-0000-4420-8420-000000000301'
);
insert into m4_consent_session(public_id, manifest_digest, revision)
select response->>'session_id', (select response->>'manifest_digest' from m4_consent_target), (response->>'revision')::bigint
from (
  select device_adapter.adapter_begin_import_session_v2(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select response->>'skill_public_id' from m4_consent_target),
    (select response->>'version_public_id' from m4_consent_target),
    '1.0',(select response->>'manifest_digest' from m4_consent_target),
    (select response->>'content_digest' from m4_consent_target),
    1,3,'a4200000-0000-4420-8420-000000000302',
    pg_catalog.statement_timestamp() + interval '30 minutes'
  ) as response
) as started;

select throws_ok($$select device_adapter.adapter_require_import_cutover_consent(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),1
)$$, '42501', 'import cutover consent required', 'connector cannot finalize before owner consent');
reset role;

insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata,user_metadata) values (
  'a4200000-0000-4420-8420-000000000401','skill-vault-private',
  (select response->'files'->0->>'storage_key' from m4_consent_target),
  'a4200000-0000-4420-8420-000000000001','a4200000-0000-4420-8420-000000000001',
  '{"mimetype":"text/markdown","size":3}','{}'
);
set local role service_role;
select device_adapter.adapter_accept_import_file_v2(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),1,
  (select response->'files'->0->>'file_public_id' from m4_consent_target),
  'sha256:'||repeat('6',64),3
);
reset role;
update m4_consent_session as fixture
set revision=sessions.revision
from private.import_sessions as sessions
where sessions.imp_=fixture.public_id;

set local role service_role;
select throws_ok($$select device_adapter.adapter_finalize_import_session_v2(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),(select revision from m4_consent_session),
  'a4200000-0000-4420-8420-000000000303'
)$$, '42501', 'import cutover consent required', 'finalization rejects missing owner consent');
reset role;
select is((select state from private.import_sessions where imp_=(select public_id from m4_consent_session)), 'in_progress', 'missing consent leaves session open');
select is((select revision from private.import_sessions where imp_=(select public_id from m4_consent_session)), 2::bigint, 'missing consent leaves revision unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4200000-0000-4420-8420-000000000001","is_anonymous":true}', true);
set local role authenticated;
select throws_ok($$select api.authorize_my_import_cutover(
  (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
)$$, '22023', 'invalid import cutover consent', 'anonymous Auth user cannot authorize cutover');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4200000-0000-4420-8420-000000000001","is_anonymous":false}', true);
set local role authenticated;
select lives_ok($$insert into m4_consent_receipt(response)
  select api.authorize_my_import_cutover(
    (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
  )$$, 'owner can authorize an exact complete import revision');
select ok(
  (select response ?& array['owner_consent_id','session_public_id','revision','manifest_digest','consent_digest','explicit_consent_at','consent_expires_at']
     and response->>'owner_consent_id' ~ '^icn_[0-9a-f]{32}$'
     and response->>'consent_digest' ~ '^sha256:[0-9a-f]{64}$'
   from m4_consent_receipt),
  'consent receipt is a closed public binding'
);
select ok(
  (select (response->>'consent_expires_at')::timestamptz > (response->>'explicit_consent_at')::timestamptz
     and (response->>'consent_expires_at')::timestamptz <= (response->>'explicit_consent_at')::timestamptz + interval '10 minutes'
   from m4_consent_receipt),
  'consent receipt is short lived'
);
select is(
  api.authorize_my_import_cutover(
    (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
  ),
  (select response from m4_consent_receipt),
  'exact owner consent replay is idempotent'
);
select is((select count(*) from api.my_import_cutover_consents),1::bigint,'owner sees one active safe consent row');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b4200000-0000-4420-8420-000000000002","is_anonymous":false}', true);
set local role authenticated;
select is((select count(*) from api.my_import_cutover_consents),0::bigint,'another account cannot see owner consent');
reset role;

update private.import_cutover_consents
set explicit_consent_at=pg_catalog.statement_timestamp() - interval '5 minutes',
    consent_expires_at=pg_catalog.statement_timestamp() - interval '1 second';
set local role service_role;
select throws_ok($$select device_adapter.adapter_finalize_import_session_v2(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),(select revision from m4_consent_session),
  'a4200000-0000-4420-8420-000000000304'
)$$, '42501', 'import cutover consent required', 'finalization rejects expired owner consent');
reset role;
select is((select state from private.import_sessions where imp_=(select public_id from m4_consent_session)), 'in_progress', 'expired consent leaves session open');
select is((select revision from private.import_sessions where imp_=(select public_id from m4_consent_session)), 2::bigint, 'expired consent leaves revision unchanged');

update private.import_cutover_consents
set explicit_consent_at=(select (response->>'explicit_consent_at')::timestamptz from m4_consent_receipt),
    consent_expires_at=(select (response->>'consent_expires_at')::timestamptz from m4_consent_receipt);

set local role service_role;
select ok(
  device_adapter.adapter_require_import_cutover_consent(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session)
  ) @> (select response - array['session_public_id','revision','manifest_digest'] from m4_consent_receipt),
  'connector receives the exact active owner consent binding'
);
reset role;

set local role service_role;
select lives_ok($$insert into m4_consent_finalization(response)
  select device_adapter.adapter_finalize_import_session_v2(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session),
    'a4200000-0000-4420-8420-000000000303'
  )$$, 'finalization locks active consent and stores one combined response');
select ok(
  (select response ?& array['owner_consent_id','consent_digest','explicit_consent_at','consent_expires_at']
     and response->>'owner_consent_id' = (select response->>'owner_consent_id' from m4_consent_receipt)
     and response->>'consent_digest' ~ '^sha256:[0-9a-f]{64}$'
     and response->>'state' = 'verified'
   from m4_consent_finalization),
  'finalization response stores the owner-consent binding'
);
select is(
  device_adapter.adapter_finalize_import_session_v2(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session),
    'a4200000-0000-4420-8420-000000000303'
  ),
  (select response from m4_consent_finalization),
  'finalization replay returns the stored consent-bearing response'
);
select ok(
  device_adapter.adapter_require_import_cutover_consent(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session)
  ) @> (select response - array['session_public_id','revision','manifest_digest'] from m4_consent_receipt),
  'verified terminal-session recovery can replay the consent bound to the pre-finalize revision'
);
reset role;

update private.import_cutover_consents set revoked_at=pg_catalog.statement_timestamp();
set local role service_role;
select throws_ok($$select device_adapter.adapter_require_import_cutover_consent(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),(select revision from m4_consent_session)
)$$, '42501', 'import cutover consent required', 'revoked consent cannot authorize finalization');
select is(
  device_adapter.adapter_finalize_import_session_v2(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session),
    'a4200000-0000-4420-8420-000000000303'
  ),
  (select response from m4_consent_finalization),
  'idempotent finalization replay remains safe after consent revocation'
);
reset role;

set local role anon;
select throws_ok($$select * from api.my_import_cutover_consents$$, '42501', null, 'anonymous role cannot select consent projection');
reset role;

select * from finish();
rollback;
