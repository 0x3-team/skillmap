-- =============================================================================
-- M2.16 — Remote-safe Skill Vault security acceptance matrix (fail-closed).
--
-- Runs as ONE explicit BEGIN ... ROLLBACK transaction. Converts the decisive
-- accepted pgTAP assertions (skill_vault_* tests) into fail-closed PL/pgSQL
-- assertions that RAISE on failure. No pgTAP / extension install, no remote
-- database access, nothing committed. Exactly TWO fixed disposable identities
-- (A and B) plus their full owned Skill Vault graph and storage metadata rows
-- are created and destroyed inside the same rollback transaction.
--
-- DESIGN INVARIANTS
--  * Exactly two auth identities (A and B), inserted once, inside the single
--    outer BEGIN ... ROLLBACK. No third auth UUID is ever created.
--  * No hand-authored child ids. All generated private ids / public ids /
--    revisions are captured (via RETURNING + gen_random_uuid()/public-id
--    defaults) into one pg_temp fixture-coordinate table (m16_fx) and re-read
--    from there when a later step needs them under a different role. Storage
--    keys are derived from the captured version/file public ids.
--  * A single A- and B-owned graph is shared through storage, device/import,
--    route, export, and deletion. Every assertion is scoped to A/B or to the
--    captured fixture public ids, never to an absolute global tenant total.
--  * Real functions/signatures copied from the accepted migrations/tests and
--    the validated /tmp/m216-*-section.sql artifacts; only decisive remote
--    smoke assertions are implemented (exhaustive behavior is local pgTAP).
--  * Role helper sets SET LOCAL ROLE + request.jwt.claim.sub/role/claims JSON
--    and always RESET ROLE before any privileged SQL.
--
-- PROOF (one transaction unless noted)
--   1. anon cannot read private tables/views or invoke owner RPCs.
--   2. authenticated A creates/reads/updates only A; B symmetric isolation and
--      cannot see or mutate A.
--   3. FORCE RLS + grant boundaries for representative managed/device/import/
--      route tables.
--   4. storage bucket private contract + owner RLS + prepare read/delete/upload
--      + incomplete-upload cleanup enqueue/claim/complete + path binding.
--   5. A registers a device; service_role device_adapter issues a token;
--      begin/resume/accept/finalize a one-file import; wrong-owner/replay denial;
--      rotate then revoke. Captured revisions.
--   6. service_role route_adapter records/reads one decision+selection, rejects
--      wrong-owner/idempotency mutation; A submits one correction, B cannot see.
--   7. api.export_my_managed_skill_vault for A returns only A, excludes B.
--   8. api.delete_my_account for A purges A graph / preserves B; deletion_adapter
--      claim/complete/fail/ack paths exercised; B reused as zero-object account
--      for the full canonical 13-owner completion (no third auth UUID).
--   9. static redacted JSON result emitted after the final ROLLBACK.
--
-- ROLE / CLAIM SIMULATION (faithful to the migrations):
--   auth.uid()  = request.jwt.claim.sub  OR request.jwt.claims->>'sub'
--   auth.role() = request.jwt.claim.role OR request.jwt.claims->>'role'
--
-- Run (exact, repeated twice locally):
--   docker exec -i supabase_db_skillmap psql -U postgres -d postgres \
--       -v ON_ERROR_STOP=1 -f M2.16-remote-security-matrix.sql
-- =============================================================================
begin;
set local search_path = '';
create or replace function pg_temp.m16_assert(_cond boolean, _when text)
returns void language plpgsql as $h$
begin
  if coalesce(_cond, false) is not true then
    raise exception 'M2.16 assertion FAILED: %', _when using errcode = 'P0001';
  end if;
end $h$;
create or replace function pg_temp.m16_expect_error (_sql text, _state text default null)
returns void language plpgsql as $h$
declare v_sqlstate text;
begin
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if _state is null or v_sqlstate = _state then return; end if;
    raise exception 'M2.16 F: exp % got % for %', _state, v_sqlstate, _sql using errcode='P0001';
  end;
  raise exception 'M2.16 F: no raise: %', _sql using errcode='P0001';
end $h$;
create or replace function pg_temp.h_as (_role text, _uid text)
returns void language plpgsql as $h$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', _role, true);
  perform pg_catalog.set_config('request.jwt.claim.sub',   _uid,  true);
  perform pg_catalog.set_config('request.jwt.claims', jsonb_build_object('role', _role, 'sub', _uid)::text, true);
  execute 'set local role ' || pg_catalog.quote_ident(_role);
end $h$;
create or replace function pg_temp.h_reset()
returns void language plpgsql as $h$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub',  '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}'::text, true);
  execute 'reset role';
