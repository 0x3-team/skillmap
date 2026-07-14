begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

select plan(97);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname, c.relname) in (
      ('private', 'publishers'), ('private', 'publisher_members'),
      ('private', 'source_repositories'), ('private', 'skills'),
      ('private', 'skill_versions'), ('private', 'skill_relationships'),
      ('private', 'audit_events'), ('api', 'profiles'), ('api', 'saved_skills')
    )),
    9::bigint,
    'the named Phase 1 boundary contains exactly its nine API/private tables'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname, c.relname) in (
      ('private', 'publishers'), ('private', 'publisher_members'),
      ('private', 'source_repositories'), ('private', 'skills'),
      ('private', 'skill_versions'), ('private', 'skill_relationships'),
      ('private', 'audit_events'), ('api', 'profiles'), ('api', 'saved_skills')
    )
      and c.relrowsecurity and c.relforcerowsecurity),
    9::bigint,
    'every named Phase 1 table enables and forces RLS'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'api' and c.relkind = 'v'
      and c.relname in ('catalog_skill_versions', 'catalog_skills', 'catalog_skill_relationships', 'saved_skill_catalog')),
    4::bigint,
    'the named Phase 1 API boundary contains exactly its four explicit views'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'api' and c.relkind = 'v'
      and c.relname in ('catalog_skill_versions', 'catalog_skills', 'catalog_skill_relationships', 'saved_skill_catalog')
      and c.reloptions @> array['security_invoker=true', 'security_barrier=true']),
    4::bigint,
    'every named Phase 1 view is a security-invoker security-barrier view'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef and p.proname not in (
      'peek_skill_submission_candidate', 'claim_skill_submission',
      'defer_skill_submission_provider_limit', 'complete_skill_submission', 'requeue_skill_submission',
      'dead_letter_expired_skill_submission',
      'publish_skill_submission', 'delete_my_account', 'disposition_skill_report',
      'control_catalog_lifecycle', 'renew_skill_submission_claim', 'list_skill_report_queue',
      'list_skill_submission_collisions', 'review_skill_submission_collisions',
      'record_skill_submission_publisher_authorization',
      'record_skill_submission_license_evidence',
      'get_skill_submission_queue_summary',
      'list_skill_submission_operator_queue',
      'get_skill_submission_operator_detail'
    )),
    0::bigint,
    'no security-definer function exists outside the explicit hosted operator allowlist'
);
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'api' and table_name = 'saved_skill_catalog' and column_name = 'user_id'),
  0::bigint,
  'the saved catalog projection does not transport the private account identifier'
);

select ok(has_table_privilege('anon', 'api.catalog_skills', 'select'), 'anonymous users can select the public catalog');
select ok(has_table_privilege('authenticated', 'api.catalog_skills', 'select'), 'authenticated users can select the public catalog');
select ok(not has_table_privilege('anon', 'api.profiles', 'select'), 'anonymous users cannot read profiles');
select ok(has_table_privilege('authenticated', 'api.profiles', 'select'), 'authenticated users can select profiles under RLS');
select ok(has_column_privilege('authenticated', 'api.profiles', 'user_id', 'insert'), 'authenticated users can insert their own profile identity');
select ok(not has_table_privilege('authenticated', 'api.profiles', 'update'), 'profiles cannot be updated in Phase 1');
select ok(not has_table_privilege('authenticated', 'api.profiles', 'delete'), 'profiles cannot be deleted in Phase 1');
select ok(has_table_privilege('authenticated', 'api.saved_skills', 'select'), 'authenticated users can select saved skills under RLS');
select ok(has_table_privilege('authenticated', 'api.saved_skills', 'insert'), 'authenticated users can save a public skill');
select ok(has_table_privilege('authenticated', 'api.saved_skills', 'delete'), 'authenticated users can remove their own save');
select ok(not has_table_privilege('authenticated', 'api.saved_skills', 'update'), 'saved skills cannot be updated');
select ok(not has_table_privilege('service_role', 'api.catalog_skills', 'select'), 'service_role receives no premature catalog privilege');
select ok(not has_table_privilege('service_role', 'private.skills', 'select'), 'service_role receives no premature private privilege');
select ok(has_table_privilege('anon', 'private.skills', 'select'), 'anonymous invoker views have the minimum underlying SELECT grant');
select ok(not has_table_privilege('anon', 'private.skills', 'insert'), 'anonymous users have no private catalog INSERT grant');
select ok(not has_table_privilege('authenticated', 'private.audit_events', 'select'), 'authenticated users cannot read private audit events');
select ok(not has_table_privilege('authenticated', 'private.publisher_members', 'select'), 'publisher membership does not grant direct draft access');

