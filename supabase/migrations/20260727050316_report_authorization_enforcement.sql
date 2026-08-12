begin;

-- A report is meaningful only while its exact target is still part of the
-- public catalog. Publisher authorization is time-bound and revocable, so the
-- report insert boundary must compose the same authorization predicate as the
-- public projections instead of accepting a now-hidden version by public ID.
create or replace function private.enforce_skill_report_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if (select auth.role()) <> 'authenticated' or caller_id is null
    or new.reporter_user_id is distinct from caller_id then
    raise exception 'authenticated report ownership is required' using errcode = '42501';
  end if;
  if new.message is distinct from btrim(new.message)
    or new.message is distinct from normalize(new.message, NFC)
    or length(new.message) not between 10 and 2000
    or new.message ~ '[[:cntrl:]]' then
    raise exception 'report message is not canonical' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 7321));
  if (select count(*) from api.skill_reports report
      where report.reporter_user_id = caller_id and report.state = 'queued') >= 5 then
    raise exception 'report active limit exceeded' using errcode = 'P0003';
  end if;
  if (select count(*) from api.skill_reports report
      where report.reporter_user_id = caller_id
        and report.created_at >= now() - interval '24 hours') >= 20 then
    raise exception 'report rolling limit exceeded' using errcode = 'P0004';
  end if;
  if not exists (
    select 1
    from private.skills skill
    join private.skill_versions version on version.skill_id = skill.id
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where skill.public_id = new.skill_id and version.public_id = new.version_id
      and skill.current_version_id = version.id
      and publisher.catalog_state = 'published' and publisher.revoked_at is null
      and repository.catalog_state = 'published' and repository.revoked_at is null
      and skill.visibility_state = 'public'
      and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
      and version.publication_state = 'published'
      and version.license_state <> 'restricted'
      and version.quarantined_at is null and version.revoked_at is null
      and private.version_has_current_publisher_authorization(version.id)
  ) then
    raise exception 'report target is not an exact current public listing' using errcode = '23514';
  end if;
  if exists (
    select 1 from api.skill_reports report
    where report.reporter_user_id = caller_id
      and report.version_id = new.version_id and report.category = new.category
      and report.created_at >= now() - interval '24 hours'
  ) then
    raise exception 'report cooldown active for this target and category' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function private.enforce_skill_report_insert() is
  'Validates authenticated bounded reports against the exact currently public and publisher-authorized catalog version.';

commit;
