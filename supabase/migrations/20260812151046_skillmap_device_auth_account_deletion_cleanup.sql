begin;

set local search_path = '';

-- M3 account deletion repair: the original barrier removed private.devices,
-- but DeviceAuth confirmation and pairing rows are not children of that table.
-- Keep device-scoped proof/replay/rate state intact unless an account-owned
-- relation proves that it belongs to this account.  This replacement keeps
-- the historical barrier order and adds only the DeviceAuth purge step.
create or replace function private.perform_vault_deletion_barrier()
returns table (
  receipt_del_ text,
  state_ text,
  queued_object_count bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_receipt_id uuid;
  v_ageout timestamp with time zone := v_now + pg_catalog.make_interval(secs => 30 * 86400);
  v_receipt_del text;
  v_queued bigint := 0;
begin
  v_caller := (select auth.uid());
  if v_caller is null
    or (select auth.role()) <> 'authenticated'
    or not exists (
      select 1 from auth.users as u
      where u.id = v_caller
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= v_now)
    )
  then
    raise exception 'authenticated account authority is required' using errcode = '42501';
  end if;

  -- M2.02 global lock order: the account advisory lock is first.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_caller::text, 0)
  );
  perform pg_catalog.set_config(
    'skillmap.account_deletion_account_id', v_caller::text, true
  );

  v_receipt_id := pg_catalog.gen_random_uuid();

  insert into private.account_deletion_receipts (
    id, del_, state, barrier_committed_at, queued_at,
    backup_physical_ageout_deadline, attempt_count
  ) values (
    v_receipt_id,
    'del_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    'BARRIER_COMMITTED',
    v_now,
    v_now,
    v_ageout,
    1
  );

  select deletion_receipts.del_ into v_receipt_del
  from private.account_deletion_receipts as deletion_receipts
  where deletion_receipts.id = v_receipt_id;

  -- Revoke device/token authority. The owned device rows are deleted below.
  delete from private.device_tokens as tok
  using private.devices as dev
  where dev.id = tok.device_id and dev.account_id = v_caller;

  -- Purge device-keyed DeviceAuth state through the account-owned pairing /
  -- family mapping before those rows are removed.  These tables have no
  -- account_id column by design, so never delete by a guessed prefix or by a
  -- global device key.  A pending pairing with no confirmed account remains.
  delete from private.device_auth_key_bindings as b
  where b.device_id in (
    select p.device_id from private.device_auth_pairings as p
    where p.confirmed_user_id = v_caller
       or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
    union
    select f.device_id from private.device_auth_token_families as f
    where f.account_id = v_caller
  )
  and not exists (
    select 1 from private.device_auth_pairings as p
    where p.device_id = b.device_id
      and p.confirmed_user_id is distinct from v_caller
      and p.account_public_id is distinct from 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
  )
  and not exists (
    select 1 from private.device_auth_token_families as f
    where f.device_id = b.device_id and f.account_id <> v_caller
  );

  delete from private.device_auth_proof_nonces as n
  where n.device_id in (
    select p.device_id from private.device_auth_pairings as p
    where p.confirmed_user_id = v_caller
       or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
    union
    select f.device_id from private.device_auth_token_families as f
    where f.account_id = v_caller
  )
  and not exists (
    select 1 from private.device_auth_pairings as p
    where p.device_id = n.device_id
      and p.confirmed_user_id is distinct from v_caller
      and p.account_public_id is distinct from 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
  )
  and not exists (
    select 1 from private.device_auth_token_families as f
    where f.device_id = n.device_id and f.account_id <> v_caller
  );

  delete from private.device_auth_idempotency_receipts as r
  where r.principal_kind = 'device'
    and r.principal in (
      select p.device_id from private.device_auth_pairings as p
      where p.confirmed_user_id = v_caller
         or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
      union
      select f.device_id from private.device_auth_token_families as f
      where f.account_id = v_caller
    )
    and not exists (
      select 1 from private.device_auth_pairings as p
      where p.device_id = r.principal
        and p.confirmed_user_id is distinct from v_caller
        and p.account_public_id is distinct from 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
    )
    and not exists (
      select 1 from private.device_auth_token_families as f
      where f.device_id = r.principal and f.account_id <> v_caller
    );

  delete from private.device_auth_rate_buckets as b
  where b.bucket_key in (
    select p.device_id from private.device_auth_pairings as p
    where p.confirmed_user_id = v_caller
       or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
    union
    select f.device_id from private.device_auth_token_families as f
    where f.account_id = v_caller
  )
  and not exists (
    select 1 from private.device_auth_pairings as p
    where p.device_id = b.bucket_key
      and p.confirmed_user_id is distinct from v_caller
      and p.account_public_id is distinct from 'acct_' || pg_catalog.replace(v_caller::text, '-', '')
  )
  and not exists (
    select 1 from private.device_auth_token_families as f
    where f.device_id = b.bucket_key and f.account_id <> v_caller
  );

  -- Purge account-owned DeviceAuth state before deleting private.devices.
  -- Pairings are linked to an account by the confirmed claim or by the
  -- canonical presentation id written at exchange.  Their child rows are
  -- removed first where no FK cascade exists, then pairing FKs cascade the
  -- token-family and confirmation-handle children.
  delete from private.device_auth_confirmation_attempts
  where user_id = v_caller;

  delete from private.device_auth_confirmation_handles as h
  where h.user_id = v_caller
     or exists (
       select 1
       from private.device_auth_pairings as p
       where p.pairing_id = h.pairing_id
         and (p.confirmed_user_id = v_caller
           or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', ''))
     );

  delete from private.device_auth_key_rotation_receipts as r
  using private.devices as d
  where d.account_id = v_caller and r.device_public_id = d.public_id;

  delete from private.device_auth_token_families
  where account_id = v_caller;

  delete from private.device_auth_code_digests as cd
  using private.device_auth_pairings as p
  where p.pairing_id = cd.pairing_id
    and (p.confirmed_user_id = v_caller
      or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', ''));

  delete from private.device_auth_pairings as p
  where p.confirmed_user_id = v_caller
     or p.account_public_id = 'acct_' || pg_catalog.replace(v_caller::text, '-', '');

  -- Purge route records (decisions cascade selections/corrections) and import
  -- sessions (sessions cascade file receipts).
  delete from private.route_decisions as d
  where d.account_id = v_caller;

  delete from private.import_sessions as s
  where s.account_id = v_caller;

  -- Snapshot exact owned object keys into idempotent jobs BEFORE deleting
  -- managed files. Replay/new receipt with a still-present object no-ops via
  -- the partial unique index (DO NOTHING); this is the crash/retry safe path.
  insert into private.skill_vault_storage_deletion_jobs (
    deletion_receipt_id, bucket_id, object_name, state, next_attempt_at
  )
  select v_receipt_id, 'skill-vault-private', f.storage_key, 'PENDING', v_now
  from private.managed_skill_files as f
  where f.account_id = v_caller
    and f.storage_key ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
  on conflict (
    deletion_receipt_id, bucket_id, object_name
  ) where state <> 'COMPLETED' do nothing;

  get diagnostics v_queued = row_count;

  -- Delete managed files/releases/versions/skills child-to-parent, clearing the
  -- active-release pointer first so the releases delete is not blocked.
  update private.managed_skills as s
  set active_release_id = null, updated_at = v_now
  where s.account_id = v_caller;

  delete from private.managed_skill_releases as r where r.account_id = v_caller;
  delete from private.managed_skill_versions as vv where vv.account_id = v_caller;
  delete from private.managed_skill_files as f where f.account_id = v_caller;
  delete from private.managed_skills as s where s.account_id = v_caller;
  delete from private.devices as dev where dev.account_id = v_caller;

  perform pg_catalog.set_config(
    'skillmap.account_deletion_account_id', '', true
  );

  return query
  select v_receipt_del, 'BARRIER_COMMITTED'::text, v_queued;
end;
$function$;

commit;
