begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(33);

select is(
  private.compute_import_content_digest(
    'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    '[{"relative_path":"SKILL.md","media_type":"text/plain","byte_size":3,"file_digest":"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","executable":false,"ordinal":0}]'
  ),
  'sha256:8e63837f60951567b4bf156d4920fb808cc43fc77068ff2db429f7546fc592a6',
  'database content digest encoding matches the accepted Node vector'
);

select has_table('private', 'import_target_preparations', 'target preparation receipt table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'private.import_target_preparations'::regclass),
  'target preparation receipts force RLS'
);
select ok(
  not has_table_privilege('anon', 'private.import_target_preparations', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.import_target_preparations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.import_target_preparations', 'select,insert,update,delete'),
  'application roles have no target preparation table grants'
);
select ok(
  position('4194304' in pg_catalog.pg_get_constraintdef(
    (select oid from pg_catalog.pg_constraint
     where conname = 'import_target_preparations_response_check'
       and conrelid = 'private.import_target_preparations'::regclass)
  )) > 0,
  'target receipts allow the bounded four-MiB maximum response projection'
);
select ok(
  has_function_privilege(
    'service_role',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  ),
  'only service_role can execute target preparation adapter'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4000000-0000-4400-8400-000000000001','authenticated','authenticated','m4-target-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4000000-0000-4400-8400-000000000002','authenticated','authenticated','m4-target-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4000000-0000-4400-8400-000000000101','dev_'||repeat('4',32),'a4000000-0000-4400-8400-000000000001','M4 target','macos','1.0.0','en-US');

create function pg_temp.m4_prepare_target(
  p_account_public_id text,
  p_device_public_id text,
  p_display_name text,
  p_description text,
  p_manifest_schema_version text,
  p_logical_id text,
  p_source jsonb,
  p_provenance_state text,
  p_files jsonb,
  p_idempotency_key uuid
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
    'identity', pg_catalog.jsonb_build_object(
      'logical_id', p_logical_id,
      'public_id', 'fixture.' || pg_catalog.replace(p_logical_id, '-', '_')
    ),
    'display', pg_catalog.jsonb_build_object(
      'name', p_display_name,
      'description', coalesce(p_description, '')
    ),
    'source', p_source,
    'files', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'path', item.value ->> 'relative_path',
          'media_type', item.value ->> 'media_type',
          'utf8_bytes', item.value -> 'byte_size',
          'digest', item.value ->> 'file_digest',
          'executable', item.value -> 'executable'
        ) order by (item.value ->> 'ordinal')::integer
      )
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
    ),
    'provenance', pg_catalog.jsonb_build_object(
      'publisher_id', 'local-owner',
      'ingest_id', 'm4-pgtap',
      'created_at', '2026-08-20T00:00:00.000Z'
    ),
    'compatibility', pg_catalog.jsonb_build_object(
      'manifest_major', 1,
      'minimum_consumer_major', 1
    )
  );
  v_manifest_bytes := pg_catalog.convert_to(private.canonical_managed_import_manifest(v_manifest), 'UTF8');
  v_manifest_digest := 'sha256:' || pg_catalog.encode(extensions.digest(v_manifest_bytes, 'sha256'), 'hex');
  v_metadata := pg_catalog.jsonb_build_object(
    'logical_id', p_logical_id,
    'display_name', pg_catalog.btrim(p_display_name)
  );
  if nullif(pg_catalog.btrim(coalesce(p_description, '')), '') is not null then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object(
      'description', pg_catalog.btrim(p_description)
    );
  end if;
  return device_adapter.adapter_prepare_import_target(
    p_account_public_id, p_device_public_id, p_display_name, p_description,
    p_manifest_schema_version, v_manifest_bytes, v_manifest_digest,
    private.compute_import_content_digest(v_manifest_digest, p_files),
    v_metadata, p_source, p_provenance_state, p_files, p_idempotency_key
  );
end
$function$;