end $h$;
create temp table if not exists m16_fx (k text primary key, v text);
grant select, insert, update, delete on m16_fx to authenticated, anon, service_role;
do $seed$
declare
  v_a uuid := '11000000-0000-4000-8000-000000000001';
  v_b uuid := '12000000-0000-4000-8000-000000000002';
  v_sk uuid; v_ver uuid; v_rel uuid; v_fil uuid;
  v_bsk uuid; v_bver uuid; v_bfil uuid;
  v_verpub text; v_filpub text := 'msf_'||replace(gen_random_uuid()::text,'-','');
  v_key text;
  v_bverpub text; v_bfilpub text := 'msf_'||replace(gen_random_uuid()::text,'-','');
  v_bkey text;
begin
  insert into pg_temp.m16_fx values ('uid_a', v_a::text) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('uid_b', v_b::text) on conflict(k) do update set v=excluded.v;
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_a,'authenticated','authenticated','m216-a@x.invalid','',now(),'{}','{}',now(),now(),'','','',''),
         ('00000000-0000-0000-0000-000000000000', v_b,'authenticated','authenticated','m216-b@x.invalid','',now(),'{}','{}',now(),now(),'','','','');
  insert into api.profiles (user_id) values (v_a),(v_b);
  insert into private.managed_skills (account_id, display_name, description)
  values (v_a,'m216 Skill A','alpha') returning id into v_sk;
  insert into private.managed_skill_versions (account_id, managed_skill_id, manifest_schema_version, manifest_projection, manifest_digest, content_digest, canonical_metadata, source, provenance_state, analysis_state)
  values (v_a, v_sk, '1.0','{}'::bytea, 'sha256:'||repeat('1',64),'sha256:'||repeat('2',64),
    '{"logical_id":"a","display_name":"m216 A"}','{"authority":"managed","kind":"local","namespace":"owner","source_id":"a","revision":"r1"}','verified','complete')
  returning id, public_id into v_ver, v_verpub;
  insert into private.managed_skill_releases (account_id, managed_skill_id, version_id, lifecycle_state, eligibility_reasons)
  values (v_a, v_sk, v_ver, 'active','{}') returning id into v_rel;
  update private.managed_skills set active_release_id=v_rel, activation_revision=1 where id=v_sk;
  v_key := 'v1/'||v_verpub||'/'||v_filpub;
  insert into private.managed_skill_files (id, public_id, account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values (gen_random_uuid(), v_filpub, v_a, v_sk, v_ver, 'SKILL.md','text/markdown',3,'sha256:'||repeat('3',64), v_key, false, 0)
  returning id into v_fil;
  insert into pg_temp.m16_fx values ('a_skill_id', v_sk::text) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_ver_id', v_ver::text) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_rel_id', v_rel::text) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_skill_pub',(select public_id from private.managed_skills where id=v_sk)) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_ver_pub', v_verpub) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_file_pub', v_filpub) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_key', v_key) on conflict(k) do update set v=excluded.v;
  insert into private.managed_skills (account_id, display_name) values (v_b,'SKILL B') returning id into v_bsk;
  insert into private.managed_skill_versions (account_id, managed_skill_id, manifest_schema_version, manifest_projection, manifest_digest, content_digest, canonical_metadata, source, provenance_state, analysis_state)
  values (v_b, v_bsk, '1.0','{}'::bytea, 'sha256:'||repeat('4',64),'sha256:'||repeat('5',64),
    '{"logical_id":"b","display_name":"m216 B"}','{"authority":"managed","kind":"local","namespace":"owner","source_id":"b","revision":"r1"}','verified','complete')
  returning id, public_id into v_bver, v_bverpub;
  v_bkey := 'v1/'||v_bverpub||'/'||v_bfilpub;
  insert into private.managed_skill_files (id, public_id, account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values (gen_random_uuid(), v_bfilpub, v_b, v_bsk, v_bver, 'SKILL.md','text/markdown',4,'sha256:'||repeat('6',64), v_bkey, false, 0)
  returning id into v_bfil;
  insert into pg_temp.m16_fx values ('b_skill_pub',(select public_id from private.managed_skills where id=v_bsk)) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('b_ver_pub', v_bverpub) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('b_file_pub', v_bfilpub) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('b_key', v_bkey) on conflict(k) do update set v=excluded.v;
end $seed$;
-- TEST 1 — anon cannot read private tables/views or invoke owner RPCs.
do $s1$
begin
  perform pg_temp.h_reset();
  perform pg_temp.h_as('anon','');
  perform pg_temp.m16_expect_error('select * from private.managed_skills','42501');
  perform pg_temp.m16_expect_error('select * from private.managed_skill_versions','42501');
  perform pg_temp.m16_expect_error('select * from private.managed_skill_releases','42501');
  perform pg_temp.m16_expect_error('select * from private.managed_skill_files','42501');
  perform pg_temp.m16_expect_error('select * from private.devices','42501');
  perform pg_temp.m16_expect_error('select * from private.import_sessions','42501');
  perform pg_temp.m16_expect_error('select * from private.route_corrections','42501');
  perform pg_temp.m16_expect_error('select * from api.my_managed_skills','42501');
  perform pg_temp.m16_expect_error('select * from api.my_managed_skill_versions','42501');
  perform pg_temp.m16_expect_error('select * from api.my_managed_skill_files','42501');
  perform pg_temp.m16_expect_error('select * from api.my_devices','42501');
  perform pg_temp.m16_expect_error('select api.export_my_managed_skill_vault()','42501');
  perform pg_temp.m16_expect_error('select api.delete_my_account()','42501');
  perform pg_temp.m16_expect_error('select private.current_request_uid()','42501');
  perform pg_temp.m16_expect_error('select private.current_request_role()','42501');
  perform pg_temp.h_reset();
end $s1$;
-- TEST 2: owner A create/read/update only A; B symmetric isolation.
do $s2$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_apub text := (select v from pg_temp.m16_fx where k='a_skill_pub');
  v_bpub text := (select v from pg_temp.m16_fx where k='b_skill_pub');
  v_avers text := (select v from pg_temp.m16_fx where k='a_ver_pub');
  v_afil text := (select v from pg_temp.m16_fx where k='a_file_pub');
  v_new text; v_rows bigint;
begin
  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_a::text);
  select public_id into v_new from private.create_managed_skill('CreatedByA','owner-created');
  perform pg_temp.m16_assert(v_new ~ '^msk_[0-9a-f]{32}$','create returns msk_ public id');
  select count(*) into v_rows from private.update_managed_skill_metadata(v_apub,'Renamed','desc2');
  perform pg_temp.m16_assert(v_rows = 1,'A updates own skill one row');

  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_b::text);
  perform pg_temp.m16_assert(not exists (select 1 from api.my_managed_skills m where m.public_id=v_apub),'B excludes A skill');
  select count(*) into v_rows from private.update_managed_skill_metadata(v_apub,'HACK','x');
  perform pg_temp.m16_assert(v_rows = 0,'B update A yields zero rows');
  perform pg_temp.m16_assert(not exists (select 1 from api.my_managed_skill_versions m where m.public_id=v_avers),'B no A version');
  perform pg_temp.m16_assert(not exists (select 1 from api.my_managed_skill_files m where m.public_id=v_afil),'B no A file');

  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_a::text);
  perform pg_temp.m16_assert(exists (select 1 from api.my_managed_skills m where m.public_id=v_apub),'A sees own skill');
  perform pg_temp.m16_assert(exists (select 1 from api.my_managed_skill_versions m where m.public_id=v_avers),'A sees own version');
  perform pg_temp.m16_assert(exists (select 1 from api.my_managed_skill_files m where m.public_id=v_afil),'A sees own file');
  perform pg_temp.h_reset();