set local role anon;

select is((select count(*) from private.skills), 3::bigint, 'anonymous direct-base skill reads contain only the three public seeds');
select is((select count(*) from private.skill_versions), 3::bigint, 'anonymous direct-base version reads contain only the three distributable seeds');
select is((select count(*) from api.catalog_skills), 3::bigint, 'anonymous catalog view contains exactly three public skills');
select is(
  (select count(*) from api.catalog_skills where slug in ('draft-decoy', 'private-decoy', 'revoked-decoy')),
  0::bigint,
  'draft, private, and revoked fixtures do not leak'
);
select is((select count(*) from api.catalog_skill_relationships), 3::bigint, 'only the three declared public relationships are visible');
select is(
  (select string_agg(slug, ',' order by published_at desc, skill_id) from api.catalog_skills),
  'skill-audit,skill-quality-review,skill-supply-chain-review',
  'catalog order is published_at descending and skill_id ascending'
);
select is(
  (select count(*) from api.catalog_skill_versions
    where evidence_provenance_state = 'unverified'
      and evidence_audit_state = 'not-run'
      and evidence_compatibility_state = 'not-tested'
      and grade_state = 'ungraded'),
  3::bigint,
  'seed trust labels do not fabricate provenance, audit, compatibility, or grades'
);
select is(
  (select count(*) from api.catalog_skill_versions
    where entrypoint_content_digest is not null
      and raw_snapshot_digest is null
      and normalized_artifact_digest is null
      and manifest_digest is null),
  3::bigint,
  'entrypoint digests are present while canonical package digests remain pending'
);
select is(
  (select count(*) from api.catalog_skills where search_document @@ websearch_to_tsquery('simple', 'quality')),
  1::bigint,
  'full-text search returns the bounded quality-review match'
);
select throws_ok(
  $$insert into private.skills (public_id) values ('skl_ffffffffffffffffffffffffffffffff')$$,
  42501,
  null,
  'anonymous users cannot insert catalog rows'
);

reset role;

select throws_ok(
  $$insert into private.source_repositories (id, publisher_id, repository_url, catalog_state)
    values (
      '22000000-0000-4000-8000-000000000099',
      '10000000-0000-4000-8000-000000000001',
      'https://user:token@example.invalid/repository',
      'draft'
    )$$,
  23514,
  null,
  'repository coordinates reject embedded credentials'
);
select throws_ok(
  $$insert into private.source_repositories (id, publisher_id, repository_url, catalog_state)
    values (
      '22000000-0000-4000-8000-000000000099',
      '10000000-0000-4000-8000-000000000001',
      'https://example.invalid/repository?token=secret',
      'draft'
    )$$,
  23514,
  null,
  'repository coordinates reject query credentials and signed URLs'
);

insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path,
  entrypoint_content_digest, artifact_availability, license_state,
  spdx_expression, redistribution_state, license_files,
  publication_state, published_at
)
select
  '40000000-0000-4000-8000-000000000007',
  'skv_00000000000000000000000000000007',
  skill_id,
  '0.9.0-history',
  source_commit,
  source_path,
  entrypoint_content_digest,
  artifact_availability,
  license_state,
  spdx_expression,
  redistribution_state,
  license_files,
  'published',
  '2026-07-10T17:00:00Z'
from private.skill_versions
where id = '40000000-0000-4000-8000-000000000001';

insert into private.skill_relationships (
  id, source_version_id, relationship_type, target_skill_id,
  evidence_state, reason, created_at
) values (
  '50000000-0000-4000-8000-000000000007',
  '40000000-0000-4000-8000-000000000007',
  'alternative',
  '30000000-0000-4000-8000-000000000002',
  'declared',
  'Historical relationship must not contaminate the current version.',
  '2026-07-10T17:00:00Z'
);

set local role anon;
select is(
  (select count(*) from api.catalog_skill_relationships
    where source_version_id = 'skv_00000000000000000000000000000007'),
  0::bigint,
  'historical-version relationships do not contaminate current skill detail'
);
reset role;

update private.publishers set catalog_state = 'blocked' where public_id = 'pub_00000000000000000000000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 0::bigint, 'a blocked publisher removes every catalog projection');
select is((select count(*) from private.skills), 0::bigint, 'skill base RLS composes blocked publisher state');
select is((select count(*) from private.skill_versions), 0::bigint, 'version base RLS composes blocked publisher state');
reset role;
update private.publishers set catalog_state = 'published' where public_id = 'pub_00000000000000000000000000000001';