revoke all privileges on function pg_temp.m4_prepare_target(
  text,text,text,text,text,text,jsonb,text,jsonb,uuid
) from public;
grant execute on function pg_temp.m4_prepare_target(
  text,text,text,text,text,text,jsonb,text,jsonb,uuid
) to service_role;

create function pg_temp.m4_valid_manifest()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version', '1.0',
    'identity', pg_catalog.jsonb_build_object('logical_id','contract-case','public_id','fixture.contract_case'),
    'display', pg_catalog.jsonb_build_object('name','Contract Case','description','Contract fixture'),
    'source', pg_catalog.jsonb_build_object(
      'authority','local-owner','kind','skill-directory','namespace','skillmap','source_id','contract-case','revision','r1'
    ),
    'files', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'path','SKILL.md','media_type','text/markdown','utf8_bytes',3,
      'digest','sha256:'||repeat('6',64),'executable',false
    )),
    'provenance', pg_catalog.jsonb_build_object(
      'publisher_id','local-owner','ingest_id','m4-pgtap','created_at','2026-08-20T00:00:00.000Z'
    ),
    'compatibility', pg_catalog.jsonb_build_object('manifest_major',1,'minimum_consumer_major',1)
  );
$function$;

create function pg_temp.m4_prepare_manifest(p_manifest jsonb, p_raw_prefix text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bytes bytea;
  v_digest text;
  v_files jsonb;
  v_metadata jsonb;
begin
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'relative_path', item.value ->> 'path',
    'media_type', item.value ->> 'media_type',
    'byte_size', item.value -> 'utf8_bytes',
    'file_digest', item.value ->> 'digest',
    'executable', item.value -> 'executable',
    'ordinal', item.ordinality - 1
  ) order by item.ordinality)
  into v_files
  from pg_catalog.jsonb_array_elements(coalesce(p_manifest -> 'files', '[]'::jsonb))
    with ordinality as item(value, ordinality);

  v_bytes := pg_catalog.convert_to(
    coalesce(p_raw_prefix, '') || private.canonical_managed_import_manifest(p_manifest), 'UTF8'
  );
  v_digest := 'sha256:' || pg_catalog.encode(extensions.digest(v_bytes, 'sha256'), 'hex');
  v_metadata := pg_catalog.jsonb_build_object(
    'logical_id', p_manifest #>> '{identity,logical_id}',
    'display_name', p_manifest #>> '{display,name}',
    'description', p_manifest #>> '{display,description}'
  );

  return device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    p_manifest #>> '{display,name}',p_manifest #>> '{display,description}',p_manifest ->> 'schema_version',
    v_bytes,v_digest,private.compute_import_content_digest(v_digest,v_files),
    v_metadata,p_manifest -> 'source','verified',v_files,p_idempotency_key
  );
end
$function$;

revoke all privileges on function pg_temp.m4_valid_manifest() from public;
revoke all privileges on function pg_temp.m4_prepare_manifest(jsonb,text,uuid) from public;
grant execute on function pg_temp.m4_valid_manifest() to service_role;
grant execute on function pg_temp.m4_prepare_manifest(jsonb,text,uuid) to service_role;

create temporary table m4_target_receipt(response jsonb not null) on commit drop;
create temporary table m4_target_revision(response jsonb not null) on commit drop;
grant select, insert on m4_target_receipt, m4_target_revision to service_role;

set local role service_role;
select lives_ok($$insert into m4_target_receipt(response)
  select pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001',
    'dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0','alpha',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301'
  )$$, 'valid target preparation succeeds');
reset role;

