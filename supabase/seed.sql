begin;

insert into private.publishers (
  id, public_id, handle, display_name, verification_state, catalog_state, created_at, updated_at
) values (
  '10000000-0000-4000-8000-000000000001',
  'pub_00000000000000000000000000000001',
  '0x3-team',
  '0x3 Team',
  'unverified',
  'published',
  '2026-07-11T17:00:00Z',
  '2026-07-11T17:00:00Z'
);

insert into private.source_repositories (
  id, publisher_id, repository_url, catalog_state, created_at, updated_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://github.com/0x3-team/skillmap',
  'published',
  '2026-07-11T17:00:00Z',
  '2026-07-11T17:00:00Z'
);

insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
  capabilities, visibility_state, lifecycle_state, revoked_at, created_at, updated_at
) values
  (
    '30000000-0000-4000-8000-000000000001',
    'skl_00000000000000000000000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'skill-audit',
    'Skill Audit',
    'Audit a skill without treating structural checks as a safety certificate.',
    'Audits one immutable Agent Skill version for structure, scope, provenance, license, permissions, and operational risk. It reports evidence and remediation without running bundled scripts.',
    array['skill.audit', 'skill.provenance', 'skill.license'],
    'public',
    'published',
    null,
    '2026-07-11T17:00:00Z',
    '2026-07-11T18:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'skl_00000000000000000000000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'skill-quality-review',
    'Skill Quality Review',
    'Review trigger boundaries, instructions, failure handling, and evaluation readiness.',
    'Reviews one immutable Agent Skill version for reliable selection and use, including trigger boundaries, supporting instructions, failure recovery, overlap, and evaluation readiness.',
    array['skill.quality', 'skill.evaluation', 'skill.relationships'],
    'public',
    'published',
    null,
    '2026-07-11T17:00:00Z',
    '2026-07-11T17:59:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'skl_00000000000000000000000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'skill-supply-chain-review',
    'Skill Supply-Chain Review',
    'Review immutable identity, package integrity, licensing, updates, and revocation controls.',
    'Reviews source identity, package integrity, license evidence, update metadata, and revocation controls while keeping raw-source and normalized-artifact authorities separate.',
    array['skill.supply-chain', 'skill.integrity', 'skill.revocation'],
    'public',
    'published',
    null,
    '2026-07-11T17:00:00Z',
    '2026-07-11T17:58:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    'skl_00000000000000000000000000000004',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'draft-decoy',
    'Draft Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for lifecycle leak testing.',
    array['test.hidden'],
    'public',
    'draft',
    null,
    '2026-07-11T17:00:00Z',
    '2026-07-11T17:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    'skl_00000000000000000000000000000005',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'private-decoy',
    'Private Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for privacy and legal-state leak testing.',
    array['test.hidden'],
    'private',
    'published',
    null,
    '2026-07-11T17:00:00Z',
    '2026-07-11T17:00:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    'skl_00000000000000000000000000000006',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'revoked-decoy',
    'Revoked Decoy',
    'RLS fixture that must never be public.',
    'A deterministic local-only fixture for revocation and stale-state leak testing.',
    array['test.hidden'],
    'public',
    'published',
    '2026-07-11T17:30:00Z',
    '2026-07-11T17:00:00Z',
    '2026-07-11T17:30:00Z'
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
    '40000000-0000-4000-8000-000000000001',
    'skv_00000000000000000000000000000001',
    '30000000-0000-4000-8000-000000000001',
    '1.0.0',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-audit/SKILL.md',
    'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
    null, 'metadata-only', null, null,
    'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T18:00:00Z', null, null,
    '2026-07-11T18:00:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    'skv_00000000000000000000000000000002',
    '30000000-0000-4000-8000-000000000002',
    '1.0.0',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-quality-review/SKILL.md',
    'sha256:d38ab7b682ef41dcce18debc7a77857031951ba54b16b53a78a57e48b30745c3',
    null, 'metadata-only', null, null,
    'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T17:59:00Z', null, null,
    '2026-07-11T17:59:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    'skv_00000000000000000000000000000003',
    '30000000-0000-4000-8000-000000000003',
    '1.0.0',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-supply-chain-review/SKILL.md',
    'sha256:864b0ed1c29d04a67e3b8aeb9fffd5fa13e534474acfcf3612e6fe14e686a170',
    null, 'metadata-only', null, null,
    'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T17:58:00Z', null, null,
    '2026-07-11T17:58:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    'skv_00000000000000000000000000000004',
    '30000000-0000-4000-8000-000000000004',
    '0.0.0-draft',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-audit/SKILL.md',
    'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
    null, 'metadata-only', null, null,
    'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T17:10:00Z', '2026-07-11T17:20:00Z', null,
    '2026-07-11T17:10:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    'skv_00000000000000000000000000000005',
    '30000000-0000-4000-8000-000000000005',
    '0.0.0-private',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-quality-review/SKILL.md',
    'sha256:d38ab7b682ef41dcce18debc7a77857031951ba54b16b53a78a57e48b30745c3',
    null, 'metadata-only', null, null,
    'restricted', null, 'blocked', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T17:09:00Z', null, null,
    '2026-07-11T17:09:00Z'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    'skv_00000000000000000000000000000006',
    '30000000-0000-4000-8000-000000000006',
    '0.0.0-revoked',
    '5bcee4b7d0e8c8c2723e34f79a0ebe67c039e418',
    'catalog/first-party/skill-supply-chain-review/SKILL.md',
    'sha256:864b0ed1c29d04a67e3b8aeb9fffd5fa13e534474acfcf3612e6fe14e686a170',
    null, 'metadata-only', null, null,
    'confirmed', 'MIT', 'metadata-only', array['LICENSE'],
    'not-tested', null, null,
    false, '{}'::text[], '{}'::text[],
    'unverified', 'not-run', 'not-tested',
    'ungraded', array['evaluation-not-run'], 'published', '2026-07-11T17:08:00Z', null, '2026-07-11T17:30:00Z',
    '2026-07-11T17:08:00Z'
  );

