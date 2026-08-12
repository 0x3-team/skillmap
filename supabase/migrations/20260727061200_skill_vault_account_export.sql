begin;

-- =============================================================================
-- M2.13 — authenticated-owner Skill Vault account export.
-- Authority: M2.02 section 4.11 (account export for private managed data) and
-- M2.13 of the forward-only Skill Vault series. This migration adds exactly one
-- `api.export_my_managed_skill_vault()` function that serializes every owned
-- private vault datum into a single deterministic, versioned, bounded jsonb
-- object. It creates no tables, no views, and no policies; it only defines the
-- export function and grants/revokes its exact call surface.
--
-- PRINCIPLES
--   1. Identity is derived from auth.uid(); the function accepts NO caller
--      account/device id and fails closed without a current, non-deleted,
--      non-banned account.
--   2. SECURITY DEFINER with an empty search_path; the function is postgres-owned
--      (matching api.delete_my_account) so it may resolve auth.uid()/auth.users
--      without auth-schema grants and may read the private vault tables.
--   3. Only public identifiers (msk_/msv_/msr_/msf_/dev_/imp_/rtd_/rtc_) are
--      emitted to express relations; no internal UUID, account id, HMAC/token
--      digest, key version, token scope, verifier material, manifest/body bytes,
--      raw prompt/body/context, storage bucket/object key, cleanup/deletion
--      internals, or worker field is ever projected.
--   4. Every section is deterministically ordered and explicitly row-capped; a
--      truncated section reports count + total so bounds are visible but the
--      payload stays bounded. Each jsonb_agg carries an explicit ORDER BY.
--   5. Read-only: no row locks, no external/network/blob/storage work. The
--      existing account-export/deletion surface is untouched.
-- =============================================================================

create function api.export_my_managed_skill_vault()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();

  -- Section caches (ordered, capped jsonb arrays) and their raw totals.
  v_skills jsonb;
  v_skills_total bigint;
  v_versions jsonb;
  v_versions_total bigint;
  v_releases jsonb;
  v_releases_total bigint;
  v_files jsonb;
  v_files_total bigint;
  v_devices jsonb;
  v_devices_total bigint;
  v_import_sessions jsonb;
  v_import_sessions_total bigint;
  v_import_receipts jsonb;
  v_import_receipts_total bigint;
  v_route_decisions jsonb;
  v_route_decisions_total bigint;
  v_route_selections jsonb;
  v_route_selections_total bigint;
  v_route_corrections jsonb;
  v_route_corrections_total bigint;
  v_export jsonb;