set local role service_role;
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_temp.m4_valid_manifest() - 'provenance','',
  'a4000000-0000-4400-8400-000000000311'
)$$, 22023, 'invalid canonical import manifest', 'a manifest missing provenance is rejected');
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_catalog.jsonb_set(pg_temp.m4_valid_manifest(),'{identity}',
    (pg_temp.m4_valid_manifest()->'identity') - 'public_id'),'',
  'a4000000-0000-4400-8400-000000000312'
)$$, 22023, 'invalid canonical import manifest', 'a manifest missing identity.public_id is rejected');
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_catalog.jsonb_set(pg_temp.m4_valid_manifest(),'{schema_version}','"2.0"'::jsonb),'',
  'a4000000-0000-4400-8400-000000000313'
)$$, 22023, 'invalid canonical import manifest', 'an unsupported manifest major is rejected');
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_temp.m4_valid_manifest() || '{"unexpected":true}'::jsonb,'',
  'a4000000-0000-4400-8400-000000000314'
)$$, 22023, 'invalid canonical import manifest', 'an unknown top-level manifest property is rejected');
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_temp.m4_valid_manifest(),' ',
  'a4000000-0000-4400-8400-000000000315'
)$$, 22023, 'invalid canonical import manifest', 'noncanonical manifest bytes are rejected even when their digest matches');
reset role;

set local role service_role;
select lives_ok($$select pg_temp.m4_prepare_manifest(
  pg_catalog.jsonb_set(
    pg_temp.m4_valid_manifest(),
    '{display,description}',
    pg_catalog.to_jsonb(repeat(U&'\00E9', 2048))
  ),
  '',
  'a4000000-0000-4400-8400-000000000316'
)$$, 'a 2048-code-point multibyte description is accepted');
select throws_ok($$select pg_temp.m4_prepare_manifest(
  pg_catalog.jsonb_set(
    pg_temp.m4_valid_manifest(),
    '{display,description}',
    pg_catalog.to_jsonb(repeat(U&'\00E9', 2049))
  ),
  '',
  'a4000000-0000-4400-8400-000000000317'
)$$, 22023, 'invalid canonical import manifest',
  'a 2049-code-point multibyte description is rejected');
reset role;

-- The accepted boundary probe writes a real immutable version. Remove only
-- that exact disposable fixture so the later cardinality assertions retain
-- their original one-target contract.
delete from private.managed_skills
where account_id = 'a4000000-0000-4400-8400-000000000001'
  and display_name = 'Contract Case';