update private.skills
set current_version_id = case id
  when '30000000-0000-4000-8000-000000000001' then '40000000-0000-4000-8000-000000000001'::uuid
  when '30000000-0000-4000-8000-000000000002' then '40000000-0000-4000-8000-000000000002'::uuid
  when '30000000-0000-4000-8000-000000000003' then '40000000-0000-4000-8000-000000000003'::uuid
  when '30000000-0000-4000-8000-000000000004' then '40000000-0000-4000-8000-000000000004'::uuid
  when '30000000-0000-4000-8000-000000000005' then '40000000-0000-4000-8000-000000000005'::uuid
  when '30000000-0000-4000-8000-000000000006' then '40000000-0000-4000-8000-000000000006'::uuid
end;

insert into private.skill_relationships (
  id, source_version_id, relationship_type, target_skill_id, evidence_state, reason, created_at
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'alternative',
    '30000000-0000-4000-8000-000000000002',
    'declared',
    'Both review skill quality, but this one emphasizes catalog risk and provenance.',
    '2026-07-11T18:00:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'alternative',
    '30000000-0000-4000-8000-000000000001',
    'declared',
    'Both review a skill, but this one emphasizes trigger quality and evaluation readiness.',
    '2026-07-11T18:00:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000003',
    'complement',
    '30000000-0000-4000-8000-000000000001',
    'declared',
    'Supply-chain evidence complements catalog and operational risk review.',
    '2026-07-11T18:00:00Z'
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'authenticated', 'authenticated', 'phase1-a@skillmap.invalid', '', '2026-07-11T18:00:00Z',
    '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
    '2026-07-11T18:00:00Z', '2026-07-11T18:00:00Z', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
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

commit;
