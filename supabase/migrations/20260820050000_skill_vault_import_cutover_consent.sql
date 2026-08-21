begin;

set local search_path = '';

create table private.import_cutover_consents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null default ('icn_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  device_id uuid not null,
  session_id uuid not null,
  session_revision bigint not null,
  manifest_digest text not null,
  consent_digest text not null,
  explicit_consent_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  consent_expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,

  constraint import_cutover_consents_public_id_key unique (public_id),
  constraint import_cutover_consents_public_id_check check (public_id ~ '^icn_[0-9a-f]{32}$'),
  constraint import_cutover_consents_session_fkey foreign key (account_id, device_id, session_id)
    references private.import_sessions (account_id, device_id, id) on delete cascade,
  constraint import_cutover_consents_revision_check check (session_revision >= 1),
  constraint import_cutover_consents_manifest_check check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_cutover_consents_digest_check check (consent_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_cutover_consents_time_check check (
    consent_expires_at > explicit_consent_at
    and consent_expires_at <= explicit_consent_at + interval '10 minutes'
    and (revoked_at is null or revoked_at >= explicit_consent_at)
  )
);

alter table private.import_cutover_consents enable row level security;
alter table private.import_cutover_consents force row level security;
revoke all privileges on table private.import_cutover_consents
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.authorize_my_import_cutover(
  p_session_public_id text,
  p_expected_revision bigint,
  p_manifest_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := private.current_request_uid();
  v_session private.import_sessions%rowtype;
  v_consent private.import_cutover_consents%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_consent_revision bigint;
begin
  if v_account_id is null
    or coalesce((auth.jwt() -> 'is_anonymous'), 'true'::jsonb) <> 'false'::jsonb
    or p_session_public_id !~ '^imp_[0-9a-f]{32}$'
    or p_expected_revision is null or p_expected_revision < 1
    or p_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'invalid import cutover consent' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::text || ':' || p_session_public_id, 4)
  );

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_account_id
    and sessions.imp_ = p_session_public_id
  for update;

  if not found then raise exception 'import consent authority unavailable' using errcode = '42501'; end if;
  if v_session.state not in ('in_progress', 'verified')
    or (v_session.state = 'in_progress' and v_session.expiry_at <= v_now)
    or v_session.revision <> p_expected_revision
    or v_session.manifest_digest <> p_manifest_digest
    or v_session.accepted_file_count <> v_session.expected_file_count
    or v_session.accepted_byte_total <> v_session.expected_byte_total
  then
    raise exception 'import consent state conflict' using errcode = '40001';
  end if;
  v_consent_revision := case
    when v_session.state = 'verified' then v_session.revision - 1
    else v_session.revision
  end;
  if v_consent_revision < 1 then
    raise exception 'import consent state conflict' using errcode = '40001';
  end if;

  select consents.* into v_consent
  from private.import_cutover_consents as consents
  where consents.account_id = v_account_id
    and consents.device_id = v_session.device_id
    and consents.session_id = v_session.id
    and consents.session_revision = v_consent_revision
    and consents.manifest_digest = v_session.manifest_digest
    and consents.revoked_at is null
    and consents.consent_expires_at > v_now
  order by consents.explicit_consent_at desc
  limit 1;

  if not found then
    insert into private.import_cutover_consents (
      account_id, device_id, session_id, session_revision, manifest_digest,
      consent_digest, explicit_consent_at, consent_expires_at
    ) values (
      v_account_id, v_session.device_id, v_session.id, v_consent_revision, v_session.manifest_digest,
      'sha256:' || repeat('0', 64), v_now, v_now + interval '10 minutes'
    ) returning * into v_consent;

    update private.import_cutover_consents as consents
    set consent_digest = 'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'consent_id', v_consent.public_id,
            'session_id', p_session_public_id,
            'session_revision', v_consent_revision,
            'manifest_digest', v_session.manifest_digest,
            'explicit_consent_at', v_consent.explicit_consent_at,
            'consent_expires_at', v_consent.consent_expires_at
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    where consents.id = v_consent.id
    returning * into v_consent;
  end if;

  return pg_catalog.jsonb_build_object(
    'owner_consent_id', v_consent.public_id,
    'session_public_id', p_session_public_id,
    'revision', v_consent.session_revision,
    'manifest_digest', v_consent.manifest_digest,
    'consent_digest', v_consent.consent_digest,
    'explicit_consent_at', v_consent.explicit_consent_at,
    'consent_expires_at', v_consent.consent_expires_at
  );
end
$function$;

create function api.authorize_my_import_cutover(
  p_session_public_id text,
  p_expected_revision bigint,
  p_manifest_digest text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.authorize_my_import_cutover(
    p_session_public_id, p_expected_revision, p_manifest_digest
  );
$function$;

create function private.my_owner_import_cutover_consents()
returns table (h_session_public_id text, h_owner_consent_id text, h_consent_expires_at timestamp with time zone)
language sql
stable
security definer
set search_path = ''
as $function$
  select sessions.imp_, consents.public_id, consents.consent_expires_at
  from private.import_cutover_consents as consents
  join private.import_sessions as sessions
    on sessions.account_id = consents.account_id
   and sessions.device_id = consents.device_id
   and sessions.id = consents.session_id
  where consents.account_id = (select private.current_request_uid())
    and consents.revoked_at is null
    and consents.consent_expires_at > pg_catalog.statement_timestamp()
  order by consents.explicit_consent_at desc;
$function$;

create view api.my_import_cutover_consents
with (security_invoker = true, security_barrier = true)
as select
  h_session_public_id as session_public_id,
  h_owner_consent_id as owner_consent_id,
  h_consent_expires_at as consent_expires_at
from private.my_owner_import_cutover_consents();

create function device_adapter.adapter_require_import_cutover_consent(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_consent private.import_cutover_consents%rowtype;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);
  if not found then raise exception 'import authority unavailable' using errcode = '42501'; end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id;
  if not found
    or p_expected_session_revision is null
    or p_expected_session_revision < 1
    or not (
      (v_session.state = 'in_progress' and v_session.revision = p_expected_session_revision)
      or (v_session.state = 'verified' and v_session.revision = p_expected_session_revision + 1)
    )
  then
    raise exception 'import consent state conflict' using errcode = '40001';
  end if;

  select consents.* into v_consent
  from private.import_cutover_consents as consents
  where consents.account_id = v_context.account_id
    and consents.device_id = v_context.device_id
    and consents.session_id = v_session.id
    and consents.session_revision = p_expected_session_revision
    and consents.manifest_digest = v_session.manifest_digest
    and consents.revoked_at is null
    and consents.consent_expires_at > pg_catalog.statement_timestamp()
  order by consents.explicit_consent_at desc
  limit 1;
  if not found then raise exception 'import cutover consent required' using errcode = '42501'; end if;

  return pg_catalog.jsonb_build_object(
    'owner_consent_id', v_consent.public_id,
    'consent_digest', v_consent.consent_digest,
    'explicit_consent_at', v_consent.explicit_consent_at,
    'consent_expires_at', v_consent.consent_expires_at
  );
end
$function$;

revoke all privileges on function private.authorize_my_import_cutover(text,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.authorize_my_import_cutover(text,bigint,text) to authenticated;
revoke all privileges on function api.authorize_my_import_cutover(text,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function api.authorize_my_import_cutover(text,bigint,text) to authenticated;
revoke all privileges on function private.my_owner_import_cutover_consents()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_owner_import_cutover_consents() to authenticated;
revoke all privileges on table api.my_import_cutover_consents
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_import_cutover_consents to authenticated;
revoke all privileges on function device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)
  to service_role;

commit;