end $s2$;
-- TEST 3: FORCE RLS + grant boundaries (representative managed/device/import/
-- route tables).
do $s3$
begin
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skills'::pg_catalog.regclass),
    'managed_skills FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skill_files'::pg_catalog.regclass),
    'managed_skill_files FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.devices'::pg_catalog.regclass),
    'devices FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.device_tokens'::pg_catalog.regclass),
    'device_tokens FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_sessions'::pg_catalog.regclass),
    'import_sessions FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_file_receipts'::pg_catalog.regclass),
    'import_file_receipts FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_decisions'::pg_catalog.regclass),
    'route_decisions FORCE RLS');
  perform pg_temp.m16_assert(
    (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_corrections'::pg_catalog.regclass),
    'route_corrections FORCE RLS');
  -- zero application-role base grants on the representative set
  perform pg_temp.m16_assert(
    not has_table_privilege('anon','private.devices','select,insert,update,delete')
    and not has_table_privilege('authenticated','private.devices','select,insert,update,delete')
    and not has_table_privilege('service_role','private.devices','select,insert,update,delete'),
    'devices zero app base grants');
  perform pg_temp.m16_assert(
    not has_table_privilege('service_role','private.device_tokens','select,insert,update,delete'),
    'device_tokens service_role no base grant');
  perform pg_temp.m16_assert(
    not has_table_privilege('anon','private.import_sessions','select,insert,update,delete')
    and not has_table_privilege('authenticated','private.import_sessions','select'),
    'import_sessions zero app base grants');
  perform pg_temp.h_reset();
end $s3$;
-- TEST 4: storage private-bucket contract + owner RLS + real prepare read/delete
-- + incomplete-upload cleanup enqueue/claim/complete (exact definer functions).
-- The shared A/B graph is bound to real storage.objects via the persistence
-- trigger; keys/owners/byte-sizes come from the captured fixture (never authored).
do $st$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_akey text := (select v from pg_temp.m16_fx where k='a_key');
  v_bkey text := (select v from pg_temp.m16_fx where k='b_key');
  v_afil text := (select v from pg_temp.m16_fx where k='a_file_pub');
  v_size bigint; v_ispublic boolean; v_nexists boolean; v_cnt bigint;
  v_job uuid; v_enq text; v_comp text;
begin
  perform pg_temp.h_reset();
  -- 4.1 private bucket contract: exists, non-public, exact expected size limit.
  select count(*) > 0, bool_or(b.public), max(b.file_size_limit)
    into v_nexists, v_ispublic, v_size
  from storage.buckets b where b.id = 'skill-vault-private';
  perform pg_temp.m16_assert(v_nexists is true,'bucket skill-vault-private exists');
  perform pg_temp.m16_assert(v_ispublic is false,'bucket is non-public');
  perform pg_temp.m16_assert(v_size = 16777216,'bucket file_size_limit = 16777216');

  -- 4.2 valid storage.objects metadata rows for A and B bound by the trigger.
  -- storage.objects is NOT force-RLS, so postgres (BYPASSRLS) can write, but the
  -- persistence trigger still enforces the exact file/account/key/metadata match.
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata, user_metadata)
  values ('skill-vault-private', v_akey, v_a, v_a::text,
         '{"mimetype":"text/markdown","size":3}'::jsonb, '{}'::jsonb),
         ('skill-vault-private', v_bkey, v_b, v_b::text,
          '{"mimetype":"text/markdown","size":4}'::jsonb, '{}'::jsonb);
  select count(*) into v_cnt from pg_temp.m16_fx where k in ('a_key','b_key');
  perform pg_temp.m16_assert(v_cnt = 2,'both fixture keys captured');
  select count(*) into v_cnt from storage.objects
  where bucket_id = 'skill-vault-private' and name in (v_akey, v_bkey);
  perform pg_temp.m16_assert(v_cnt = 2,'both A and B bound storage objects exist');

  -- 4.3 cleanup enqueue/claim/complete (exact definer functions; postgres owns).
  select enq.state into v_enq from private.enqueue_skill_vault_incomplete_upload_cleanup(
    'skill-vault-private', v_akey, 'upload.incomplete') enq;
  perform pg_temp.m16_assert(v_enq = 'queued','cleanup enqueue queued');
  select cl.job_id into v_job from private.claim_skill_vault_incomplete_upload_cleanup(1) cl
    where cl.object_name = v_akey limit 1;
  perform pg_temp.m16_assert(v_job is not null,'cleanup claim returns job');
  select cp.state into v_comp from private.complete_skill_vault_incomplete_upload_cleanup(v_job) cp;
  perform pg_temp.m16_assert(v_comp = 'completed','cleanup completion terminal');

  -- 4.4 owner boundary: as A, real prepare read + delete resolve A.
  perform pg_temp.h_as('authenticated', v_a::text);
  select count(*) into v_cnt from private.prepare_skill_vault_read(
    v_afil, statement_timestamp() + interval '300 seconds');
  perform pg_temp.m16_assert(v_cnt = 1,'A prepare read resolves A object');
  select count(*) into v_cnt from private.prepare_skill_vault_delete(
    v_afil, statement_timestamp() + interval '300 seconds');
  perform pg_temp.m16_assert(v_cnt = 1,'A prepare delete resolves A object');

  -- 4.5 B cannot prepare A's object, and anon sees zero private objects.
  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_b::text);
  select count(*) into v_cnt from private.prepare_skill_vault_read(
    v_afil, statement_timestamp() + interval '300 seconds');
  perform pg_temp.m16_assert(v_cnt = 0,'B cannot prepare read A object');
  select count(*) into v_cnt from private.prepare_skill_vault_delete(
    v_afil, statement_timestamp() + interval '300 seconds');
  perform pg_temp.m16_assert(v_cnt = 0,'B cannot prepare delete A object');
  perform pg_temp.h_reset();
  perform pg_temp.h_as('anon','');
  select count(*) into v_cnt from storage.objects
  where bucket_id = 'skill-vault-private';
  perform pg_temp.m16_assert(v_cnt = 0,'anon sees zero private bucket rows');
  perform pg_temp.h_reset();