update private.publishers set revoked_at = '2026-07-11T19:15:00Z' where public_id = 'pub_00000000000000000000000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 0::bigint, 'a revoked publisher removes every catalog projection');
reset role;
update private.publishers set revoked_at = null where public_id = 'pub_00000000000000000000000000000001';

update private.source_repositories set catalog_state = 'blocked' where id = '20000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 0::bigint, 'a blocked repository removes every catalog projection');
select is((select count(*) from private.skills), 0::bigint, 'skill base RLS composes blocked repository state');
select is((select count(*) from private.skill_versions), 0::bigint, 'version base RLS composes blocked repository state');
reset role;
update private.source_repositories set catalog_state = 'published' where id = '20000000-0000-4000-8000-000000000001';

update private.source_repositories set revoked_at = '2026-07-11T19:15:00Z' where id = '20000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 0::bigint, 'a revoked repository removes every catalog projection');
reset role;
update private.source_repositories set revoked_at = null where id = '20000000-0000-4000-8000-000000000001';

update private.skills set visibility_state = 'private' where id = '30000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a private skill is independently excluded');
reset role;
update private.skills set visibility_state = 'public' where id = '30000000-0000-4000-8000-000000000001';

update private.skills set lifecycle_state = 'draft' where id = '30000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a draft skill is independently excluded');
reset role;
update private.skills set lifecycle_state = 'published' where id = '30000000-0000-4000-8000-000000000001';

update private.skills set revoked_at = '2026-07-11T19:15:00Z' where id = '30000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a revoked skill is independently excluded');
reset role;
update private.skills set revoked_at = null where id = '30000000-0000-4000-8000-000000000001';

update private.skill_versions set publication_state = 'draft' where id = '40000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a draft version is independently excluded');
reset role;
update private.skill_versions set publication_state = 'published' where id = '40000000-0000-4000-8000-000000000001';

update private.skill_versions set redistribution_state = 'blocked' where id = '40000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a redistribution-blocked version is independently excluded');
reset role;
update private.skill_versions set redistribution_state = 'metadata-only' where id = '40000000-0000-4000-8000-000000000001';

update private.skill_versions set license_state = 'restricted', spdx_expression = null where id = '40000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a restricted-license version is independently excluded');
reset role;
update private.skill_versions set license_state = 'confirmed', spdx_expression = 'MIT' where id = '40000000-0000-4000-8000-000000000001';

update private.skill_versions set quarantined_at = '2026-07-11T19:15:00Z' where id = '40000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a quarantined version is independently excluded');
reset role;
update private.skill_versions set quarantined_at = null where id = '40000000-0000-4000-8000-000000000001';

update private.skill_versions set revoked_at = '2026-07-11T19:15:00Z' where id = '40000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from api.catalog_skills), 2::bigint, 'a revoked version is independently excluded');
reset role;
update private.skill_versions set revoked_at = null where id = '40000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);

select is((select count(*) from private.skills), 3::bigint, 'a publisher owner still sees no draft catalog rows');
select throws_ok(
  $$update private.skills set display_name = 'tampered' where public_id = 'skl_00000000000000000000000000000001'$$,
  42501,
  null,
  'a publisher owner cannot mutate catalog truth in Phase 1'
);
select lives_ok(
  $$insert into api.profiles (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'user A can insert their own profile'
);
select throws_ok(
  $$insert into api.profiles (user_id, created_at) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '2020-01-01T00:00:00Z'
  )$$,
  42501,
  null,
  'authenticated profiles cannot forge their server-owned creation time'
);
select is((select count(*) from api.profiles), 1::bigint, 'user A can read their own profile');
select throws_ok(
  $$insert into api.profiles (user_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  42501,
  null,
  'user A cannot insert user B profile'
);
select is(
  (select count(*) from api.profiles where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  0::bigint,
  'user A cannot read user B profile'
);
select lives_ok(
  $$insert into api.saved_skills (user_id, skill_id) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'skl_00000000000000000000000000000001'
  )$$,
  'user A can save a public skill'
);
select throws_ok(
  $$insert into api.saved_skills (user_id, skill_id) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'skl_00000000000000000000000000000004'
  )$$,
  42501,
  null,
  'user A cannot save a draft skill'
);
select throws_ok(
  $$insert into api.saved_skills (user_id, skill_id) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'skl_ffffffffffffffffffffffffffffffff'
  )$$,
  42501,
  null,
  'user A cannot save a nonexistent skill'
);
select is((select count(*) from api.saved_skills), 1::bigint, 'user A sees exactly their public saved skill');

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);

