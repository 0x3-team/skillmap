-- API-smoke cleanup; the non-.sql suffix prevents automatic pgTAP discovery.
update private.skills
set current_version_id = null
where id = '30000000-0000-4000-8000-000000000004';

delete from private.skill_versions
where id = '40000000-0000-4000-8000-000000000004';

delete from private.skills
where id = '30000000-0000-4000-8000-000000000004';
