-- Local pgTAP-only lifecycle and identity fixtures. The non-.sql suffix keeps
-- this helper out of automatic test discovery; the pgTAP transaction loads it.

insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
  capabilities, visibility_state, lifecycle_state, revoked_at, created_at, updated_at
) values
  (
    '30000000-0000-4000-8000-000000000004',
    'skl_00000000000000000000000000000004',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'draft-decoy', 'Draft Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for lifecycle leak testing.',
    array['test.hidden'], 'public', 'draft', null,
    '2026-07-11T17:00:00Z', '2026-07-11T17:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    'skl_00000000000000000000000000000005',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'private-decoy', 'Private Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for privacy and legal-state leak testing.',
    array['test.hidden'], 'private', 'published', null,
    '2026-07-11T17:00:00Z', '2026-07-11T17:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    'skl_00000000000000000000000000000006',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'revoked-decoy', 'Revoked Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for revocation and stale-state leak testing.',
    array['test.hidden'], 'public', 'published', '2026-07-11T17:30:00Z',
    '2026-07-11T17:00:00Z', '2026-07-11T17:30:00Z'
  );

insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path, entrypoint_content_digest,
  raw_snapshot_digest, artifact_availability, normalized_artifact_digest, manifest_digest,
  license_state, spdx_expression, redistribution_state, license_files,
  compatibility_state, compatibility_profile_version, compatibility_evidence_digest,
  permission_scripts, permission_network, permission_tools,
  evidence_provenance_state, evidence_audit_state, evidence_compatibility_state,
  grade_state, grade_reason_codes, publication_state, published_at, quarantined_at, revoked_at, created_at
) values
  (
    '40000000-0000-4000-8000-000000000004',
    'skv_00000000000000000000000000000004',
    '30000000-0000-4000-8000-000000000004', '0.0.0-draft',
    'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
    'catalog/first-party/skill-audit/SKILL.md',
    'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
    null, 'metadata-only', null, null, 'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null, false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested', 'ungraded', array['evaluation-not-run'],
    'published', '2026-07-11T17:10:00Z', '2026-07-11T17:20:00Z', null, '2026-07-11T17:10:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    'skv_00000000000000000000000000000005',
    '30000000-0000-4000-8000-000000000005', '0.0.0-private',
    'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
    'catalog/first-party/skill-quality-review/SKILL.md',
    'sha256:d38ab7b682ef41dcce18debc7a77857031951ba54b16b53a78a57e48b30745c3',
    null, 'metadata-only', null, null, 'restricted', null, 'blocked', array['LICENSE'],
    'not-tested', null, null, false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested', 'ungraded', array['evaluation-not-run'],
    'published', '2026-07-11T17:09:00Z', null, null, '2026-07-11T17:09:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    'skv_00000000000000000000000000000006',
    '30000000-0000-4000-8000-000000000006', '0.0.0-revoked',
    'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
    'catalog/first-party/skill-supply-chain-review/SKILL.md',
    'sha256:295ad7b51050d476e91e4f84bbe6ec184d66452faa6956bd3f54ee1499c683ab',
    null, 'metadata-only', null, null, 'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null, false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested', 'ungraded', array['evaluation-not-run'],
    'published', '2026-07-11T17:08:00Z', null, '2026-07-11T17:30:00Z', '2026-07-11T17:08:00Z'
  );

update private.skills
set current_version_id = case id
  when '30000000-0000-4000-8000-000000000004' then '40000000-0000-4000-8000-000000000004'::uuid
  when '30000000-0000-4000-8000-000000000005' then '40000000-0000-4000-8000-000000000005'::uuid
  when '30000000-0000-4000-8000-000000000006' then '40000000-0000-4000-8000-000000000006'::uuid
end
where id in (
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'authenticated', 'authenticated', 'phase1-a@skillmap.invalid', '', '2026-07-11T18:00:00Z',
    '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
    '2026-07-11T18:00:00Z', '2026-07-11T18:00:00Z', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'authenticated', 'authenticated', 'phase1-b@skillmap.invalid', '', '2026-07-11T18:00:00Z',
    '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
    '2026-07-11T18:00:00Z', '2026-07-11T18:00:00Z', '', '', '', ''
  );

insert into private.publisher_members (publisher_id, user_id, role, created_at)
values (
  '10000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'owner',
  '2026-07-11T18:00:00Z'
);