select is((select count(*) from api.saved_skills), 0::bigint, 'user B cannot see user A saved skill');
select is_empty(
  $$delete from api.saved_skills
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    returning 1$$,
  'user B cannot delete user A saved skill'
);

reset role;

update private.skills
set revoked_at = '2026-07-11T19:30:00Z'
where public_id = 'skl_00000000000000000000000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);

select is((select count(*) from api.saved_skill_catalog), 0::bigint, 'a save disappears from the catalog projection immediately after revocation');
select results_eq(
  $$delete from api.saved_skills
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and skill_id = 'skl_00000000000000000000000000000001'
    returning 1$$,
  $$values (1)$$,
  'the owner can still delete a save after catalog revocation'
);

reset role;

select throws_ok(
  $$insert into private.skills (
      id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
      visibility_state, lifecycle_state
    ) values (
      '30000000-0000-4000-8000-000000000007', 'skl_invalid',
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'invalid-id-fixture', 'Invalid ID', 'Must fail.', 'Must fail ID validation.', 'private', 'draft'
    )$$,
  23514,
  null,
  'invalid hosted skill IDs fail their check constraint'
);
select throws_ok(
  $$insert into private.skills (
      id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
      visibility_state, lifecycle_state
    ) values (
      '30000000-0000-4000-8000-000000000007', 'skl_00000000000000000000000000000007',
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'skill-audit', 'Duplicate Slug', 'Must fail.', 'Must fail coordinate uniqueness.', 'private', 'draft'
    )$$,
  23505,
  null,
  'publisher slug coordinates are unique'
);

insert into private.publishers (
  id, public_id, handle, display_name, verification_state, catalog_state
) values (
  '11000000-0000-4000-8000-000000000002',
  'pub_fffffffffffffffffffffffffffffff2',
  'other-publisher',
  'Other Publisher',
  'unverified',
  'draft'
);

insert into private.source_repositories (
  id, publisher_id, repository_url, catalog_state
) values (
  '22000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  'https://github.com/example-owner/other-repository',
  'draft'
);

select throws_ok(
  $$update private.publishers
    set public_id = 'pub_fffffffffffffffffffffffffffffff1'
    where id = '10000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'publisher public identity is immutable'
);
select throws_ok(
  $$update private.publishers
    set handle = 'renamed-publisher'
    where id = '10000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'publisher handles are frozen until alias history exists'
);
select throws_ok(
  $$update private.source_repositories
    set repository_url = 'https://github.com/example-owner/reassigned'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'repository coordinates are immutable'
);
select throws_ok(
  $$update private.source_repositories
    set publisher_id = '11000000-0000-4000-8000-000000000002'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'repository publisher ownership is immutable'
);
select throws_ok(
  $$update private.skills
    set public_id = 'skl_fffffffffffffffffffffffffffffff4'
    where id = '30000000-0000-4000-8000-000000000004'$$,
  23514,
  null,
  'skill public identity is immutable'
);
select throws_ok(
  $$update private.skills
    set slug = 'renamed-draft'
    where id = '30000000-0000-4000-8000-000000000004'$$,
  23514,
  null,
  'skill slugs are frozen until alias history exists'
);
select throws_ok(
  $$update private.skills
    set source_repository_id = '22000000-0000-4000-8000-000000000002'
    where id = '30000000-0000-4000-8000-000000000004'$$,
  23514,
  null,
  'skill repository ownership cannot be reassigned'
);
select throws_ok(
  $$update private.skill_versions
    set public_id = 'skv_fffffffffffffffffffffffffffffff1'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'skill-version public identity is immutable'
);
select throws_ok(
  $$insert into private.skills (
      id, public_id, publisher_id, source_repository_id, slug, display_name, summary, description,
      visibility_state, lifecycle_state
    ) values (
      '33000000-0000-4000-8000-000000000008', 'skl_00000000000000000000000000000008',
      '10000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002',
      'cross-wired-source', 'Cross-Wired Source', 'Must fail.', 'Must fail publisher ownership.', 'private', 'draft'
    )$$,
  23503,
  null,
  'a skill cannot point at another publisher repository'
);
select throws_ok(
  $$update private.skill_versions
    set redistribution_state = 'mirrored'
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'mirrored redistribution requires a confirmed mirrored artifact with canonical digests'
);
select throws_ok(
  $$update private.publishers
    set verification_state = 'identity-verified'
    where id = '10000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'publisher verification cannot advance without a receipt model'
);
select throws_ok(
  $$update private.skill_versions
    set evidence_provenance_state = 'source-pinned'
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'provenance cannot advance without a receipt model'
);
select throws_ok(
  $$update private.skill_versions
    set evidence_audit_state = 'passed'
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'audit state cannot advance without a receipt model'
);
select throws_ok(
  $$update private.skill_versions
    set compatibility_state = 'declared', evidence_compatibility_state = 'declared'
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'compatibility cannot advance without a receipt model'
);
select throws_ok(
  $$update private.skill_relationships
    set evidence_state = 'reviewed'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'relationship evidence cannot advance without a receipt model'
);
select throws_ok(
  $$update private.skills
    set capabilities = array['skill.audit', 'skill.audit']
    where id = '30000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'duplicate capabilities fail database contract bounds'
);
select throws_ok(
  $$update private.skills
    set capabilities = array['Bad Capability']
    where id = '30000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'malformed capabilities fail database contract bounds'
);
select throws_ok(
  $$update private.skill_versions
    set permission_network = array['example.com', 'example.com']
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'duplicate permission declarations fail database contract bounds'
);
select throws_ok(
  $$update private.skill_versions
    set grade_reason_codes = array['Bad Code']
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'malformed grade reason codes fail database contract bounds'
);
select throws_ok(
  $$update private.skill_versions
    set license_files = array['../LICENSE']
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'license-file traversal fails database contract bounds'
);
select throws_ok(
  $$update private.skill_versions
    set permission_tools = array(select 'tool-' || item from generate_series(1, 51) as item)
    where id = '40000000-0000-4000-8000-000000000002'$$,
  23514,
  null,
  'oversized permission arrays fail database contract bounds'
);