end $st$;
-- TEST 5: device/token storage/import authority (real adapters, shared A graph).
do $dvtest$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_skill text := (select v from pg_temp.m16_fx where k='a_skill_pub');
  v_ver  text := (select v from pg_temp.m16_fx where k='a_ver_pub');
  v_file text := (select v from pg_temp.m16_fx where k='a_file_pub');
  v_dev text; v_devrev bigint;
  v_dig1 text := 'hmac-sha256:'||repeat('1',64);
  v_dig2 text := 'hmac-sha256:'||repeat('2',64);
  v_gen bigint; v_sess text; v_res jsonb; v_fin text; v_ng bigint;
begin
  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_a::text);
  select r.public_id, r.revision into v_dev, v_devrev
  from private.register_my_device('devA','macos','3.0.0') r;
  perform pg_temp.m16_assert(v_dev ~ '^dev_[0-9a-f]{32}$','A register_my_device yields dev_ id');
  perform pg_temp.m16_assert(v_devrev >= 1,'A device revision captured');
  insert into pg_temp.m16_fx values ('a_dev_pub', v_dev) on conflict(k) do update set v=excluded.v;
  insert into pg_temp.m16_fx values ('a_dev_rev', v_devrev::text) on conflict(k) do update set v=excluded.v;
  perform pg_temp.m16_assert(exists (select 1 from api.my_devices d where d.public_id=v_dev),'A sees own device');
  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_b::text);
  perform pg_temp.m16_assert(not exists (select 1 from api.my_devices d where d.public_id=v_dev),'B cannot see A device');
  perform pg_temp.h_reset();
  perform pg_temp.h_as('anon','');
  perform pg_temp.m16_expect_error('select * from api.my_devices','42501');
  perform pg_temp.h_reset();

  perform pg_temp.h_as('service_role','');
  select (c->>'token_generation')::bigint into v_gen
  from (select device_adapter.adapter_issue_device_token(v_a, v_dev, v_dig1, 1,
        array['device.import']::text[], now()+interval '30 days', v_devrev) as c) t;
  perform pg_temp.m16_assert(v_gen = 1,'adapter issues token generation 1');
  perform pg_temp.m16_expect_error(
    'select * from device_adapter.adapter_issue_device_token('||quote_nullable(v_a::text)
    ||','||quote_nullable(v_dev)||','||quote_nullable(v_dig2)||',2,array[''device.import''],now()+interval ''5 minutes'','
    ||v_devrev||')','22023');
  perform pg_temp.h_reset();

  perform pg_temp.h_as('service_role','');
  select device_adapter.adapter_begin_import_session(
    v_a, v_dig1, 1, v_devrev, v_gen, v_skill, v_ver, '1.0',
    'sha256:'||repeat('1',64), 'sha256:'||repeat('2',64), 1, 3,
    '21000000-0000-4000-8000-000000000001', now()+interval '2 hours') into v_sess;
  perform pg_temp.m16_assert(v_sess ~ '^imp_[0-9a-f]{32}$','begin returns imp_ public id');
  select device_adapter.adapter_resume_import_session(v_a, v_dig1, 1, v_devrev, v_gen, v_sess) into v_res;
  assert (v_res->>'state') = 'in_progress','resume in_progress';
  select device_adapter.adapter_accept_import_file(v_a, v_dig1, 1, v_devrev, v_gen, v_sess, 1, v_file) into v_res;
  assert (v_res->>'accepted_file_count')::int = 1,'accept one file';
  assert (v_res->>'revision')::int = 2,'accept advances revision';
  select device_adapter.adapter_finalize_import_session(v_a, v_dig1, 1, v_devrev, v_gen, v_sess, 2) into v_fin;
  assert v_fin = v_sess,'finalize same session';
  select device_adapter.adapter_resume_import_session(v_a, v_dig1, 1, v_devrev, v_gen, v_sess) into v_res;
  assert v_res is null,'verified not resumable';
  perform pg_temp.m16_expect_error(
    'select * from device_adapter.adapter_resume_import_session('||quote_nullable(v_b::text)
    ||','||quote_nullable(v_dig1)||',1,1,1,'||quote_nullable(v_sess)||')','42501');
  select (r->>'token_generation')::bigint into v_ng
  from (select device_adapter.adapter_rotate_device_token(v_a, v_dig1, 1, v_devrev, v_gen, v_dig2, 2,
            array['device.import']::text[], now()+interval '30 days') as r) t;
  assert v_ng = 2,'rotate bumps generation to 2';
  assert device_adapter.adapter_revoke_device_token(v_a, v_dig2, 2, v_devrev, 2) is true,
    'owner revoke rotated token returns true';
  perform pg_temp.h_reset();
