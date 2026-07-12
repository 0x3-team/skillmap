-- API-smoke-only hidden record. The non-.sql suffix prevents automatic pgTAP
-- discovery; the smoke runner installs and removes it around its comparison.
insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
  capabilities, visibility_state, lifecycle_state, revoked_at, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000004',
  'skl_00000000000000000000000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'api-hidden-fixture', 'API Hidden Fixture',
  'Test-only record that must never be public.',
  'Installed only around the hosted API hidden-versus-nonexistent parity smoke.',
  array['test.hidden'], 'private', 'published', null,
  '2026-07-11T17:00:00Z', '2026-07-11T17:00:00Z'
);

insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path, entrypoint_content_digest,
  raw_snapshot_digest, artifact_availability, normalized_artifact_digest, manifest_digest,
  license_state, spdx_expression, redistribution_state, license_files,
  compatibility_state, compatibility_profile_version, compatibility_evidence_digest,
  permission_scripts, permission_network, permission_tools,
  evidence_provenance_state, evidence_audit_state, evidence_compatibility_state,
  grade_state, grade_reason_codes, publication_state, published_at, quarantined_at, revoked_at, created_at
) values (
  '40000000-0000-4000-8000-000000000004',
  'skv_00000000000000000000000000000004',
  '30000000-0000-4000-8000-000000000004', '0.0.0-api-hidden',
  'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
  'catalog/first-party/skill-audit/SKILL.md',
  'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
  null, 'metadata-only', null, null, 'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
  'not-tested', null, null, false, '{}'::text[], '{}'::text[],
  'unverified', 'not-run', 'not-tested', 'ungraded', array['evaluation-not-run'],
  'published', '2026-07-11T17:00:00Z', null, null, '2026-07-11T17:00:00Z'
);

update private.skills
set current_version_id = '40000000-0000-4000-8000-000000000004'
where id = '30000000-0000-4000-8000-000000000004';