select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0',
    (select manifest_projection from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'),
    (select manifest_digest from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'),
    (select content_digest from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"CHANGED.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000307'
  )$$, 22023, 'import target projection does not match canonical manifest',
  'independent file parameters cannot diverge from the hash-bound canonical manifest');
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0',
    (select manifest_projection from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'),
    (select manifest_digest from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'),
    'sha256:'||repeat('0',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000308'
  )$$, 22023, 'import content digest does not match canonical projection',
  'caller-supplied content digests must match the exact manifest and file envelope');

select ok(
  (select response ?& array['skill_public_id','version_public_id','release_public_id','manifest_digest','content_digest','file_count','byte_total','reused','files']
     and not response ?| array['account_id','device_id','managed_skill_id','version_id','storage_root']
   from m4_target_receipt),
  'target response is a closed public projection'
);
select is((select count(*) from private.managed_skills where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one managed skill is created');
select is((select count(*) from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one immutable version is created');
select is((select count(*) from private.managed_skill_files where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one immutable file row is created');
select ok(
  (select lifecycle_state='needs-review' and eligibility_reasons=array['analysis_pending']::text[]
   from private.managed_skill_releases where account_id='a4000000-0000-4400-8400-000000000001'),
  'prepared target remains non-active and needs review'
);
select is((select count(*) from private.import_target_preparations), 1::bigint, 'one device-scoped idempotency receipt is stored');

set local role service_role;
select is(
  pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0','alpha',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301'
  ),
  (select response from m4_target_receipt),
  'exact idempotency replay returns the same response'
);
select throws_ok($$select pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Changed Name','Bounded import target','1.0','alpha',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301')$$,
  22023, 'conflicting import target idempotency reuse', 'changed idempotent request conflicts');
select ok(
  pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0','alpha',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000302'
  ) @> '{"reused":true}'::jsonb,
  'a new request exactly reuses the immutable manifest identity without duplicating the skill'
);
select lives_ok($$insert into m4_target_revision(response)
  select pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha v2','Changed immutable version','1.1','alpha',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r2"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":4,"file_digest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000304'
  )$$, 'changed content for one logical skill creates a new immutable version');
reset role;
select ok(
  (select revision.response->>'skill_public_id' = original.response->>'skill_public_id'
      and revision.response->>'version_public_id' <> original.response->>'version_public_id'
   from m4_target_revision as revision cross join m4_target_receipt as original)
  and (select count(*) from private.managed_skills where account_id='a4000000-0000-4400-8400-000000000001') = 1
  and (select count(*) from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001') = 2,
  'logical identity stays stable while immutable version history grows'
);
set local role service_role;
select lives_ok($$select pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    repeat('N',200),null,'1.2','name-bound',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"name-bound","revision":"r1"}',
    'verified','[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":1,"file_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000305')$$,
  'a 200-character display name is accepted end to end');
select throws_ok($$select pg_temp.m4_prepare_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    repeat('N',201),null,'1.0','name-bound-oversize',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"name-bound-oversize","revision":"r1"}',
    'verified','[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":1,"file_digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000306')$$,
  22023, 'invalid canonical import manifest', 'a 201-character display name is rejected');
select throws_ok($$
  with inputs as (
    select
      pg_catalog.jsonb_build_object(
        'schema_version', '1.0',
        'identity', pg_catalog.jsonb_build_object('logical_id', 'empty-canonical', 'public_id', 'fixture.empty_canonical'),
        'display', pg_catalog.jsonb_build_object('name', 'Empty Canonical', 'description', ''),
        'source', pg_catalog.jsonb_build_object(
          'authority', 'local-owner', 'kind', 'skill-directory', 'namespace', 'skillmap',
          'source_id', 'empty-canonical', 'revision', 'r1'
        ),
        'files', '[]'::jsonb,
        'provenance', pg_catalog.jsonb_build_object(
          'publisher_id', 'local-owner', 'ingest_id', 'm4-pgtap', 'created_at', '2026-08-20T00:00:00.000Z'
        ),
        'compatibility', pg_catalog.jsonb_build_object('manifest_major', 1, 'minimum_consumer_major', 1)
      ) as manifest,
      '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":1,"file_digest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","executable":false,"ordinal":0}]'::jsonb as files
  ), encoded as (
    select pg_catalog.convert_to(manifest::text, 'UTF8') as bytes, manifest, files
    from inputs
  ), hashed as (
    select bytes, manifest, files,
      'sha256:' || pg_catalog.encode(extensions.digest(bytes, 'sha256'), 'hex') as manifest_digest
    from encoded
  )
  select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Empty Canonical',null,'1.0',bytes,manifest_digest,
    'sha256:'||repeat('d',64),
    '{"logical_id":"empty-canonical","display_name":"Empty Canonical"}',
    manifest -> 'source','verified',files,'a4000000-0000-4400-8400-000000000309'
  )
  from hashed
$$, 22023, 'invalid canonical import manifest',
  'an empty canonical file list cannot accept a non-empty caller projection');
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_b4000000000044008400000000000002','dev_'||repeat('4',32),
    'Foreign','x','1.0',pg_catalog.convert_to('{}','UTF8'),
    'sha256:'||repeat('0',64),'sha256:'||repeat('0',64),
    '{}','{}','verified','[]','b4000000-0000-4400-8400-000000000301')$$,
  '42501', 'import authority unavailable', 'foreign account cannot use another account device context');
reset role;
update private.devices
set state='revoked', revoked_at=pg_catalog.statement_timestamp(), revision=revision+1
where id='a4000000-0000-4400-8400-000000000101';
set local role service_role;
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Inactive','x','1.0',pg_catalog.convert_to('{}','UTF8'),
    'sha256:'||repeat('0',64),'sha256:'||repeat('0',64),
    '{}','{}','verified','[]','a4000000-0000-4400-8400-000000000303')$$,
  '42501', 'import authority unavailable', 'revoked device cannot prepare an import target');
select throws_ok($$select * from private.import_target_preparations$$, '42501', null, 'service role cannot list private target receipts');
reset role;

select * from finish();
rollback;