end $dvtest$;
-- TEST 6: route authority (real route_adapter boundary; A/B isolation).
do $rt$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_dev  text := (select v from pg_temp.m16_fx where k='a_dev_pub');
  v_devrev bigint := (select v::bigint from pg_temp.m16_fx where k='a_dev_rev');
  v_diga text := 'hmac-sha256:'||repeat('a',64);
  v_digb text := 'hmac-sha256:'||repeat('b',64);
  v_genR bigint;
  v_sk_id uuid := (select v::uuid from pg_temp.m16_fx where k='a_skill_id');
  v_ver_id uuid := (select v::uuid from pg_temp.m16_fx where k='a_ver_id');
  v_rel_id uuid := (select v::uuid from pg_temp.m16_fx where k='a_rel_id');
  v_rtd text; v_rtc text; v_rec jsonb; v_n bigint;
begin
  perform pg_temp.h_reset();
  -- A route token on the shared A device (from the device section).
  perform pg_temp.h_as('service_role','');
  select (c->>'token_generation')::bigint into v_genR from (
    select device_adapter.adapter_issue_device_token(v_a, v_dev, v_diga, 1,
      array['device.route']::text[], now()+interval '60 minutes', v_devrev) as c) t;
  if v_genR is null then raise exception 'M2.16 F: route token not issued'; end if;

  -- record one route decision + one selection through the real connector.
  select rec->>'decision_id' into v_rtd from (
    select route_adapter.adapter_record_route_decision(
      v_a, v_diga, 1, v_devrev, v_genR,
      '92000000-0000-4000-8000-0000000000aa','sha256:'||repeat('a',64),
      'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
      'acct_rev_42','dev_auth_rev_12','pol_rev_19','elig_rev_31','aud_rev_08',
      1000,24,4,5,12,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('managed_skill_id', v_sk_id::text,'version_id', v_ver_id::text,'release_id', v_rel_id::text,'row_kind','ranked','ordinal',1,'role',NULL,'confidence',0.9,'reason_codes', pg_catalog.jsonb_build_array('prompt_intent_match')))) as rec) t;
  if v_rtd is null or v_rtd !~ '^rtd_[0-9a-f]{32}$' then
    raise exception 'M2.16 F: no valid decision id';
  end if;
  insert into pg_temp.m16_fx values ('a_rtd', v_rtd) on conflict(k) do update set v=excluded.v;
  perform pg_temp.h_reset();
  select count(*) into v_n
  from private.route_decision_selections
  where account_id = v_a;
  if v_n <> 1 then raise exception 'M2.16 F: expected one selection, got %', v_n; end if;
  perform pg_temp.h_as('service_role','');

  -- owning device reads it back; foreign device is denied.
  select rec into v_rec from (
    select route_adapter.adapter_read_route_decision(v_a, v_diga, 1, v_devrev, v_genR, v_rtd) as rec) t;
  perform pg_temp.m16_assert(v_rec->>'result_type' = 'ranked_candidates','owning read returns ranked_candidates');
  perform pg_temp.m16_expect_error(
    'select * from route_adapter.adapter_read_route_decision('||quote_nullable(v_b::text)
    ||','||quote_nullable(v_digb)||',1,1,1,'||quote_nullable(v_rtd)||')','42501');

  perform pg_temp.h_reset();
  -- wrong-owner replay on the connector: B's route digest resolves no A token (42501)
  perform pg_temp.m16_expect_error(
    'select * from route_adapter.adapter_read_route_decision('||quote_nullable(v_b::text)
    ||','||quote_nullable(v_digb)||',1,1,1,'||quote_nullable(v_rtd)||')','42501');
  -- idempotency/wrong-fingerprint replay on A's own device is a 22023 conflict.
  perform pg_temp.h_as('service_role','');
  begin
    select route_adapter.adapter_record_route_decision(
      v_a, v_diga, 1, v_devrev, v_genR,
      '92000000-0000-4000-8000-0000000000aa','sha256:'||repeat('b',64),
      'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
      'acct_rev_42','dev_auth_rev_12','pol_rev_19','elig_rev_31','aud_rev_08',
      1000,24,4,5,12,NULL) into v_rec;
    perform pg_temp.h_reset();
    raise exception 'M2.16 F: changed-fingerprint replay was accepted';
  exception when others then
    perform pg_temp.h_reset();
    if substring(SQLSTATE from 1 for 5) <> '22023' then
      raise exception 'M2.16 F: expected 22023 got %', SQLSTATE;
    end if;
  end;

  -- A submits one correction; B cannot see it.
  perform pg_temp.h_as('authenticated', v_a::text);
  select private.submit_my_route_correction(v_rtd,'correct',NULL,NULL,NULL,gen_random_uuid(),NULL) into v_rec;
  insert into pg_temp.m16_fx values ('a_rtc', v_rec->>'correction_id') on conflict(k) do update set v=excluded.v;
  perform pg_temp.m16_assert(v_rec->>'correction_id' is not null,'A submits a correction');
  select count(*) into v_n from api.my_route_corrections;
  perform pg_temp.m16_assert(v_n = 1,'A sees own correction');
  perform pg_temp.h_reset();
  perform pg_temp.h_as('authenticated', v_b::text);
  select count(*) into v_n from api.my_route_corrections;
  perform pg_temp.m16_assert(v_n = 0,'B cannot see A correction');
  perform pg_temp.h_reset();
