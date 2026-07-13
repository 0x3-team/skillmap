begin;

alter table api.skill_submissions
  add column submission_policy_version text not null default 'public-alpha-draft/v1'
    check (submission_policy_version = 'public-alpha-draft/v1'),
  add column authority_confirmed boolean not null default false,
  add column untrusted_processing_accepted boolean not null default false,
  add column audit_state text not null default 'not-run'
    check (audit_state in ('not-run', 'passed', 'warnings', 'blocked')),
  add column audit_receipt_id uuid,
  add column audit_receipt_public_id text
    check (audit_receipt_public_id is null or audit_receipt_public_id ~ '^aud_[0-9a-f]{32}$'),
  add column audit_receipt_digest text
    check (audit_receipt_digest is null or audit_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column grade_state text not null default 'ungraded'
    check (grade_state in ('ungraded', 'provisional', 'blocked')),
  add column grade_receipt_id uuid,
  add column grade_receipt_public_id text
    check (grade_receipt_public_id is null or grade_receipt_public_id ~ '^grd_[0-9a-f]{32}$'),
  add column grade_receipt_digest text
    check (grade_receipt_digest is null or grade_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column grade_confidence double precision
    check (grade_confidence is null or grade_confidence between 0 and 1),
  add column review_state text not null default 'not-started'
    check (review_state in ('not-started', 'approved', 'changes-requested', 'rejected', 'published', 'withdrawn')),
  add column review_case_id uuid,
  add column review_case_public_id text
    check (review_case_public_id is null or review_case_public_id ~ '^rev_[0-9a-f]{32}$'),
  add column last_worker_run_id uuid,
  add column remediation_code text
    check (remediation_code is null or remediation_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  add column public_status_message text check (private.safe_public_message(public_status_message, 500)),
  add column result_skill_id text references private.skills(public_id) on delete set null
    check (result_skill_id is null or result_skill_id ~ '^skl_[0-9a-f]{32}$'),
  add column result_version_id text references private.skill_versions(public_id) on delete set null
    check (result_version_id is null or result_version_id ~ '^skv_[0-9a-f]{32}$'),
  add column publication_digest text
    check (publication_digest is null or publication_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column last_transition_digest text
    check (last_transition_digest is null or last_transition_digest ~ '^sha256:[0-9a-f]{64}$');

alter table private.submission_events
  add column transition_digest text
    check (transition_digest is null or transition_digest ~ '^sha256:[0-9a-f]{64}$');

alter table private.worker_runs
  add column disposition_state text
    check (disposition_state is null or disposition_state in ('accepted', 'changes-requested', 'rejected', 'failed')),
  add constraint worker_runs_id_submission_key unique (id, submission_id);

-- Batch 1 submissions predate explicit public-alpha attestations. They cannot be
-- silently opted in, so retire any still-active legacy rows before admitting the
-- expanded state machine.
alter table api.skill_submissions disable trigger skill_submissions_enforce_update;
update api.skill_submissions
set state = 'withdrawn', active_claim_id = null, current_worker_version = null,
  claim_expires_at = null, completed_at = coalesce(completed_at, now()),
  review_state = 'withdrawn'
where state in ('queued', 'processing');
alter table api.skill_submissions enable trigger skill_submissions_enforce_update;

alter table private.worker_runs alter column disposition_state set not null;
alter table private.skill_grade_receipts alter column evaluation_suite_digest drop not null;
alter table private.skill_audit_receipts
  add column license_state text not null default 'noassertion'
    check (license_state in ('confirmed', 'noassertion', 'restricted')),
  add column spdx_expression text,
  add column permission_scripts boolean not null default false,
  add column network_indicators boolean not null default false,
  add column tool_indicators boolean not null default false,
  add constraint skill_audit_receipts_license_authority check (
    (license_state = 'confirmed' and spdx_expression = any(array[
      '0BSD', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0',
      'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'GPL-2.0-only',
      'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC',
      'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only',
      'LGPL-3.0-or-later', 'MIT', 'MPL-2.0', 'Unlicense'
    ]::text[]))
    or (license_state in ('noassertion', 'restricted') and spdx_expression is null)
  );

alter table private.review_cases
  drop constraint review_cases_idempotency_digest_key,
  add constraint review_cases_submission_idempotency_key unique (submission_id, idempotency_digest),
  add constraint review_cases_id_submission_key unique (id, submission_id);

alter table api.skill_submissions
  add constraint skill_submissions_audit_receipt_fkey
    foreign key (audit_receipt_id, id)
    references private.skill_audit_receipts(id, submission_id) on delete set null,
  add constraint skill_submissions_grade_receipt_fkey
    foreign key (grade_receipt_id, id)
    references private.skill_grade_receipts(id, submission_id) on delete set null,
  add constraint skill_submissions_review_case_fkey
    foreign key (review_case_id, id)
    references private.review_cases(id, submission_id) on delete set null,
  add constraint skill_submissions_worker_run_fkey
    foreign key (last_worker_run_id, id)
    references private.worker_runs(id, submission_id) on delete set null;

alter table api.skill_submissions
  drop constraint skill_submissions_state_check,
  drop constraint skill_submissions_check1,
  add constraint skill_submissions_state_check
    check (state in ('queued', 'processing', 'changes-requested', 'rejected', 'failed', 'accepted', 'published', 'withdrawn')),
  add constraint skill_submissions_authority_state_check check (
    (state = 'queued'
      and authority_confirmed and untrusted_processing_accepted
      and active_claim_id is null and current_worker_version is null
      and claimed_at is null and claim_expires_at is null and completed_at is null
      and audit_state = 'not-run' and audit_receipt_id is null and audit_receipt_public_id is null and audit_receipt_digest is null
      and grade_state = 'ungraded' and grade_receipt_id is null and grade_receipt_public_id is null and grade_receipt_digest is null and grade_confidence is null
      and review_state = 'not-started' and review_case_id is null and review_case_public_id is null
      and remediation_code is null and public_status_message is null
      and result_skill_id is null and result_version_id is null and publication_digest is null)
    or (state = 'processing'
      and authority_confirmed and untrusted_processing_accepted
      and active_claim_id is not null and current_worker_version is not null
      and claimed_at is not null and claim_expires_at > claimed_at and completed_at is null and attempt_count > 0
      and audit_state = 'not-run' and audit_receipt_id is null and grade_state = 'ungraded' and grade_receipt_id is null
      and review_state = 'not-started' and review_case_id is null
      and remediation_code is null and public_status_message is null
      and result_skill_id is null and result_version_id is null and publication_digest is null)
    or (state in ('changes-requested', 'rejected')
      and active_claim_id is null and claim_expires_at is null and completed_at is not null
      and audit_receipt_id is not null and audit_receipt_public_id is not null and audit_receipt_digest is not null
      and grade_receipt_id is not null and grade_receipt_public_id is not null and grade_receipt_digest is not null
      and review_case_id is not null and review_case_public_id is not null
      and review_state = case when state = 'changes-requested' then 'changes-requested' else 'rejected' end
      and remediation_code is not null and public_status_message is not null
      and result_skill_id is null and result_version_id is null and publication_digest is null)
    or (state = 'failed'
      and active_claim_id is null and claim_expires_at is null and completed_at is not null
      and audit_state = 'not-run' and audit_receipt_id is null and grade_state = 'ungraded' and grade_receipt_id is null
      and review_state = 'not-started' and review_case_id is null
      and remediation_code is not null and public_status_message is not null
      and result_skill_id is null and result_version_id is null and publication_digest is null)
    or (state = 'accepted'
      and active_claim_id is null and claim_expires_at is null and completed_at is not null
      and audit_state in ('passed', 'warnings')
      and audit_receipt_id is not null and audit_receipt_public_id is not null and audit_receipt_digest is not null
      and grade_state = 'provisional' and grade_receipt_id is not null and grade_receipt_public_id is not null and grade_receipt_digest is not null and grade_confidence is not null
      and review_state = 'approved' and review_case_id is not null and review_case_public_id is not null
      and remediation_code is null and public_status_message is null
      and result_skill_id is null and result_version_id is null and publication_digest is null)
    or (state = 'published'
      and active_claim_id is null and claim_expires_at is null and completed_at is not null
      and audit_state in ('passed', 'warnings')
      and audit_receipt_id is not null and audit_receipt_public_id is not null and audit_receipt_digest is not null
      and grade_state = 'provisional' and grade_receipt_id is not null and grade_receipt_public_id is not null and grade_receipt_digest is not null and grade_confidence is not null
      and review_state = 'published' and review_case_id is not null and review_case_public_id is not null
      and remediation_code is null and public_status_message is null
      and result_skill_id is not null and result_version_id is not null and publication_digest is not null)
    or (state = 'withdrawn'
      and active_claim_id is null and claim_expires_at is null and completed_at is not null
      and review_state in ('not-started', 'withdrawn')
      and result_skill_id is null and result_version_id is null and publication_digest is null)
  );

alter table private.submission_events
  drop constraint submission_events_from_state_check,
  drop constraint submission_events_to_state_check,
  add constraint submission_events_from_state_check
    check (from_state is null or from_state in ('queued', 'processing', 'changes-requested', 'rejected', 'failed', 'accepted', 'published', 'withdrawn')),
  add constraint submission_events_to_state_check
    check (to_state in ('queued', 'processing', 'changes-requested', 'rejected', 'failed', 'accepted', 'published', 'withdrawn'));

alter table private.skill_versions
  add column source_submission_id uuid references api.skill_submissions(id) on delete set null,
  add column submission_audit_receipt_id uuid,
  add column submission_audit_receipt_public_id text
    check (submission_audit_receipt_public_id is null or submission_audit_receipt_public_id ~ '^aud_[0-9a-f]{32}$'),
  add column submission_audit_receipt_digest text
    check (submission_audit_receipt_digest is null or submission_audit_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column submission_grade_receipt_id uuid,
  add constraint skill_versions_submission_audit_fkey
    foreign key (submission_audit_receipt_id, source_submission_id)
    references private.skill_audit_receipts(id, submission_id) on delete set null,
  add constraint skill_versions_submission_grade_fkey
    foreign key (submission_grade_receipt_id, source_submission_id)
    references private.skill_grade_receipts(id, submission_id) on delete set null;

alter table private.skill_versions
  drop constraint skill_versions_evidence_provenance_state_check1,
  drop constraint skill_versions_evidence_audit_state_check1,
  drop constraint skill_versions_compatibility_state_check1,
  drop constraint skill_versions_phase1_grade_authority;

create index skill_submissions_retry_idx
  on api.skill_submissions(updated_at, public_id)
  where state in ('failed', 'changes-requested');
create index skill_submissions_result_skill_idx on api.skill_submissions(result_skill_id) where result_skill_id is not null;
create index skill_submissions_result_version_idx on api.skill_submissions(result_version_id) where result_version_id is not null;
create index skill_versions_source_submission_idx on private.skill_versions(source_submission_id) where source_submission_id is not null;

create function private.jsonb_exact_keys(value jsonb, required_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and value ?& required_keys
    and not exists (
      select 1 from jsonb_object_keys(value) as key
      where not (key = any(required_keys))
    );
$$;

create function private.jsonb_text_array(value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(item order by ordinal), '{}'::text[])
  from jsonb_array_elements_text(value) with ordinality as element(item, ordinal);
$$;

create function private.valid_public_alpha_spdx(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value = any(array[
    '0BSD', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0',
    'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'GPL-2.0-only',
    'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC',
    'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only',
    'LGPL-3.0-or-later', 'MIT', 'MPL-2.0', 'Unlicense'
  ]::text[]);
$$;

create function private.valid_submission_audit_receipt(value jsonb, expected_worker text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  counts jsonb;
  checks jsonb;
  reasons text[];
  check_row jsonb;
  critical_count integer;
  high_count integer;
  medium_count integer;
  low_count integer;
  info_count integer;
  warning_seen boolean := false;
  blocked_seen boolean := false;
begin
  if private.jsonb_exact_keys(value, array[
      'state', 'receiptDigest', 'sourceContentDigest', 'normalizedContentDigest',
      'policyVersion', 'hostProfileVersion', 'workerVersion', 'findingCounts',
      'publicChecks', 'reasonCodes', 'privateEvidenceDigest', 'licenseState',
      'spdxExpression', 'permissionScripts', 'networkIndicators', 'toolIndicators'
    ]) is not true then return false; end if;
  counts := value -> 'findingCounts';
  checks := value -> 'publicChecks';
  if private.jsonb_exact_keys(counts, array['critical', 'high', 'medium', 'low', 'info']) is not true
    or jsonb_typeof(checks) is distinct from 'array'
    or jsonb_typeof(value -> 'reasonCodes') is distinct from 'array'
    or jsonb_array_length(checks) not between 1 and 100
    or pg_column_size(counts) > 2048 or pg_column_size(checks) > 32768 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_each(counts) item
    where jsonb_typeof(item.value) is distinct from 'number'
      or item.value #>> '{}' !~ '^[0-9]+$'
  ) or exists (
    select 1 from jsonb_array_elements(value -> 'reasonCodes') item
    where jsonb_typeof(item) is distinct from 'string'
  ) then return false; end if;
  critical_count := (counts ->> 'critical')::integer;
  high_count := (counts ->> 'high')::integer;
  medium_count := (counts ->> 'medium')::integer;
  low_count := (counts ->> 'low')::integer;
  info_count := (counts ->> 'info')::integer;
  reasons := private.jsonb_text_array(value -> 'reasonCodes');
  if private.valid_text_array(reasons, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$') is not true
    or jsonb_typeof(value -> 'state') is distinct from 'string'
    or jsonb_typeof(value -> 'receiptDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'sourceContentDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'normalizedContentDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'privateEvidenceDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'workerVersion') is distinct from 'string'
    or jsonb_typeof(value -> 'policyVersion') is distinct from 'string'
    or jsonb_typeof(value -> 'hostProfileVersion') is distinct from 'string'
    or jsonb_typeof(value -> 'licenseState') is distinct from 'string'
    or (value ->> 'state') not in ('passed', 'warnings', 'blocked')
    or (value ->> 'receiptDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (value ->> 'sourceContentDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (value ->> 'normalizedContentDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (value ->> 'privateEvidenceDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (value ->> 'workerVersion') is distinct from expected_worker
    or length(value ->> 'policyVersion') not between 1 and 64
    or length(value ->> 'hostProfileVersion') not between 1 and 64
    or (value ->> 'licenseState') not in ('confirmed', 'noassertion', 'restricted')
    or jsonb_typeof(value -> 'permissionScripts') is distinct from 'boolean'
    or jsonb_typeof(value -> 'networkIndicators') is distinct from 'boolean'
    or jsonb_typeof(value -> 'toolIndicators') is distinct from 'boolean'
    or ((value ->> 'licenseState') = 'confirmed' and (
      jsonb_typeof(value -> 'spdxExpression') is distinct from 'string'
      or private.valid_public_alpha_spdx(value ->> 'spdxExpression') is not true))
    or ((value ->> 'licenseState') in ('noassertion', 'restricted') and (
      jsonb_typeof(value -> 'spdxExpression') is distinct from 'null'
      or (value ->> 'state') <> 'blocked')) then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(checks)) <>
    (select count(distinct item ->> 'code') from jsonb_array_elements(checks) item) then
    return false;
  end if;
  for check_row in select item from jsonb_array_elements(checks) item loop
    if jsonb_typeof(check_row) is distinct from 'object'
      or private.jsonb_exact_keys(check_row, array['code', 'outcome', 'severity', 'evidenceDigest']) is not true
      or jsonb_typeof(check_row -> 'code') is distinct from 'string'
      or jsonb_typeof(check_row -> 'outcome') is distinct from 'string'
      or jsonb_typeof(check_row -> 'severity') is distinct from 'string'
      or (check_row ->> 'code') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(check_row ->> 'code') > 64
      or (check_row ->> 'outcome') not in ('passed', 'warning', 'blocked', 'not-applicable')
      or (check_row ->> 'severity') not in ('critical', 'high', 'medium', 'low', 'info')
      or not (
        jsonb_typeof(check_row -> 'evidenceDigest') = 'null'
        or (jsonb_typeof(check_row -> 'evidenceDigest') = 'string'
          and (check_row ->> 'evidenceDigest') ~ '^sha256:[0-9a-f]{64}$')
      ) then return false; end if;
    warning_seen := warning_seen or (check_row ->> 'outcome') = 'warning';
    blocked_seen := blocked_seen or (check_row ->> 'outcome') = 'blocked';
  end loop;
  if (value ->> 'state') = 'passed' then
    return critical_count + high_count + medium_count + low_count + info_count = 0
      and cardinality(reasons) = 0 and not warning_seen and not blocked_seen;
  elsif (value ->> 'state') = 'warnings' then
    return critical_count = 0 and high_count + medium_count + low_count + info_count > 0
      and cardinality(reasons) > 0 and warning_seen and not blocked_seen;
  end if;
  return critical_count + high_count + medium_count + low_count + info_count > 0
    and cardinality(reasons) > 0 and blocked_seen;
exception when others then
  return false;
end;
$$;

create function private.valid_submission_grade_receipt(value jsonb, audit_value jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  gates jsonb;
  dimensions jsonb;
  reasons text[];
  gate_row jsonb;
  dimension_row jsonb;
  required_weight double precision;
  weighted_score double precision := 0;
  behavioral_failed boolean := false;
  license_gate_passed boolean;
begin
  if private.jsonb_exact_keys(value, array[
      'state', 'receiptDigest', 'totalScore', 'confidence', 'normalizedContentDigest',
      'auditReceiptDigest', 'compatibilityEvidenceDigest', 'evaluationSuiteDigest',
      'rubricVersion', 'hostProfileVersion', 'evaluatorVersion', 'hardGates',
      'dimensions', 'reasonCodes'
    ]) is not true or jsonb_typeof(audit_value) is distinct from 'object' then
    return false;
  end if;
  gates := value -> 'hardGates';
  dimensions := value -> 'dimensions';
  if jsonb_typeof(gates) is distinct from 'array'
    or jsonb_typeof(dimensions) is distinct from 'array'
    or jsonb_typeof(value -> 'reasonCodes') is distinct from 'array'
    or jsonb_array_length(gates) <> 5 or jsonb_array_length(dimensions) <> 5
    or pg_column_size(gates) > 16384 or pg_column_size(dimensions) > 16384 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(value -> 'reasonCodes') item
    where jsonb_typeof(item) is distinct from 'string'
  ) then return false; end if;
  reasons := private.jsonb_text_array(value -> 'reasonCodes');
  if private.valid_text_array(reasons, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$') is not true
    or cardinality(reasons) = 0
    or jsonb_typeof(value -> 'state') is distinct from 'string'
    or jsonb_typeof(value -> 'receiptDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'normalizedContentDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'auditReceiptDigest') is distinct from 'string'
    or jsonb_typeof(value -> 'rubricVersion') is distinct from 'string'
    or jsonb_typeof(value -> 'hostProfileVersion') is distinct from 'string'
    or jsonb_typeof(value -> 'evaluatorVersion') is distinct from 'string'
    or (value ->> 'state') not in ('provisional', 'blocked')
    or (value ->> 'receiptDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (value ->> 'normalizedContentDigest') is distinct from (audit_value ->> 'normalizedContentDigest')
    or (value ->> 'auditReceiptDigest') is distinct from (audit_value ->> 'receiptDigest')
    or not (
      jsonb_typeof(value -> 'compatibilityEvidenceDigest') = 'null'
      or (jsonb_typeof(value -> 'compatibilityEvidenceDigest') = 'string'
        and (value ->> 'compatibilityEvidenceDigest') ~ '^sha256:[0-9a-f]{64}$')
    )
    or ((value ->> 'state') = 'provisional'
      and jsonb_typeof(value -> 'compatibilityEvidenceDigest') is distinct from 'string')
    or not (
      jsonb_typeof(value -> 'evaluationSuiteDigest') = 'null'
      or (jsonb_typeof(value -> 'evaluationSuiteDigest') = 'string'
        and (value ->> 'evaluationSuiteDigest') ~ '^sha256:[0-9a-f]{64}$')
    )
    or (value ->> 'rubricVersion') <> 'skillmap-rubric/v1'
    or (value ->> 'hostProfileVersion') is distinct from (audit_value ->> 'hostProfileVersion')
    or length(value ->> 'evaluatorVersion') not between 1 and 128 then
    return false;
  end if;
  if (select count(distinct item ->> 'code') from jsonb_array_elements(gates) item) <> 5 then
    return false;
  end if;
  for gate_row in select item from jsonb_array_elements(gates) item loop
    if jsonb_typeof(gate_row) is distinct from 'object'
      or private.jsonb_exact_keys(gate_row, array['code', 'passed', 'evidenceDigest']) is not true
      or jsonb_typeof(gate_row -> 'code') is distinct from 'string'
      or (gate_row ->> 'code') not in (
        'source-identity', 'audit-acceptable', 'license-confirmed',
        'compatibility-evidence-bound', 'behavioral-evidence-bound'
      )
      or jsonb_typeof(gate_row -> 'passed') is distinct from 'boolean'
      or not (
        jsonb_typeof(gate_row -> 'evidenceDigest') = 'null'
        or (jsonb_typeof(gate_row -> 'evidenceDigest') = 'string'
          and (gate_row ->> 'evidenceDigest') ~ '^sha256:[0-9a-f]{64}$')
      ) then return false; end if;
    if (gate_row ->> 'code') = 'behavioral-evidence-bound' then
      behavioral_failed := (gate_row ->> 'passed')::boolean = false;
      if behavioral_failed and jsonb_typeof(gate_row -> 'evidenceDigest') <> 'null' then return false; end if;
    elsif (gate_row ->> 'code') = 'license-confirmed' then
      license_gate_passed := (gate_row ->> 'passed')::boolean;
      if not license_gate_passed and (value ->> 'state') = 'provisional' then return false; end if;
    elsif (gate_row ->> 'passed')::boolean = false
      and (value ->> 'state') = 'provisional' then
      return false;
    end if;
    if (gate_row ->> 'passed')::boolean
      and (jsonb_typeof(gate_row -> 'evidenceDigest') <> 'string'
        or (gate_row ->> 'evidenceDigest') !~ '^sha256:[0-9a-f]{64}$') then
      return false;
    end if;
  end loop;
  if license_gate_passed is distinct from ((audit_value ->> 'licenseState') = 'confirmed') then
    return false;
  end if;
  if (select count(distinct item ->> 'code') from jsonb_array_elements(dimensions) item) <> 5 then
    return false;
  end if;
  for dimension_row in select item from jsonb_array_elements(dimensions) item loop
    if jsonb_typeof(dimension_row) is distinct from 'object'
      or private.jsonb_exact_keys(dimension_row, array['code', 'weight', 'score', 'evidenceDigest']) is not true
      or jsonb_typeof(dimension_row -> 'code') is distinct from 'string'
      or jsonb_typeof(dimension_row -> 'weight') is distinct from 'number'
      or jsonb_typeof(dimension_row -> 'score') is distinct from 'number'
      or jsonb_typeof(dimension_row -> 'evidenceDigest') is distinct from 'string'
      or (dimension_row ->> 'evidenceDigest') !~ '^sha256:[0-9a-f]{64}$'
      or (dimension_row ->> 'score')::double precision not between 0 and 100 then
      return false;
    end if;
    required_weight := case dimension_row ->> 'code'
      when 'instruction-quality' then 0.25
      when 'safety-and-permissions' then 0.25
      when 'routing-quality' then 0.20
      when 'reproducibility' then 0.15
      when 'maintenance-and-provenance' then 0.15
      else null
    end;
    if required_weight is null
      or abs((dimension_row ->> 'weight')::double precision - required_weight) > 1e-12 then
      return false;
    end if;
    weighted_score := weighted_score + required_weight * (dimension_row ->> 'score')::double precision;
  end loop;
  if (value ->> 'state') = 'provisional' then
    return jsonb_typeof(value -> 'totalScore') = 'number'
      and jsonb_typeof(value -> 'confidence') = 'number'
      and (value ->> 'totalScore')::double precision between 0 and 100
      and (value ->> 'confidence')::double precision between 0 and 1
      and (value ->> 'totalScore') ~ '^(0|[1-9][0-9]?|100)$'
      and (value ->> 'totalScore')::integer = round(weighted_score)::integer
      and behavioral_failed
      and jsonb_typeof(value -> 'evaluationSuiteDigest') = 'null'
      and 'behavioral-evidence-incomplete' = any(reasons);
  end if;
  return jsonb_typeof(value -> 'totalScore') = 'null'
    and jsonb_typeof(value -> 'confidence') = 'null'
    and exists (
      select 1 from jsonb_array_elements(gates) item
      where (item ->> 'passed')::boolean = false
    );
exception when others then
  return false;
end;
$$;

create function private.enforce_receipt_backed_skill_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  audit_row private.skill_audit_receipts%rowtype;
  grade_row private.skill_grade_receipts%rowtype;
begin
  if new.source_submission_id is null then
    if new.evidence_provenance_state <> 'unverified'
      or new.evidence_audit_state <> 'not-run'
      or new.compatibility_state <> 'not-tested'
      or new.evidence_compatibility_state <> 'not-tested'
      or new.grade_state <> 'ungraded'
      or new.submission_audit_receipt_id is not null
      or new.submission_grade_receipt_id is not null then
      raise exception 'positive hosted evidence requires an exact submission receipt chain' using errcode = '23514';
    end if;
    return new;
  end if;

  select * into audit_row from private.skill_audit_receipts
  where id = new.submission_audit_receipt_id and submission_id = new.source_submission_id;
  select * into grade_row from private.skill_grade_receipts
  where id = new.submission_grade_receipt_id and submission_id = new.source_submission_id;

  if audit_row.id is null or grade_row.id is null then
    raise exception 'published evidence receipt chain is incomplete' using errcode = '23514';
  end if;
  if new.evidence_provenance_state <> 'source-pinned'
    or new.evidence_audit_state is distinct from audit_row.state
    or new.submission_audit_receipt_public_id is distinct from audit_row.public_id
    or new.submission_audit_receipt_digest is distinct from audit_row.receipt_digest
    or new.compatibility_state <> 'declared'
    or new.evidence_compatibility_state <> 'declared'
    or new.compatibility_profile_version is distinct from grade_row.host_profile_version
    or new.compatibility_evidence_digest is distinct from grade_row.compatibility_evidence_digest
    or new.grade_state <> 'provisional'
    or new.grade_band is not null
    or new.grade_receipt_id is distinct from grade_row.public_id
    or new.grade_receipt_digest is distinct from grade_row.receipt_digest
    or new.grade_confidence is distinct from grade_row.confidence
    or new.grade_rubric_version is distinct from grade_row.rubric_version
    or new.grade_host_profile_version is distinct from grade_row.host_profile_version then
    raise exception 'skill version evidence does not match its immutable receipt chain' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger skill_versions_receipt_authority
before insert or update on private.skill_versions
for each row execute function private.enforce_receipt_backed_skill_version();

create or replace function private.enforce_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.public_id, old.submitter_user_id, old.repository_url, old.source_commit,
      old.source_path, old.version_label, old.license_claim, old.idempotency_key, old.created_at,
      old.submission_policy_version, old.authority_confirmed, old.untrusted_processing_accepted)
    is distinct from
    row(new.id, new.public_id, new.submitter_user_id, new.repository_url, new.source_commit,
      new.source_path, new.version_label, new.license_claim, new.idempotency_key, new.created_at,
      new.submission_policy_version, new.authority_confirmed, new.untrusted_processing_accepted) then
    raise exception 'submission source coordinates, attestations, and ownership are immutable' using errcode = '23514';
  end if;

  if old.state <> new.state and not (
    (old.state = 'queued' and new.state in ('processing', 'withdrawn'))
    or (old.state = 'processing' and new.state in ('accepted', 'changes-requested', 'rejected', 'failed'))
    or (old.state in ('failed', 'changes-requested') and new.state = 'queued')
    or (old.state = 'accepted' and new.state = 'published')
  ) then
    raise exception 'illegal submission state transition: % -> %', old.state, new.state using errcode = '23514';
  end if;

  new.updated_at := now();
  if new.state = 'withdrawn' then
    new.active_claim_id := null;
    new.current_worker_version := null;
    new.claim_expires_at := null;
    new.completed_at := coalesce(new.completed_at, now());
    new.review_state := case when old.state = 'queued' then 'withdrawn' else new.review_state end;
  end if;
  return new;
end;
$$;

create or replace function private.append_submission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.state is distinct from new.state then
    insert into private.submission_events (
      submission_id, from_state, to_state, actor_type, actor_user_id, transition_digest
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.state end,
      new.state,
      case
        when (select auth.role()) = 'service_role' then 'worker'
        when (select auth.uid()) is not null then 'submitter'
        else 'system'
      end,
      case when (select auth.role()) = 'authenticated' then (select auth.uid()) else null end,
      new.last_transition_digest
    );
  end if;
  return new;
end;
$$;

drop policy skill_submissions_own_queued_insert on api.skill_submissions;
create policy skill_submissions_own_queued_insert on api.skill_submissions
for insert to authenticated
with check (
  submitter_user_id = (select auth.uid())
  and state = 'queued'
  and submission_policy_version = 'public-alpha-draft/v1'
  and authority_confirmed
  and untrusted_processing_accepted
  and active_claim_id is null
  and current_worker_version is null
  and attempt_count = 0
  and claimed_at is null
  and claim_expires_at is null
  and completed_at is null
);

create or replace view api.my_skill_submissions
with (security_invoker = true, security_barrier = true)
as
select
  public_id as submission_id,
  repository_url,
  source_commit,
  source_path,
  version_label,
  license_claim,
  state,
  created_at,
  updated_at,
  claimed_at,
  completed_at,
  submission_policy_version,
  audit_state,
  audit_receipt_public_id,
  audit_receipt_digest,
  grade_state,
  grade_receipt_public_id,
  grade_receipt_digest,
  grade_confidence,
  review_state,
  review_case_public_id,
  remediation_code,
  public_status_message,
  result_skill_id,
  result_version_id
from api.skill_submissions;

create or replace function api.claim_skill_submission(
  p_worker_version text,
  p_submission_id text default null,
  p_lease_seconds integer default 300
)
returns table (
  submission_id text,
  claim_id uuid,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  license_claim text,
  attempt_number integer,
  claim_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  next_claim_id uuid := gen_random_uuid();
  reclaiming_expired_lease boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_worker_version is null or length(p_worker_version) not between 1 and 128
    or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    raise exception 'worker version is invalid' using errcode = '22023';
  end if;
  if p_submission_id is not null and p_submission_id !~ '^sub_[0-9a-f]{32}$' then
    raise exception 'submission id is invalid' using errcode = '22023';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception 'claim lease must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  select candidate.id, candidate.state = 'processing' into target_id, reclaiming_expired_lease
  from api.skill_submissions candidate
  where (
      candidate.state = 'queued'
      or (candidate.state = 'processing' and candidate.claim_expires_at < now())
    ) and candidate.attempt_count < 5
    and candidate.authority_confirmed and candidate.untrusted_processing_accepted
    and candidate.submission_policy_version = 'public-alpha-draft/v1'
    and (p_submission_id is null or candidate.public_id = p_submission_id)
  order by case when candidate.state = 'queued' then 0 else 1 end,
    candidate.created_at, candidate.public_id
  for update skip locked
  limit 1;

  if target_id is null then return; end if;

  return query
  update api.skill_submissions submission
  set state = 'processing', active_claim_id = next_claim_id,
    current_worker_version = p_worker_version,
    attempt_count = submission.attempt_count + 1,
    claimed_at = now(), claim_expires_at = now() + make_interval(secs => p_lease_seconds),
    last_transition_digest = null
  where submission.id = target_id
  returning submission.public_id, next_claim_id, submission.repository_url,
    submission.source_commit, submission.source_path, submission.version_label,
    submission.license_claim, submission.attempt_count, submission.claim_expires_at;

  if reclaiming_expired_lease then
    insert into private.submission_events (
      submission_id, from_state, to_state, actor_type, transition_digest
    ) values (target_id, 'processing', 'processing', 'worker', null);
  end if;
end;
$$;

create function api.complete_skill_submission(
  p_submission_id text,
  p_claim_id uuid,
  p_worker_version text,
  p_disposition text,
  p_input_digest text,
  p_result_digest text,
  p_audit_receipt jsonb,
  p_grade_receipt jsonb,
  p_reason_codes text[],
  p_public_message text,
  p_idempotency_digest text
)
returns table (
  submission_id text,
  submission_state text,
  audit_receipt_id text,
  grade_receipt_id text,
  review_case_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  audit_row private.skill_audit_receipts%rowtype;
  grade_row private.skill_grade_receipts%rowtype;
  review_row private.review_cases%rowtype;
  audit_reason_codes text[];
  grade_reason_codes text[];
  review_state_value text;
  remediation_value text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_claim_id is null
    or p_worker_version is null or length(p_worker_version) not between 1 and 128
      or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_disposition is null or p_disposition not in ('accepted', 'changes-requested', 'rejected', 'failed')
    or p_input_digest is null or p_input_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_result_digest is null or p_result_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or not private.valid_text_array(coalesce(p_reason_codes, '{}'::text[]), 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'completion request is invalid' using errcode = '22023';
  end if;

  select * into submission_row
  from api.skill_submissions
  where public_id = p_submission_id
  for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;

  if submission_row.state = p_disposition
    and submission_row.last_transition_digest = p_idempotency_digest
    and exists (
      select 1 from private.worker_runs worker_run
      where worker_run.id = p_claim_id
        and worker_run.submission_id = submission_row.id
        and worker_run.worker_version = p_worker_version
        and worker_run.input_digest = p_input_digest
        and worker_run.result_digest = p_result_digest
        and worker_run.disposition_state = p_disposition
    ) then
    return query select submission_row.public_id, submission_row.state,
      submission_row.audit_receipt_public_id, submission_row.grade_receipt_public_id,
      submission_row.review_case_public_id;
    return;
  end if;

  if submission_row.state <> 'processing'
    or submission_row.active_claim_id is distinct from p_claim_id
    or submission_row.current_worker_version is distinct from p_worker_version
    or submission_row.claim_expires_at is null or submission_row.claim_expires_at < now() then
    raise exception 'claim is stale, expired, or does not own the submission' using errcode = '55000';
  end if;

  if p_disposition = 'failed' then
    if p_audit_receipt is not null or p_grade_receipt is not null
      or cardinality(coalesce(p_reason_codes, '{}'::text[])) = 0
      or not private.safe_public_message(p_public_message, 240) or p_public_message is null then
      raise exception 'failed completion requires bounded remediation and no receipts' using errcode = '22023';
    end if;

    insert into private.worker_runs (
      id, submission_id, worker_version, attempt_number, outcome, disposition_state,
      input_digest, result_digest, error_code, public_error_message, started_at, completed_at
    ) values (
      p_claim_id, submission_row.id, p_worker_version, submission_row.attempt_count,
      'failed', 'failed', p_input_digest, p_result_digest, 'WORKER_FAILED',
      p_public_message, submission_row.claimed_at, now()
    );

    update api.skill_submissions submission
    set state = 'failed', active_claim_id = null, claim_expires_at = null,
      completed_at = now(), last_worker_run_id = p_claim_id,
      remediation_code = 'WORKER_FAILED', public_status_message = p_public_message,
      last_transition_digest = p_idempotency_digest
    where submission.id = submission_row.id
    returning submission.public_id, submission.state,
      submission.audit_receipt_public_id, submission.grade_receipt_public_id,
      submission.review_case_public_id
    into submission_id, submission_state, audit_receipt_id, grade_receipt_id, review_case_id;
    return next;
    return;
  end if;

  if p_audit_receipt is null or private.jsonb_exact_keys(p_audit_receipt, array[
      'state', 'receiptDigest', 'sourceContentDigest', 'normalizedContentDigest',
      'policyVersion', 'hostProfileVersion', 'workerVersion', 'findingCounts',
      'publicChecks', 'reasonCodes', 'privateEvidenceDigest', 'licenseState',
      'spdxExpression', 'permissionScripts', 'networkIndicators', 'toolIndicators'
    ]) is not true
    or p_grade_receipt is null or private.jsonb_exact_keys(p_grade_receipt, array[
      'state', 'receiptDigest', 'totalScore', 'confidence', 'normalizedContentDigest',
      'auditReceiptDigest', 'compatibilityEvidenceDigest', 'evaluationSuiteDigest',
      'rubricVersion', 'hostProfileVersion', 'evaluatorVersion', 'hardGates',
      'dimensions', 'reasonCodes'
    ]) is not true then
    raise exception 'receipt payload shape is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_audit_receipt -> 'reasonCodes') <> 'array'
    or jsonb_typeof(p_grade_receipt -> 'reasonCodes') <> 'array'
    or jsonb_typeof(p_audit_receipt -> 'findingCounts') <> 'object'
    or jsonb_typeof(p_audit_receipt -> 'publicChecks') <> 'array'
    or jsonb_typeof(p_grade_receipt -> 'hardGates') <> 'array'
    or jsonb_typeof(p_grade_receipt -> 'dimensions') <> 'array' then
    raise exception 'receipt payload types are invalid' using errcode = '22023';
  end if;
  if private.valid_submission_audit_receipt(p_audit_receipt, p_worker_version) is not true
    or private.valid_submission_grade_receipt(p_grade_receipt, p_audit_receipt) is not true then
    raise exception 'receipt payload contradicts the public-alpha audit or grade authority' using errcode = '22023';
  end if;

  audit_reason_codes := private.jsonb_text_array(p_audit_receipt -> 'reasonCodes');
  grade_reason_codes := private.jsonb_text_array(p_grade_receipt -> 'reasonCodes');
  if (p_audit_receipt ->> 'state') not in ('passed', 'warnings', 'blocked')
    or (p_audit_receipt ->> 'receiptDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_audit_receipt ->> 'sourceContentDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_audit_receipt ->> 'normalizedContentDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_audit_receipt ->> 'privateEvidenceDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_audit_receipt ->> 'workerVersion') is distinct from p_worker_version
    or length(p_audit_receipt ->> 'policyVersion') not between 1 and 64
    or length(p_audit_receipt ->> 'hostProfileVersion') not between 1 and 64
    or private.valid_text_array(audit_reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$') is not true
    or jsonb_array_length(p_audit_receipt -> 'publicChecks') not between 1 and 100
    or pg_column_size(p_audit_receipt -> 'findingCounts') > 2048
    or pg_column_size(p_audit_receipt -> 'publicChecks') > 32768 then
    raise exception 'audit receipt is invalid' using errcode = '22023';
  end if;

  if (p_grade_receipt ->> 'state') not in ('provisional', 'blocked')
    or (p_grade_receipt ->> 'receiptDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_grade_receipt ->> 'normalizedContentDigest') is distinct from (p_audit_receipt ->> 'normalizedContentDigest')
    or (p_grade_receipt ->> 'auditReceiptDigest') is distinct from (p_audit_receipt ->> 'receiptDigest')
    or (p_grade_receipt ->> 'compatibilityEvidenceDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_grade_receipt ->> 'evaluationSuiteDigest') !~ '^sha256:[0-9a-f]{64}$'
    or (p_grade_receipt ->> 'hostProfileVersion') is distinct from (p_audit_receipt ->> 'hostProfileVersion')
    or length(p_grade_receipt ->> 'rubricVersion') not between 1 and 64
    or length(p_grade_receipt ->> 'hostProfileVersion') not between 1 and 64
    or length(p_grade_receipt ->> 'evaluatorVersion') not between 1 and 128
    or private.valid_text_array(grade_reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$') is not true
    or cardinality(grade_reason_codes) = 0
    or jsonb_array_length(p_grade_receipt -> 'hardGates') not between 1 and 50
    or jsonb_array_length(p_grade_receipt -> 'dimensions') not between 1 and 20
    or pg_column_size(p_grade_receipt -> 'hardGates') > 16384
    or pg_column_size(p_grade_receipt -> 'dimensions') > 16384 then
    raise exception 'grade receipt is invalid' using errcode = '22023';
  end if;
  if (p_grade_receipt ->> 'state') = 'provisional' then
    if jsonb_typeof(p_grade_receipt -> 'totalScore') <> 'number'
      or jsonb_typeof(p_grade_receipt -> 'confidence') <> 'number'
      or (p_grade_receipt ->> 'totalScore')::double precision not between 0 and 100
      or (p_grade_receipt ->> 'confidence')::double precision not between 0 and 1 then
      raise exception 'provisional grade values are invalid' using errcode = '22023';
    end if;
  elsif jsonb_typeof(p_grade_receipt -> 'totalScore') <> 'null'
    or jsonb_typeof(p_grade_receipt -> 'confidence') <> 'null' then
    raise exception 'blocked grade cannot carry score or confidence' using errcode = '22023';
  end if;
  if p_disposition = 'accepted' and (
      (p_audit_receipt ->> 'state') not in ('passed', 'warnings')
      or (p_audit_receipt ->> 'licenseState') <> 'confirmed'
      or (p_grade_receipt ->> 'state') <> 'provisional'
      or cardinality(coalesce(p_reason_codes, '{}'::text[])) <> 0
      or p_public_message is not null
    ) then
    raise exception 'accepted completion requires positive evidence and no remediation' using errcode = '22023';
  end if;
  if p_disposition in ('changes-requested', 'rejected') and (
      cardinality(coalesce(p_reason_codes, '{}'::text[])) = 0
      or p_public_message is null or not private.safe_public_message(p_public_message, 500)
    ) then
    raise exception 'negative review requires bounded public remediation' using errcode = '22023';
  end if;

  select * into audit_row from private.skill_audit_receipts existing_audit
  where existing_audit.submission_id = submission_row.id
    and existing_audit.receipt_digest = p_audit_receipt ->> 'receiptDigest';
  if audit_row.id is null then
    insert into private.skill_audit_receipts (
      submission_id, state, receipt_digest, source_content_digest, normalized_content_digest,
      policy_version, host_profile_version, worker_version, finding_counts, public_checks,
      reason_codes, private_evidence_digest, license_state, spdx_expression,
      permission_scripts, network_indicators, tool_indicators
    ) values (
      submission_row.id, p_audit_receipt ->> 'state', p_audit_receipt ->> 'receiptDigest',
      p_audit_receipt ->> 'sourceContentDigest', p_audit_receipt ->> 'normalizedContentDigest',
      p_audit_receipt ->> 'policyVersion', p_audit_receipt ->> 'hostProfileVersion',
      p_worker_version, p_audit_receipt -> 'findingCounts', p_audit_receipt -> 'publicChecks',
      audit_reason_codes, p_audit_receipt ->> 'privateEvidenceDigest',
      p_audit_receipt ->> 'licenseState', p_audit_receipt ->> 'spdxExpression',
      (p_audit_receipt ->> 'permissionScripts')::boolean,
      (p_audit_receipt ->> 'networkIndicators')::boolean,
      (p_audit_receipt ->> 'toolIndicators')::boolean
    ) returning * into audit_row;
  elsif audit_row.state is distinct from (p_audit_receipt ->> 'state')
    or audit_row.source_content_digest is distinct from (p_audit_receipt ->> 'sourceContentDigest')
    or audit_row.normalized_content_digest is distinct from (p_audit_receipt ->> 'normalizedContentDigest')
    or audit_row.policy_version is distinct from (p_audit_receipt ->> 'policyVersion')
    or audit_row.host_profile_version is distinct from (p_audit_receipt ->> 'hostProfileVersion')
    or audit_row.worker_version is distinct from p_worker_version
    or audit_row.finding_counts is distinct from (p_audit_receipt -> 'findingCounts')
    or audit_row.public_checks is distinct from (p_audit_receipt -> 'publicChecks')
    or audit_row.reason_codes is distinct from audit_reason_codes
    or audit_row.private_evidence_digest is distinct from (p_audit_receipt ->> 'privateEvidenceDigest')
    or audit_row.license_state is distinct from (p_audit_receipt ->> 'licenseState')
    or audit_row.spdx_expression is distinct from (p_audit_receipt ->> 'spdxExpression')
    or audit_row.permission_scripts is distinct from (p_audit_receipt ->> 'permissionScripts')::boolean
    or audit_row.network_indicators is distinct from (p_audit_receipt ->> 'networkIndicators')::boolean
    or audit_row.tool_indicators is distinct from (p_audit_receipt ->> 'toolIndicators')::boolean then
    raise exception 'audit receipt digest conflicts with retained evidence' using errcode = '23505';
  end if;

  select * into grade_row from private.skill_grade_receipts existing_grade
  where existing_grade.submission_id = submission_row.id
    and existing_grade.receipt_digest = p_grade_receipt ->> 'receiptDigest';
  if grade_row.id is null then
    insert into private.skill_grade_receipts (
      submission_id, audit_receipt_id, state, total_score, confidence, receipt_digest,
      normalized_content_digest, audit_receipt_digest, compatibility_evidence_digest,
      evaluation_suite_digest, rubric_version, host_profile_version, evaluator_version,
      hard_gates, dimensions, reason_codes
    ) values (
      submission_row.id, audit_row.id, p_grade_receipt ->> 'state',
      case when (p_grade_receipt ->> 'state') = 'provisional' then (p_grade_receipt ->> 'totalScore')::double precision else null end,
      case when (p_grade_receipt ->> 'state') = 'provisional' then (p_grade_receipt ->> 'confidence')::double precision else null end,
      p_grade_receipt ->> 'receiptDigest', p_grade_receipt ->> 'normalizedContentDigest',
      p_grade_receipt ->> 'auditReceiptDigest', p_grade_receipt ->> 'compatibilityEvidenceDigest',
      p_grade_receipt ->> 'evaluationSuiteDigest', p_grade_receipt ->> 'rubricVersion',
      p_grade_receipt ->> 'hostProfileVersion', p_grade_receipt ->> 'evaluatorVersion',
      p_grade_receipt -> 'hardGates', p_grade_receipt -> 'dimensions', grade_reason_codes
    ) returning * into grade_row;
  elsif grade_row.audit_receipt_id is distinct from audit_row.id
    or grade_row.state is distinct from (p_grade_receipt ->> 'state')
    or grade_row.total_score is distinct from (case when (p_grade_receipt ->> 'state') = 'provisional' then (p_grade_receipt ->> 'totalScore')::double precision else null end)
    or grade_row.confidence is distinct from (case when (p_grade_receipt ->> 'state') = 'provisional' then (p_grade_receipt ->> 'confidence')::double precision else null end)
    or grade_row.normalized_content_digest is distinct from (p_grade_receipt ->> 'normalizedContentDigest')
    or grade_row.audit_receipt_digest is distinct from (p_grade_receipt ->> 'auditReceiptDigest')
    or grade_row.compatibility_evidence_digest is distinct from (p_grade_receipt ->> 'compatibilityEvidenceDigest')
    or grade_row.evaluation_suite_digest is distinct from (p_grade_receipt ->> 'evaluationSuiteDigest')
    or grade_row.rubric_version is distinct from (p_grade_receipt ->> 'rubricVersion')
    or grade_row.host_profile_version is distinct from (p_grade_receipt ->> 'hostProfileVersion')
    or grade_row.evaluator_version is distinct from (p_grade_receipt ->> 'evaluatorVersion')
    or grade_row.hard_gates is distinct from (p_grade_receipt -> 'hardGates')
    or grade_row.dimensions is distinct from (p_grade_receipt -> 'dimensions')
    or grade_row.reason_codes is distinct from grade_reason_codes then
    raise exception 'grade receipt digest conflicts with retained evidence' using errcode = '23505';
  end if;

  review_state_value := case p_disposition
    when 'accepted' then 'approved'
    when 'changes-requested' then 'changes-requested'
    else 'rejected'
  end;
  remediation_value := case p_disposition
    when 'changes-requested' then 'CHANGES_REQUESTED'
    when 'rejected' then 'SUBMISSION_REJECTED'
    else null
  end;
  insert into private.review_cases (
    submission_id, audit_receipt_id, grade_receipt_id, state,
    reason_codes, public_message, idempotency_digest
  ) values (
    submission_row.id, audit_row.id, grade_row.id, review_state_value,
    coalesce(p_reason_codes, '{}'::text[]), p_public_message, p_idempotency_digest
  ) returning * into review_row;

  insert into private.worker_runs (
    id, submission_id, worker_version, attempt_number, outcome, disposition_state,
    input_digest, result_digest, started_at, completed_at
  ) values (
    p_claim_id, submission_row.id, p_worker_version, submission_row.attempt_count,
    'succeeded', p_disposition, p_input_digest, p_result_digest,
    submission_row.claimed_at, now()
  );

  update api.skill_submissions submission
  set state = p_disposition, active_claim_id = null, claim_expires_at = null,
    completed_at = now(), audit_state = audit_row.state,
    audit_receipt_id = audit_row.id, audit_receipt_public_id = audit_row.public_id,
    audit_receipt_digest = audit_row.receipt_digest, grade_state = grade_row.state,
    grade_receipt_id = grade_row.id, grade_receipt_public_id = grade_row.public_id,
    grade_receipt_digest = grade_row.receipt_digest, grade_confidence = grade_row.confidence,
    review_state = review_state_value, review_case_id = review_row.id,
    review_case_public_id = review_row.public_id, last_worker_run_id = p_claim_id,
    remediation_code = remediation_value, public_status_message = p_public_message,
    last_transition_digest = p_idempotency_digest
  where submission.id = submission_row.id
  returning submission.public_id, submission.state,
    submission.audit_receipt_public_id, submission.grade_receipt_public_id,
    submission.review_case_public_id
  into submission_id, submission_state, audit_receipt_id, grade_receipt_id, review_case_id;
  return next;
end;
$$;

create function api.requeue_skill_submission(
  p_submission_id text,
  p_idempotency_digest text
)
returns table (submission_id text, submission_state text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'requeue request is invalid' using errcode = '22023';
  end if;
  select * into submission_row from api.skill_submissions
  where public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;
  if submission_row.state = 'queued' and submission_row.last_transition_digest = p_idempotency_digest then
    return query select submission_row.public_id, submission_row.state, submission_row.attempt_count;
    return;
  end if;
  if submission_row.state not in ('failed', 'changes-requested')
    or submission_row.attempt_count >= 5
    or submission_row.submission_policy_version <> 'public-alpha-draft/v1'
    or not submission_row.authority_confirmed or not submission_row.untrusted_processing_accepted then
    raise exception 'submission is not eligible for requeue' using errcode = '55000';
  end if;
  update api.skill_submissions submission
  set state = 'queued', active_claim_id = null, current_worker_version = null,
    claimed_at = null, claim_expires_at = null, completed_at = null,
    audit_state = 'not-run', audit_receipt_id = null, audit_receipt_public_id = null,
    audit_receipt_digest = null, grade_state = 'ungraded', grade_receipt_id = null,
    grade_receipt_public_id = null, grade_receipt_digest = null, grade_confidence = null,
    review_state = 'not-started', review_case_id = null, review_case_public_id = null,
    last_worker_run_id = null, remediation_code = null, public_status_message = null,
    result_skill_id = null, result_version_id = null, publication_digest = null,
    last_transition_digest = p_idempotency_digest
  where submission.id = submission_row.id
  returning submission.public_id, submission.state, submission.attempt_count
  into submission_id, submission_state, attempt_count;
  return next;
end;
$$;

create function api.publish_skill_submission(
  p_submission_id text,
  p_publication_digest text,
  p_publisher_handle text,
  p_publisher_display_name text,
  p_skill_slug text,
  p_skill_display_name text,
  p_summary text,
  p_description text,
  p_capabilities text[],
  p_license_state text,
  p_spdx_expression text,
  p_permission_scripts boolean,
  p_permission_network text[],
  p_permission_tools text[]
)
returns table (
  submission_id text,
  publisher_id text,
  skill_id text,
  version_id text,
  submission_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  publisher_row private.publishers%rowtype;
  repository_row private.source_repositories%rowtype;
  skill_row private.skills%rowtype;
  version_row private.skill_versions%rowtype;
  audit_row private.skill_audit_receipts%rowtype;
  grade_row private.skill_grade_receipts%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'publication authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_publication_digest is null or p_publication_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_publisher_handle is null or p_publisher_handle !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(p_publisher_handle) not between 2 and 40
    or p_publisher_display_name is null or length(p_publisher_display_name) not between 1 and 100
      or p_publisher_display_name ~ '[[:cntrl:]]'
    or p_skill_slug is null or p_skill_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(p_skill_slug) not between 2 and 100
    or p_skill_display_name is null or length(p_skill_display_name) not between 1 and 140
      or p_skill_display_name ~ '[[:cntrl:]]'
    or p_summary is null or length(p_summary) not between 1 and 500 or p_summary ~ '[[:cntrl:]]'
    or p_description is null or length(p_description) not between 1 and 20000 or p_description ~ '[[:cntrl:]]'
    or not private.valid_text_array(coalesce(p_capabilities, '{}'::text[]), 50, 100, '^[a-z0-9]+([.:/-][a-z0-9]+)*$')
    or p_license_state is null or p_license_state not in ('confirmed', 'noassertion')
    or (p_license_state = 'confirmed' and (
      p_spdx_expression is null or not private.valid_public_alpha_spdx(p_spdx_expression)))
    or (p_license_state = 'noassertion' and p_spdx_expression is not null)
    or p_permission_scripts is null
    or not private.valid_text_array(coalesce(p_permission_network, '{}'::text[]), 50, 200)
    or not private.valid_text_array(coalesce(p_permission_tools, '{}'::text[]), 50, 200) then
    raise exception 'publication metadata is invalid' using errcode = '22023';
  end if;

  select * into submission_row from api.skill_submissions
  where public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;
  -- Serialize the publication/replay decision with authorization renewal and
  -- revocation for the same immutable source coordinates.
  perform private.lock_exact_source_authority(
    submission_row.repository_url, submission_row.source_commit, submission_row.source_path
  );
  if submission_row.state = 'published' then
    if submission_row.publication_digest is distinct from p_publication_digest then
      raise exception 'publication replay conflicts with the authoritative digest' using errcode = '23505';
    end if;
    select * into skill_row from private.skills where public_id = submission_row.result_skill_id;
    select * into publisher_row from private.publishers where id = skill_row.publisher_id;
    select * into repository_row from private.source_repositories where id = skill_row.source_repository_id;
    select * into version_row from private.skill_versions where public_id = submission_row.result_version_id;
    if skill_row.id is null
      or publisher_row.id is null
      or repository_row.id is null
      or version_row.id is null
      or version_row.skill_id is distinct from skill_row.id
      or skill_row.publisher_id is distinct from publisher_row.id
      or skill_row.source_repository_id is distinct from repository_row.id
      or skill_row.current_version_id is distinct from version_row.id
      or skill_row.visibility_state <> 'public'
      or skill_row.lifecycle_state not in ('published', 'deprecated')
      or skill_row.revoked_at is not null
      or publisher_row.catalog_state <> 'published'
      or publisher_row.revoked_at is not null
      or repository_row.catalog_state <> 'published'
      or repository_row.revoked_at is not null
      or repository_row.repository_url is distinct from submission_row.repository_url
      or version_row.source_commit is distinct from submission_row.source_commit
      or version_row.source_path is distinct from submission_row.source_path
      or version_row.publication_state <> 'published'
      or version_row.quarantined_at is not null
      or version_row.revoked_at is not null
      or private.version_has_current_publisher_authorization(version_row.id) is not true then
      raise exception 'publication replay no longer has current exact-source authority'
        using errcode = '55000';
    end if;
    if publisher_row.handle is distinct from p_publisher_handle
      or publisher_row.display_name is distinct from p_publisher_display_name
      or repository_row.repository_url is distinct from submission_row.repository_url
      or skill_row.slug is distinct from p_skill_slug
      or skill_row.display_name is distinct from p_skill_display_name
      or skill_row.summary is distinct from p_summary
      or skill_row.description is distinct from p_description
      or skill_row.capabilities is distinct from coalesce(p_capabilities, '{}'::text[])
      or version_row.license_state is distinct from p_license_state
      or version_row.spdx_expression is distinct from p_spdx_expression
      or version_row.permission_scripts is distinct from p_permission_scripts
      or version_row.permission_network is distinct from coalesce(p_permission_network, '{}'::text[])
      or version_row.permission_tools is distinct from coalesce(p_permission_tools, '{}'::text[]) then
      raise exception 'publication replay metadata conflicts with the published record' using errcode = '23505';
    end if;
    return query select submission_row.public_id, publisher_row.public_id,
      submission_row.result_skill_id, submission_row.result_version_id, submission_row.state;
    return;
  end if;
  if submission_row.state <> 'accepted' or submission_row.review_state <> 'approved'
    or submission_row.audit_state not in ('passed', 'warnings')
    or submission_row.grade_state <> 'provisional' then
    raise exception 'only an approved receipt-backed submission can be published' using errcode = '55000';
  end if;
  select * into audit_row from private.skill_audit_receipts audit_receipt
  where audit_receipt.id = submission_row.audit_receipt_id
    and audit_receipt.submission_id = submission_row.id;
  select * into grade_row from private.skill_grade_receipts grade_receipt
  where grade_receipt.id = submission_row.grade_receipt_id
    and grade_receipt.submission_id = submission_row.id
    and grade_receipt.audit_receipt_id = audit_row.id;
  if audit_row.id is null or grade_row.id is null
    or audit_row.state not in ('passed', 'warnings') or grade_row.state <> 'provisional' then
    raise exception 'publication receipt chain is invalid' using errcode = '23514';
  end if;
  if p_license_state is distinct from audit_row.license_state
    or p_spdx_expression is distinct from audit_row.spdx_expression
    or p_permission_scripts is distinct from audit_row.permission_scripts
    or (cardinality(coalesce(p_permission_network, '{}'::text[])) > 0)
      is distinct from audit_row.network_indicators
    or (cardinality(coalesce(p_permission_tools, '{}'::text[])) > 0)
      is distinct from audit_row.tool_indicators then
    raise exception 'publication license or permission disclosure contradicts the immutable audit receipt'
      using errcode = '23514';
  end if;

  select * into publisher_row from private.publishers where handle = p_publisher_handle for update;
  if publisher_row.id is null then
    insert into private.publishers (
      public_id, handle, display_name, verification_state, catalog_state
    ) values (
      'pub_' || replace(gen_random_uuid()::text, '-', ''), p_publisher_handle,
      p_publisher_display_name, 'unverified', 'published'
    ) returning * into publisher_row;
  elsif publisher_row.display_name is distinct from p_publisher_display_name
    or publisher_row.verification_state <> 'unverified' or publisher_row.revoked_at is not null then
    raise exception 'publisher metadata conflicts with an existing identity' using errcode = '23505';
  else
    update private.publishers set catalog_state = 'published', updated_at = now()
    where id = publisher_row.id returning * into publisher_row;
  end if;

  select * into repository_row from private.source_repositories
  where repository_url = submission_row.repository_url for update;
  if repository_row.id is null then
    insert into private.source_repositories (publisher_id, repository_url, catalog_state)
    values (publisher_row.id, submission_row.repository_url, 'published')
    returning * into repository_row;
  elsif repository_row.publisher_id <> publisher_row.id or repository_row.revoked_at is not null then
    raise exception 'repository is already bound to another publisher or is revoked' using errcode = '23505';
  else
    update private.source_repositories set catalog_state = 'published', updated_at = now()
    where id = repository_row.id returning * into repository_row;
  end if;

  select * into skill_row from private.skills catalog_skill
  where catalog_skill.publisher_id = publisher_row.id
    and catalog_skill.slug = p_skill_slug for update;
  if skill_row.id is null then
    insert into private.skills (
      public_id, publisher_id, source_repository_id, slug, display_name, summary,
      description, capabilities, visibility_state, lifecycle_state
    ) values (
      'skl_' || replace(gen_random_uuid()::text, '-', ''), publisher_row.id,
      repository_row.id, p_skill_slug, p_skill_display_name, p_summary, p_description,
      coalesce(p_capabilities, '{}'::text[]), 'public', 'published'
    ) returning * into skill_row;
  elsif skill_row.source_repository_id <> repository_row.id or skill_row.revoked_at is not null then
    raise exception 'skill identity conflicts with an existing catalog row' using errcode = '23505';
  else
    update private.skills set display_name = p_skill_display_name, summary = p_summary,
      description = p_description, capabilities = coalesce(p_capabilities, '{}'::text[]),
      visibility_state = 'public', lifecycle_state = 'published', updated_at = now()
    where id = skill_row.id returning * into skill_row;
  end if;

  if exists (
    select 1 from private.skill_versions existing
    where existing.skill_id = skill_row.id and existing.version_label = submission_row.version_label
  ) then
    raise exception 'version label already exists for this skill' using errcode = '23505';
  end if;
  insert into private.skill_versions (
    public_id, skill_id, version_label, source_commit, source_path,
    entrypoint_content_digest, artifact_availability, license_state, spdx_expression,
    redistribution_state, compatibility_state, compatibility_profile_version,
    compatibility_evidence_digest, permission_scripts, permission_network,
    permission_tools, evidence_provenance_state, evidence_audit_state,
    evidence_compatibility_state, grade_state, grade_confidence, grade_receipt_id,
    grade_receipt_digest, graded_at, grade_rubric_version, grade_host_profile_version,
    grade_reason_codes, publication_state, published_at, source_submission_id,
    submission_audit_receipt_id, submission_audit_receipt_public_id,
    submission_audit_receipt_digest, submission_grade_receipt_id
  ) values (
    'skv_' || replace(gen_random_uuid()::text, '-', ''), skill_row.id,
    submission_row.version_label, submission_row.source_commit, submission_row.source_path,
    audit_row.source_content_digest, 'metadata-only', p_license_state, p_spdx_expression,
    'metadata-only', 'declared', grade_row.host_profile_version,
    grade_row.compatibility_evidence_digest, p_permission_scripts,
    coalesce(p_permission_network, '{}'::text[]), coalesce(p_permission_tools, '{}'::text[]),
    'source-pinned', audit_row.state, 'declared', 'provisional', grade_row.confidence,
    grade_row.public_id, grade_row.receipt_digest, grade_row.created_at,
    grade_row.rubric_version, grade_row.host_profile_version, grade_row.reason_codes,
    'published', now(), submission_row.id, audit_row.id, audit_row.public_id,
    audit_row.receipt_digest, grade_row.id
  ) returning * into version_row;

  update private.skills set current_version_id = version_row.id, updated_at = now()
  where id = skill_row.id;
  update api.skill_submissions submission
  set state = 'published', review_state = 'published',
    result_skill_id = skill_row.public_id, result_version_id = version_row.public_id,
    publication_digest = p_publication_digest, last_transition_digest = p_publication_digest
  where submission.id = submission_row.id
  returning submission.public_id, publisher_row.public_id, submission.result_skill_id,
    submission.result_version_id, submission.state
  into submission_id, publisher_id, skill_id, version_id, submission_state;
  return next;
end;
$$;

create function private.detach_submission_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.result_version_id is not null then
    update private.skill_versions version
    set source_submission_id = null,
      submission_audit_receipt_id = null,
      submission_audit_receipt_public_id = null,
      submission_audit_receipt_digest = null,
      submission_grade_receipt_id = null,
      evidence_provenance_state = 'unverified', evidence_audit_state = 'not-run',
      compatibility_state = 'not-tested', compatibility_profile_version = null,
      compatibility_evidence_digest = null, evidence_compatibility_state = 'not-tested',
      grade_state = 'ungraded', grade_band = null, grade_confidence = null,
      grade_receipt_id = null, grade_receipt_digest = null, graded_at = null,
      grade_rubric_version = null, grade_host_profile_version = null,
      grade_invalidated_at = null, grade_reason_codes = '{}'::text[],
      publication_state = 'blocked', quarantined_at = coalesce(quarantined_at, now())
    where version.public_id = old.result_version_id
      and version.source_submission_id = old.id;
  end if;
  return old;
end;
$$;

create trigger skill_submissions_detach_publication
before delete on api.skill_submissions
for each row execute function private.detach_submission_publication();

create function api.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if (select auth.role()) <> 'authenticated' or caller_id is null then
    raise exception 'authenticated account authority is required' using errcode = '42501';
  end if;
  delete from auth.users where id = caller_id;
  if not found then
    raise exception 'account was not found' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke all on function api.complete_skill_submission(text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text) from public, anon, authenticated, service_role;
revoke all on function api.requeue_skill_submission(text, text) from public, anon, authenticated, service_role;
revoke all on function api.publish_skill_submission(text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]) from public, anon, authenticated, service_role;
revoke all on function api.delete_my_account() from public, anon, authenticated, service_role;
revoke all on function private.jsonb_exact_keys(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function private.jsonb_text_array(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.valid_public_alpha_spdx(text) from public, anon, authenticated, service_role;
revoke all on function private.valid_submission_audit_receipt(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.valid_submission_grade_receipt(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.enforce_receipt_backed_skill_version() from public, anon, authenticated, service_role;
revoke all on function private.detach_submission_publication() from public, anon, authenticated, service_role;

grant select (
  submission_policy_version, audit_state, audit_receipt_public_id, audit_receipt_digest,
  grade_state, grade_receipt_public_id, grade_receipt_digest, grade_confidence,
  review_state, review_case_public_id, remediation_code, public_status_message,
  result_skill_id, result_version_id
) on api.skill_submissions to authenticated;
grant insert (
  submission_policy_version, authority_confirmed, untrusted_processing_accepted
) on api.skill_submissions to authenticated;
grant select on api.my_skill_submissions to authenticated;
grant execute on function api.complete_skill_submission(text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text) to service_role;
grant execute on function api.requeue_skill_submission(text, text) to service_role;
grant execute on function api.publish_skill_submission(text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]) to service_role;
grant execute on function api.delete_my_account() to authenticated;

comment on function api.complete_skill_submission(text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text) is
  'Service-role-only atomic claim completion. Persists immutable audit, provisional-or-blocked grade, review, and worker-run evidence; never emits a current grade.';
comment on function api.requeue_skill_submission(text, text) is
  'Service-role-only bounded retry for failed or changes-requested submissions with retained explicit attestations.';
comment on function api.publish_skill_submission(text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]) is
  'Service-role-only transactional metadata publication backed by an approved immutable receipt chain. Publishes provisional grades only.';
comment on function api.delete_my_account() is
  'Authenticated self-service account deletion. The caller can delete only the auth.uid() account; no target identifier is accepted.';

commit;
