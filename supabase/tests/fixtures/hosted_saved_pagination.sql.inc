-- Auth-smoke-only public rows. The non-.sql suffix prevents automatic pgTAP
-- discovery; the browser smoke installs and removes this bounded corpus.
begin;

insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name, summary,
  description, capabilities, visibility_state, lifecycle_state, created_at, updated_at
)
select
  ('51000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'skl_' || lpad(to_hex(65536 + sequence), 32, '0'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  'pagination-test-' || lpad(sequence::text, 3, '0'),
  'Pagination Test ' || lpad(sequence::text, 3, '0'),
  'Synthetic local row used only to prove saved-skill keyset pagination.',
  'This bounded record is installed only during the authenticated local browser smoke and is never deployable catalog seed data.',
  array['test.pagination'],
  'public',
  'published',
  '2026-07-11T19:00:00Z'::timestamptz,
  '2026-07-11T19:00:00Z'::timestamptz
from generate_series(1, 52) as sequence;

insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path,
  entrypoint_content_digest, artifact_availability, license_state, spdx_expression,
  redistribution_state, compatibility_state, evidence_provenance_state,
  evidence_audit_state, evidence_compatibility_state, grade_state,
  grade_reason_codes, publication_state, published_at, created_at
)
select
  ('52000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  'skv_' || lpad(to_hex(131072 + sequence), 32, '0'),
  ('51000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '1.0.0',
  'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
  'test/pagination/' || lpad(sequence::text, 3, '0') || '/SKILL.md',
  'sha256:' || lpad(to_hex(196608 + sequence), 64, '0'),
  'metadata-only',
  'confirmed',
  'MIT',
  'metadata-only',
  'not-tested',
  'unverified',
  'not-run',
  'not-tested',
  'ungraded',
  array['evaluation-not-run'],
  'published',
  '2026-07-11T19:00:00Z'::timestamptz,
  '2026-07-11T19:00:00Z'::timestamptz
from generate_series(1, 52) as sequence;

update private.skills
set current_version_id = ('52000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid
from generate_series(1, 52) as sequence
where private.skills.id = ('51000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid;

commit;