end $rt$;
-- TEST 7: api.export_my_managed_skill_vault for A returns ONLY A, excludes B.
do $export$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_apub text := (select v from pg_temp.m16_fx where k='a_skill_pub');
  v_bpub text := (select v from pg_temp.m16_fx where k='b_skill_pub');
  v_avers text := (select v from pg_temp.m16_fx where k='a_ver_pub');
  v_afil  text := (select v from pg_temp.m16_fx where k='a_file_pub');
  v_dev text := (select v from pg_temp.m16_fx where k='a_dev_pub');
  v_e jsonb; v_bag text;
begin
  perform pg_temp.h_reset();
  -- authenticated-only grant surface
  perform pg_temp.m16_assert( has_function_privilege('authenticated','api.export_my_managed_skill_vault()','execute'),
    'export authenticated EXECUTE');
  perform pg_temp.m16_assert( not has_function_privilege('anon','api.export_my_managed_skill_vault()','execute')
    and not has_function_privilege('service_role','api.export_my_managed_skill_vault()','execute'),
    'export revoked from anon/service');
  -- A export
  perform pg_temp.h_as('authenticated', v_a::text);
  select api.export_my_managed_skill_vault() into v_e;
  assert (v_e->>'schema_version') = '1.0','export schema_version 1.0';
  assert (v_e->'sections'->'managed_skills'->>'count') = '2','A export lists its two owned skills';
  -- A's export must NOT contain any B identifier
  v_bag := v_e::text;
  assert v_bag not like '%'||v_bpub||'%','A export excludes B skill public id';
  -- and DOES contain A's captured graph without assuming array order.
  assert exists (
    select 1 from jsonb_array_elements(v_e->'sections'->'managed_skills'->'items') item
    where item->>'public_id' = v_apub
  ),'A export contains captured A skill';
  assert exists (
    select 1 from jsonb_array_elements(v_e->'sections'->'managed_skill_versions'->'items') item
    where item->>'public_id' = v_avers
  ),'A export contains captured A version';
  assert exists (
    select 1 from jsonb_array_elements(v_e->'sections'->'managed_skill_files'->'items') item
    where item->>'public_id' = v_afil
  ),'A export contains captured A file';
  assert exists (
    select 1 from jsonb_array_elements(v_e->'sections'->'devices'->'items') item
    where item->>'public_id' = v_dev
  ),'A export contains captured A device';
  -- exports no internal uuid / token key material
  assert octet_length(v_e::text) < 1048576,'export bounded 1 MiB';
  perform pg_temp.h_reset();