begin
  -- Fail closed without a current, non-deleted, non-banned caller account.
  v_account_id := (select auth.uid());
  if v_account_id is null
    or not exists (
      select 1
      from auth.users as u
      where u.id = v_account_id
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= v_now)
    )
  then
    raise exception 'authenticated account authority is required' using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------------
  -- 1. Managed skills (+ active release state). Order by created_at, public.
  -- ---------------------------------------------------------------------
  select count(*) into v_skills_total
  from private.managed_skills as s
  where s.account_id = v_account_id;

  select coalesce(jsonb_agg(sb.item order by sb.ord_created_at, sb.ord_public_id), '[]'::jsonb) into v_skills
  from (
    select jsonb_build_object(
      'public_id', s.public_id,
      'display_name', s.display_name,
      'description', s.description,
      'created_at', s.created_at,
      'updated_at', s.updated_at,
      'active_release_public_id', active_release.public_id,
      'activation_revision', s.activation_revision
    ) as item,
    s.created_at as ord_created_at,
    s.public_id as ord_public_id
    from private.managed_skills as s
    left join private.managed_skill_releases as active_release
      on active_release.account_id = s.account_id
     and active_release.managed_skill_id = s.id
     and active_release.id = s.active_release_id
    where s.account_id = v_account_id
    order by s.created_at, s.public_id
    limit 100
  ) as sb;

  -- ---------------------------------------------------------------------
  -- 2. Managed skill versions. Public-safe metadata and content references
  --    only; manifest bytes, manifest digest, and source internals excluded.
  -- ---------------------------------------------------------------------
  select count(*) into v_versions_total
  from private.managed_skill_versions as v
  where v.account_id = v_account_id;

  select coalesce(
    jsonb_agg(vb.item order by vb.ord_created_at, vb.ord_public_id), '[]'::jsonb
  ) into v_versions
  from (
    select jsonb_build_object(
      'public_id', v.public_id,
      'skill_public_id', skill.public_id,
      'manifest_schema_version', v.manifest_schema_version,
      'content_digest', v.content_digest,
      'provenance_state', v.provenance_state,
      'analysis_state', v.analysis_state,
      'created_at', v.created_at
    ) as item,
    v.created_at as ord_created_at,
    v.public_id as ord_public_id
    from private.managed_skill_versions as v
    join private.managed_skills as skill
      on skill.account_id = v.account_id
     and skill.id = v.managed_skill_id
    where v.account_id = v_account_id
    order by v.created_at, v.public_id
    limit 500
  ) as vb;

  -- ---------------------------------------------------------------------
  -- 3. Managed skill releases (lifecycle + active state). Relations via
  --    public skill/version/release ids.
  -- ---------------------------------------------------------------------
  select count(*) into v_releases_total
  from private.managed_skill_releases as r
  where r.account_id = v_account_id;

  select coalesce(
    jsonb_agg(rb.item order by rb.ord_created_at, rb.ord_public_id), '[]'::jsonb
  ) into v_releases
  from (
    select jsonb_build_object(
      'public_id', r.public_id,
      'skill_public_id', skill.public_id,
      'version_public_id', version_row.public_id,
      'lifecycle_state', r.lifecycle_state,
      'eligibility_reasons', r.eligibility_reasons,
      'created_at', r.created_at,
      'activated_at', r.activated_at,
      'revoked_at', r.revoked_at
    ) as item,
    r.created_at as ord_created_at,
    r.public_id as ord_public_id
    from private.managed_skill_releases as r
    join private.managed_skills as skill
      on skill.account_id = r.account_id and skill.id = r.managed_skill_id
    join private.managed_skill_versions as version_row
      on version_row.account_id = r.account_id
     and version_row.managed_skill_id = r.managed_skill_id
     and version_row.id = r.version_id
    where r.account_id = v_account_id
    order by r.created_at, r.public_id
    limit 500
  ) as rb;

  -- ---------------------------------------------------------------------
  -- 4. Files: metadata + safe public content-export reference (digest) only.
  --    Storage key / internal ids excluded.
  -- ---------------------------------------------------------------------
  select count(*) into v_files_total
  from private.managed_skill_files as f
  where f.account_id = v_account_id;

  select coalesce(
    jsonb_agg(fb.item order by fb.ord_ordinal, fb.ord_public_id),
    '[]'::jsonb
  ) into v_files
  from (
    select jsonb_build_object(
      'public_id', f.public_id,
      'version_public_id', version_row.public_id,
      'relative_path', f.relative_path,
      'media_type', f.media_type,
      'byte_size', f.byte_size,
      'file_digest', f.file_digest,
      'executable', f.executable,
      'ordinal', f.ordinal,
      'created_at', f.created_at
    ) as item,
    f.ordinal as ord_ordinal,
    f.public_id as ord_public_id
    from private.managed_skill_files as f
    join private.managed_skill_versions as version_row
      on version_row.account_id = f.account_id
     and version_row.managed_skill_id = f.managed_skill_id
     and version_row.id = f.version_id
    where f.account_id = v_account_id
    order by f.ordinal, f.public_id
    limit 2000
  ) as fb;

  -- ---------------------------------------------------------------------
  -- 5. Devices (identity/metadata only; no token verifier/digest/key/scopes).
  --    Device tokens are never projected.
  -- ---------------------------------------------------------------------
  select count(*) into v_devices_total
  from private.devices as d
  where d.account_id = v_account_id;

  select coalesce(
    jsonb_agg(db.item order by db.ord_issued_at, db.ord_public_id),
    '[]'::jsonb
  ) into v_devices
  from (
    select jsonb_build_object(
      'public_id', d.public_id,
      'display_name', d.display_name,
      'platform', d.platform,
      'connector_version', d.connector_version,
      'locale', d.locale,
      'state', d.state,
      'revision', d.revision,
      'issued_at', d.issued_at,
      'last_used_at', d.last_used_at,
      'expires_at', d.expires_at,
      'revoked_at', d.revoked_at
    ) as item,
    d.issued_at as ord_issued_at,
    d.public_id as ord_public_id
    from private.devices as d
    where d.account_id = v_account_id
    order by d.issued_at, d.public_id
    limit 100
  ) as db;

  -- ---------------------------------------------------------------------
  -- 6. Import sessions (+ accepted-file receipts) and receipts. Relations
  --    via public ids; verification/digest and idempotency keys excluded.
  -- ---------------------------------------------------------------------
  select count(*) into v_import_sessions_total
  from private.import_sessions as s
  where s.account_id = v_account_id;

  select coalesce(
    jsonb_agg(sb.item order by sb.ord_created_at, sb.ord_public_id),
    '[]'::jsonb
  ) into v_import_sessions
  from (
    select jsonb_build_object(
      'public_id', s.imp_,
      'device_public_id', device_row.public_id,
      'skill_public_id', skill.public_id,
      'version_public_id', version_row.public_id,
      'manifest_schema_version', s.manifest_schema_version,
      'state', s.state,
      'expected_file_count', s.expected_file_count,
      'accepted_file_count', s.accepted_file_count,
      'expected_byte_total', s.expected_byte_total,
      'accepted_byte_total', s.accepted_byte_total,
      'expiry_at', s.expiry_at,
      'created_at', s.created_at,
      'updated_at', s.updated_at,
      'verified_at', s.verified_at,
      'revision', s.revision
    ) as item,
    s.created_at as ord_created_at,
    s.imp_ as ord_public_id
    from private.import_sessions as s
    join private.devices as device_row
      on device_row.account_id = s.account_id and device_row.id = s.device_id
    join private.managed_skills as skill
      on skill.account_id = s.account_id and skill.id = s.managed_skill_id
    join private.managed_skill_versions as version_row
      on version_row.account_id = s.account_id
     and version_row.managed_skill_id = s.managed_skill_id
     and version_row.id = s.version_id
    where s.account_id = v_account_id
    order by s.created_at desc, s.imp_
    limit 500
  ) as sb;

  select count(*) into v_import_receipts_total
  from private.import_file_receipts as r
  where r.account_id = v_account_id;

  select coalesce(
    jsonb_agg(
      rb.item order by rb.ord_accepted_at, rb.ord_session_public_id,
        rb.ord_ordinal, rb.ord_file_public_id
    ),
    '[]'::jsonb
  ) into v_import_receipts
  from (
    select jsonb_build_object(
      'session_public_id', session_row.imp_,
      'file_public_id', file_row.public_id,
      'relative_path', r.relative_path,
      'media_type', r.media_type,
      'accepted_byte_size', r.accepted_byte_size,
      'file_digest', r.file_digest,
      'ordinal', r.ordinal,
      'accepted_at', r.accepted_at
    ) as item,
    r.accepted_at as ord_accepted_at,
    session_row.imp_ as ord_session_public_id,
    r.ordinal as ord_ordinal,
    file_row.public_id as ord_file_public_id
    from private.import_file_receipts as r
    join private.import_sessions as session_row
      on session_row.account_id = r.account_id and session_row.id = r.session_id
    join private.managed_skill_files as file_row
      on file_row.account_id = r.account_id
     and file_row.managed_skill_id = r.managed_skill_id
     and file_row.version_id = r.version_id
     and file_row.id = r.file_id
    where r.account_id = v_account_id
    order by r.accepted_at, session_row.imp_, r.ordinal, file_row.public_id
    limit 2000
  ) as rb;

  -- ---------------------------------------------------------------------
  -- 7. Route decision metadata. Non-content metadata only; the internal
  --    request fingerprint is excluded.
  -- ---------------------------------------------------------------------
  select count(*) into v_route_decisions_total
  from private.route_decisions as d
  where d.account_id = v_account_id;

  select coalesce(
    jsonb_agg(db.item order by db.ord_created_at, db.ord_public_id),
    '[]'::jsonb
  ) into v_route_decisions
  from (
    select jsonb_build_object(
      'public_id', d.rtd_,
      'device_public_id', device_row.public_id,
      'request_id', d.request_id,
      'result_type', d.result_type,
      'confidence', d.confidence,
      'reason_codes', d.reason_codes,
      'account_revision', d.account_revision,
      'device_auth_binding_revision', d.device_auth_binding_revision,
      'routing_policy_revision', d.routing_policy_revision,
      'eligibility_revision', d.eligibility_revision,
      'audience_revision', d.audience_revision,
      'deadline_ms', d.deadline_ms,
      'elapsed_ms', d.elapsed_ms,
      'segment_binding_ms', d.segment_binding_ms,
      'segment_eligibility_ms', d.segment_eligibility_ms,
      'segment_ranking_ms', d.segment_ranking_ms,
      'replay_guaranteed_until', d.replay_guaranteed_until,
      'decision_expiry_at', d.decision_expiry_at,
      'created_at', d.created_at
    ) as item,
    d.created_at as ord_created_at,
    d.rtd_ as ord_public_id
    from private.route_decisions as d
    join private.devices as device_row
      on device_row.account_id = d.account_id and device_row.id = d.device_id
    where d.account_id = v_account_id
    order by d.created_at desc, d.rtd_
    limit 1000
  ) as db;

  -- ---------------------------------------------------------------------
  -- 8. Route decision selections. Ranked/selected lineage expressed via
  --    public skill/version/release ids.
  -- ---------------------------------------------------------------------
  select count(*) into v_route_selections_total
  from private.route_decision_selections as s
  where s.account_id = v_account_id;

  select coalesce(
    jsonb_agg(
      sb.item order by sb.ord_created_at, sb.ord_decision_public_id,
        sb.ord_ordinal, sb.ord_release_public_id
    ),
    '[]'::jsonb
  ) into v_route_selections
  from (
    select jsonb_build_object(
      'decision_public_id', decision.rtd_,
      'row_kind', s.row_kind,
      'ordinal', s.ordinal,
      'role', s.role,
      'skill_public_id', skill.public_id,
      'version_public_id', version_row.public_id,
      'release_public_id', release_row.public_id,
      'confidence', s.confidence,
      'reason_codes', s.reason_codes,
      'created_at', s.created_at
    ) as item,
    s.created_at as ord_created_at,
    decision.rtd_ as ord_decision_public_id,
    s.ordinal as ord_ordinal,
    release_row.public_id as ord_release_public_id
    from private.route_decision_selections as s
    join private.route_decisions as decision
      on decision.account_id = s.account_id
     and decision.device_id = s.device_id
     and decision.id = s.decision_id
    join private.managed_skills as skill
      on skill.account_id = s.account_id and skill.id = s.managed_skill_id
    join private.managed_skill_versions as version_row
      on version_row.account_id = s.account_id
     and version_row.managed_skill_id = s.managed_skill_id
     and version_row.id = s.version_id
    join private.managed_skill_releases as release_row
      on release_row.account_id = s.account_id
     and release_row.managed_skill_id = s.managed_skill_id
     and release_row.version_id = s.version_id
     and release_row.id = s.release_id
    where s.account_id = v_account_id
    order by s.created_at, decision.rtd_, s.ordinal, release_row.public_id
    limit 5000
  ) as sb;

  -- ---------------------------------------------------------------------
  -- 9. Route corrections. Feedback outcome + optional owned alternative
  --    lineage referenced by public ids.
  -- ---------------------------------------------------------------------
  select count(*) into v_route_corrections_total
  from private.route_corrections as c
  where c.account_id = v_account_id;

  select coalesce(
    jsonb_agg(cb.item order by cb.ord_created_at, cb.ord_public_id),
    '[]'::jsonb
  ) into v_route_corrections
  from (
    select jsonb_build_object(
      'public_id', c.rtc_,
      'decision_public_id', decision.rtd_,
      'outcome', c.outcome,
      'alt_skill_public_id', alt_skill.public_id,
      'alt_version_public_id', alt_version.public_id,
      'alt_release_public_id', alt_release.public_id,
      'created_at', c.created_at,
      'expires_at', c.expires_at
    ) as item,
    c.created_at as ord_created_at,
    c.rtc_ as ord_public_id
    from private.route_corrections as c
    join private.route_decisions as decision
      on decision.account_id = c.account_id
     and decision.device_id = c.device_id
     and decision.id = c.decision_id
    left join private.managed_skills as alt_skill
      on alt_skill.account_id = c.account_id and alt_skill.id = c.alt_managed_skill_id
    left join private.managed_skill_versions as alt_version
      on alt_version.account_id = c.account_id
     and alt_version.managed_skill_id = c.alt_managed_skill_id
     and alt_version.id = c.alt_version_id
    left join private.managed_skill_releases as alt_release
      on alt_release.account_id = c.account_id
     and alt_release.managed_skill_id = c.alt_managed_skill_id
     and alt_release.version_id = c.alt_version_id
     and alt_release.id = c.alt_release_id
    where c.account_id = v_account_id
    order by c.created_at desc, c.rtc_
    limit 1000
  ) as cb;

  -- ---------------------------------------------------------------------
  -- Assemble one deterministic, versioned, bounded jsonb object.
  -- ---------------------------------------------------------------------
  v_export := jsonb_build_object(
    'schema_version', '1.0',
    'generated_at', v_now,
    'sections', jsonb_build_object(
      'managed_skills', jsonb_build_object('count', jsonb_array_length(v_skills), 'total', v_skills_total, 'truncated', jsonb_array_length(v_skills) < v_skills_total, 'items', v_skills),
      'managed_skill_versions', jsonb_build_object('count', jsonb_array_length(v_versions), 'total', v_versions_total, 'truncated', jsonb_array_length(v_versions) < v_versions_total, 'items', v_versions),
      'managed_skill_releases', jsonb_build_object('count', jsonb_array_length(v_releases), 'total', v_releases_total, 'truncated', jsonb_array_length(v_releases) < v_releases_total, 'items', v_releases),
      'managed_skill_files', jsonb_build_object('count', jsonb_array_length(v_files), 'total', v_files_total, 'truncated', jsonb_array_length(v_files) < v_files_total, 'items', v_files),
      'devices', jsonb_build_object('count', jsonb_array_length(v_devices), 'total', v_devices_total, 'truncated', jsonb_array_length(v_devices) < v_devices_total, 'items', v_devices),
      'import_sessions', jsonb_build_object('count', jsonb_array_length(v_import_sessions), 'total', v_import_sessions_total, 'truncated', jsonb_array_length(v_import_sessions) < v_import_sessions_total, 'items', v_import_sessions),
      'import_file_receipts', jsonb_build_object('count', jsonb_array_length(v_import_receipts), 'total', v_import_receipts_total, 'truncated', jsonb_array_length(v_import_receipts) < v_import_receipts_total, 'items', v_import_receipts),
      'route_decisions', jsonb_build_object('count', jsonb_array_length(v_route_decisions), 'total', v_route_decisions_total, 'truncated', jsonb_array_length(v_route_decisions) < v_route_decisions_total, 'items', v_route_decisions),
      'route_decision_selections', jsonb_build_object('count', jsonb_array_length(v_route_selections), 'total', v_route_selections_total, 'truncated', jsonb_array_length(v_route_selections) < v_route_selections_total, 'items', v_route_selections),
      'route_corrections', jsonb_build_object('count', jsonb_array_length(v_route_corrections), 'total', v_route_corrections_total, 'truncated', jsonb_array_length(v_route_corrections) < v_route_corrections_total, 'items', v_route_corrections)
    )
  );

  -- Row caps alone cannot bound variable-width text. Refuse an oversized
  -- payload before it crosses the RPC boundary, even when every row count is
  -- within its section cap.
  if pg_catalog.octet_length(v_export::text) > 1048576 then
    raise exception 'managed vault export exceeds bounded response size'
      using errcode = '54000';
  end if;

  return v_export;
end;
$function$;

-- Least-privilege exposure: revoke everything first, then grant the exact
-- authenticated-only EXECUTE. anon, service_role, and the NOLOGIN definer
-- receive nothing, matching the account-deletion surface.
revoke all privileges on function api.export_my_managed_skill_vault()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function api.export_my_managed_skill_vault() to authenticated;

comment on function api.export_my_managed_skill_vault() is
  'Authenticated self-service export of every owned Skill Vault datum as one '
  'deterministic, versioned, bounded jsonb object. Returns only public '
  'identifiers and safe content/export references; never internal UUIDs, '
  'account ids, token/verifier/key material, manifest/body bytes, storage keys, '
  'foreign rows, cleanup internals, or worker fields. Revoked from every role '
  'and granted exact authenticated-execute only.';

commit;
