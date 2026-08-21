begin;

set local search_path = '';

create function private.my_owner_import_dashboard()
returns table (h_projection jsonb)
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'sessionId', sessions.imp_,
    'state', case
      when sessions.state in ('cancelled', 'expired') or sessions.expiry_at <= pg_catalog.statement_timestamp() then 'stale'
      when sessions.state = 'verified' then 'consented'
      when sessions.accepted_file_count = sessions.expected_file_count then 'ready_for_consent'
      when sessions.accepted_file_count > 0 then 'partial'
      else 'preview'
    end,
    'device', pg_catalog.jsonb_build_object(
      'id', devices.public_id,
      'name', coalesce(devices.display_name, 'SkillMap connector'),
      'platform', devices.platform
    ),
    'summary', pg_catalog.jsonb_build_object(
      'totalSkills', 1,
      'totalFiles', sessions.expected_file_count,
      'totalBytes', sessions.expected_byte_total,
      'duplicateCount', 0,
      'warningCount', 0,
      'blockedCount', 0,
      'excludedCount', 0,
      'manifestDigest', sessions.manifest_digest
    ),
    'skills', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'skillName', skills.display_name,
        'sourceType', coalesce(versions.source ->> 'kind', 'managed import'),
        'status', 'ready',
        'fileCount', sessions.expected_file_count,
        'byteTotal', sessions.expected_byte_total,
        'manifestDigest', sessions.manifest_digest,
        'contentDigest', sessions.content_digest,
        'files', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'relativePath', files.relative_path,
              'byteSize', files.byte_size,
              'digest', files.file_digest
            ) order by files.ordinal
          )
          from private.managed_skill_files as files
          where files.account_id = sessions.account_id
            and files.managed_skill_id = sessions.managed_skill_id
            and files.version_id = sessions.version_id
        ), '[]'::jsonb),
        'warnings', '[]'::jsonb,
        'blockedReasons', '[]'::jsonb,
        'isDuplicate', false,
        'excluded', false
      )
    ),
    'uploadProgress', pg_catalog.jsonb_build_object(
      'acceptedFileCount', sessions.accepted_file_count,
      'acceptedByteTotal', sessions.accepted_byte_total,
      'expectedFileCount', sessions.expected_file_count,
      'expectedByteTotal', sessions.expected_byte_total
    ),
    'createdAt', sessions.created_at,
    'expiresAt', sessions.expiry_at,
    'revision', sessions.revision
  )
  from private.import_sessions as sessions
  join private.devices as devices
    on devices.account_id = sessions.account_id
   and devices.id = sessions.device_id
  join private.managed_skills as skills
    on skills.account_id = sessions.account_id
   and skills.id = sessions.managed_skill_id
  join private.managed_skill_versions as versions
    on versions.account_id = sessions.account_id
   and versions.managed_skill_id = sessions.managed_skill_id
   and versions.id = sessions.version_id
  where sessions.account_id = (select private.current_request_uid())
  order by sessions.created_at desc, sessions.imp_
  limit 20;
$function$;

revoke all privileges on function private.my_owner_import_dashboard()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_owner_import_dashboard() to authenticated;

create view api.my_import_dashboard
with (security_invoker = true, security_barrier = true)
as select h_projection as projection
from private.my_owner_import_dashboard();

revoke all privileges on table api.my_import_dashboard
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_import_dashboard to authenticated;

comment on view api.my_import_dashboard is
  'Owner-only dashboard-safe M4 import projection with public identifiers, relative paths, counts, and digests only.';

commit;