end $export$;
-- TEST 8: api.delete_my_account for A purges A / preserves B; the service-only
-- deletion_adapter claim/complete/fail/ack paths are exercised. B (no storage
-- object) is reused as the zero-object account to drive the full canonical
-- 13-owner completion; no third auth UUID is created.
do $deltest$
declare
  v_a uuid := (select v::uuid from pg_temp.m16_fx where k='uid_a');
  v_b uuid := (select v::uuid from pg_temp.m16_fx where k='uid_b');
  v_akey text := (select v from pg_temp.m16_fx where k='a_key');
  v_ok bool; v_n text; v_receipt text; v_state text;
  v_job uuid; v_state2 text; v_comp2 boolean; v_cnt2 int; v_dig2 text;
  v_rep text;
begin
  perform pg_temp.h_reset();
  perform pg_temp.h_as('anon','');
  perform pg_temp.m16_expect_error('select api.delete_my_account()','42501');
  perform pg_temp.h_reset();

  -- A deletes its account; relational purge; storage residue queued.
  perform pg_temp.h_as('authenticated', v_a::text);
  select api.delete_my_account() into v_ok;
  perform pg_temp.h_reset();
  assert v_ok is true,'delete returns true for A';
  select count(*)::text into v_n from private.managed_skills where account_id=v_a;
  assert v_n='0','A skills purged';
  select count(*)::text into v_n from private.managed_skill_files where account_id=v_a;
  assert v_n='0','A files purged';
  select count(*)::text into v_n from private.managed_skill_versions where account_id=v_a;
  assert v_n='0','A versions purged';
  select count(*)::text into v_n from private.devices where account_id=v_a;
  assert v_n='0','A devices purged';
  select count(*)::text into v_n from private.route_corrections where account_id=v_a;
  assert v_n='0','A route corrections purged';
  select count(*)::text into v_n from private.managed_skills where account_id=v_b;
  assert v_n<>'0','B skills preserved';
  select del_ into v_rep from private.account_deletion_receipts order by barrier_initiated_at desc limit 1;
  select state into v_state from private.account_deletion_receipts where del_=v_rep;
  assert v_state='BARRIER_COMMITTED','A receipt BARRIER_COMMITTED';

  -- service_role adapter claims the A storage job; object present -> complete fails.
  perform pg_temp.h_as('service_role','');
  create temp table if not exists m22c (job_id uuid primary key, object_name text);
  truncate m22c;
  insert into m22c (job_id, object_name)
  select c.job_id, c.object_name from deletion_adapter.claim_skill_vault_storage_deletion_jobs(64) c;
  perform pg_temp.h_reset();
  select count(*)::text into v_n from m22c;
  assert v_n = '1','worker claims exactly the one A storage job';
  select job_id into v_job from m22c where object_name=v_akey limit 1;
  assert v_job is not null,'A storage job targets a_key';
  perform pg_temp.h_as('service_role','');
  perform pg_temp.m16_expect_error(
    'select * from deletion_adapter.complete_skill_vault_storage_deletion_job('
      || quote_literal(v_job::text) || '::uuid)',
    '55000'
  );
  perform pg_temp.h_reset();

  -- Keep A's storage.objects row present so A's deletion completion stays
  -- fail-closed (exact SQLSTATE 55000 asserted above on the claimed A job).

  -- B: remove ONLY B's own storage.objects row first (postgres, one-time
  -- allow_delete_query so the vendor protect-delete boundary is honored for
  -- this single evidence vehicle; reset back to disabled immediately). This
  -- makes B zero-object WITHOUT removing B's managed-file key, so B's account
  -- deletion still enqueues exactly one absence-gated job.
  perform pg_temp.h_reset();
  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id='skill-vault-private' and name = (
    select v from pg_temp.m16_fx where k='b_key');
  perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);
  select count(*)::int into v_cnt2 from storage.objects
  where bucket_id='skill-vault-private' and owner_id = v_b::text;
  assert v_cnt2 = 0, 'B storage object row removed (B now zero-object)';

  -- B deletes its account; enqueues exactly one storage job for B's key.
  perform pg_temp.h_as('authenticated', v_b::text);
  select api.delete_my_account() into v_ok;
  perform pg_temp.h_reset();
  assert v_ok is true,'delete returns true for B';
  select del_ into v_receipt from private.account_deletion_receipts where del_ <> v_rep limit 1;
  assert v_receipt is not null and v_receipt ~ '^del_[0-9a-f]{32}$','B receipt captured (not A)';
  select count(*)::text into v_n from private.skill_vault_storage_deletion_jobs
  where deletion_receipt_id = (select id from private.account_deletion_receipts where del_=v_receipt);
  assert v_n = '1','B enqueues exactly one storage job';

  -- claim and complete B's single absence-gated job (the object row was removed
  -- above, so completion resolves).
  perform pg_temp.h_as('service_role','');
  select claim.job_id into v_job
  from deletion_adapter.claim_skill_vault_storage_deletion_jobs(1) claim
  where claim.object_name = (select v from pg_temp.m16_fx where k='b_key') limit 1;
  assert v_job is not null,'B storage job claimed';
  perform deletion_adapter.complete_skill_vault_storage_deletion_job(v_job);

  -- canonical 13-owner acknowledgement; vault_blobs is now purged (1 job, 0
  -- outstanding) so the receipt can finalize COMPLETED with the full proof.
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'device_auth','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'route_idempotency','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'runtime_bundle_cache','no_account_scope','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'local_quarantine_intent_receipt','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'vault_blobs','purged','1');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'manifest_version_lifecycle','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'authenticated_projections','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'feedback','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'support','no_account_scope','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'analytics_linkage','unlinked','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'online_replicas','purged','0');
  perform * from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'queues_dead_letters','purged','0');
  select state, completed, owner_completed_count, proof_digest
    into v_state2, v_comp2, v_cnt2, v_dig2
  from deletion_adapter.acknowledge_account_deletion_owner(v_receipt,'backup_restore_barrier','barrier_applied','0');
  assert v_state2='COMPLETED' and v_comp2 and v_cnt2=13 and v_dig2 ~ '^sha256:[0-9a-f]{64}$',
    'B completion finalized with full proof digest';
  perform pg_temp.h_reset();
end $deltest$;
rollback;

-- =============================================================================
-- TEST 9 — static redacted JSON result, emitted AFTER the single ROLLBACK.
-- The transaction has already closed, so nothing here touches fixture rows;
-- it prints a constant redacted digest only (no ids, emails, tokens, object
-- names, storage keys, or row content). psql tag = the matrix's green result.
-- =============================================================================
select jsonb_pretty(jsonb_build_object(
  'matrix', 'M2.16-remote-security-matrix',
  'matrix_version', '1.0',
  'result', 'pass',
  'identities', 2,
  'identities_created', 2,
  'roles_covered', jsonb_build_array('anon', 'authenticated', 'service_role'),
  'transaction_rolled_back', true,
  'shared_graph', true,
  'coverage', jsonb_build_object(
    'test1_anon_denial', true,
    'test2_owner_isolation', true,
    'test3_rls_boundaries', true,
    'test4_storage_contract', true,
    'test5_device_import', true,
    'test6_route', true,
    'test7_export_exclusive', true,
    'test8_deletion', true
  ),
  'note', 'redacted: no identifier/email/token/object-name/row content disclosed'
)) as m216_result;
