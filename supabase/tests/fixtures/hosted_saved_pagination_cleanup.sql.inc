-- Auth-smoke cleanup; the non-.sql suffix prevents automatic pgTAP discovery.
begin;

update private.skills
set current_version_id = null
where id between
  '51000000-0000-4000-8000-000000000001'::uuid and
  '51000000-0000-4000-8000-000000000052'::uuid;

delete from private.skill_versions
where skill_id between
  '51000000-0000-4000-8000-000000000001'::uuid and
  '51000000-0000-4000-8000-000000000052'::uuid;

delete from private.skills
where id between
  '51000000-0000-4000-8000-000000000001'::uuid and
  '51000000-0000-4000-8000-000000000052'::uuid;

commit;
