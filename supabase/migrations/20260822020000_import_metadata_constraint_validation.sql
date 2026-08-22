begin;

set local search_path = '';

-- Keep validation in its own transaction after the NOT VALID creation and
-- dashboard-function migrations have committed. This bounds the lock window
-- to the validation work and prevents unrelated DDL from sharing it.
alter table private.managed_skills
  validate constraint managed_skills_display_name_length_check;
alter table private.managed_skill_versions
  validate constraint managed_skill_versions_canonical_metadata_check;

commit;