set constraints skills_current_version_belongs_to_skill immediate;
select throws_ok(
  $$update private.skills
    set current_version_id = '40000000-0000-4000-8000-000000000002'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  23503,
  null,
  'a current-version pointer cannot cross skill identity'
);
select throws_ok(
  $$update private.skill_versions
    set source_commit = 'ffffffffffffffffffffffffffffffffffffffff'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'immutable version source coordinates cannot be rewritten'
);
select throws_ok(
  $$update private.skill_versions
    set grade_state = 'current',
        grade_band = 'A',
        grade_confidence = 1,
        grade_receipt_id = 'grd_00000000000000000000000000000001',
        grade_receipt_digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graded_at = '2026-07-11T00:00:00Z',
        grade_rubric_version = 'fabricated-v1',
        grade_host_profile_version = 'fabricated-codex-v1',
        grade_reason_codes = '{}'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  23514,
  null,
  'Phase 1 rejects a structurally complete but unauthoritative fabricated grade'
);

set local role anon;
select throws_ok(
  $$select * from private.audit_events$$,
  42501,
  null,
  'anonymous users cannot read audit events'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok(
  $$insert into private.audit_events (event_type, subject_type, subject_id)
    values ('catalog.tamper', 'skill', 'skl_00000000000000000000000000000001')$$,
  42501,
  null,
  'authenticated users cannot write audit truth'
);
reset role;

select is(
  (select count(*) from pg_indexes where indexname in (
    'publisher_members_user_id_idx',
    'source_repositories_publisher_id_idx',
    'source_repositories_public_idx',
    'skills_publisher_id_idx',
    'skills_source_repository_id_idx',
    'skills_current_version_id_idx',
    'skills_public_visibility_idx',
    'skills_search_document_idx',
    'skill_versions_skill_id_idx',
    'skill_versions_publication_idx',
    'skill_relationships_source_version_id_idx',
    'skill_relationships_target_skill_id_idx',
    'audit_events_actor_user_id_idx',
    'audit_events_subject_idx',
    'saved_skills_skill_id_idx',
    'saved_skills_owner_page_idx'
  )),
  16::bigint,
  'all explicit FK, RLS, search, and lifecycle indexes exist'
);

select is(
  (select count(*) from private.skill_versions
    where source_commit = 'd1c23990af82d1c8c99997cb8d9a2c23707d91fa'
      and public_id in (
        'skv_00000000000000000000000000000001',
        'skv_00000000000000000000000000000002',
        'skv_00000000000000000000000000000003'
      )),
  3::bigint,
  'all first-party seeds bind to the exact checked-in source commit'
);

select * from finish();
rollback;
