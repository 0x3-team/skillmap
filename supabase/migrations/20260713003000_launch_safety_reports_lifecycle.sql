begin;

alter table private.audit_events
  add column idempotency_digest text
    check (idempotency_digest is null or idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  drop constraint audit_events_subject_type_check,
  add constraint audit_events_subject_type_check
    check (subject_type in ('publisher', 'repository', 'skill', 'skill-version', 'account', 'report'));
create unique index audit_events_idempotency_idx
  on private.audit_events(idempotency_digest) where idempotency_digest is not null;

create table api.skill_reports (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('rpt_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^rpt_[0-9a-f]{32}$'),
  reporter_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  skill_id text not null references private.skills(public_id) on delete cascade
    check (skill_id ~ '^skl_[0-9a-f]{32}$'),
  version_id text not null references private.skill_versions(public_id) on delete cascade
    check (version_id ~ '^skv_[0-9a-f]{32}$'),
  category text not null check (category in (
    'security', 'malware', 'misleading', 'license', 'privacy', 'broken', 'spam', 'other'
  )),
  message text not null check (private.safe_public_message(message, 2000)),
  idempotency_key uuid not null,
  state text not null default 'queued' check (state in ('queued', 'resolved')),
  disposition_code text check (
    disposition_code is null or disposition_code in ('confirmed', 'no-action', 'duplicate', 'invalid')
  ),
  resolution_reason_code text check (
    resolution_reason_code is null or resolution_reason_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  public_resolution_message text check (private.safe_public_message(public_resolution_message, 500)),
  resolution_digest text check (
    resolution_digest is null or resolution_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_user_id, idempotency_key),
  check (updated_at >= created_at),
  check (
    (state = 'queued' and disposition_code is null and resolution_reason_code is null
      and public_resolution_message is null and resolution_digest is null and resolved_at is null)
    or (state = 'resolved' and disposition_code is not null and resolution_reason_code is not null
      and public_resolution_message is not null and resolution_digest is not null
      and resolved_at is not null and resolved_at >= created_at)
  )
);

create unique index skill_reports_one_queued_target_idx
  on api.skill_reports(reporter_user_id, version_id, category) where state = 'queued';
create index skill_reports_owner_page_idx
  on api.skill_reports(reporter_user_id, created_at desc, public_id);
create index skill_reports_cooldown_idx
  on api.skill_reports(reporter_user_id, version_id, category, created_at desc);
create index skill_reports_queue_idx
  on api.skill_reports(created_at, public_id) where state = 'queued';

create function private.enforce_submission_abuse_bounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  repository_owner text;
begin
  if (select auth.role()) <> 'authenticated' or caller_id is null then
    return new;
  end if;
  if new.submitter_user_id is distinct from caller_id then
    raise exception 'submission owner must equal auth.uid()' using errcode = '42501';
  end if;
  repository_owner := split_part(new.repository_url, '/', 4);
  if new.repository_url !~ '^https://github[.]com/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?/[a-z0-9][a-z0-9_.-]{0,99}$'
    or repository_owner like '%--%' or new.repository_url like '%.git' then
    raise exception 'submission repository is not canonical' using errcode = '22023';
  end if;
  if new.source_commit !~ '^([0-9a-f]{40}|[0-9a-f]{64})$' then
    raise exception 'submission commit is not an exact lowercase digest' using errcode = '22023';
  end if;
  if new.source_path is distinct from btrim(new.source_path)
    or new.source_path is distinct from normalize(new.source_path, NFC)
    or length(new.source_path) not between 8 and 500
    or new.source_path !~ '(^|/)SKILL[.]md$'
    or new.source_path ~ '(^|/)[.][.]?(/|$)'
    or new.source_path ~ '//' or new.source_path ~ '[[:cntrl:]]'
    or left(new.source_path, 1) = '/' or right(new.source_path, 1) = '/'
    or position(E'\\' in new.source_path) > 0 then
    raise exception 'submission source path is not canonical' using errcode = '22023';
  end if;
  if new.version_label is distinct from btrim(new.version_label)
    or new.version_label is distinct from normalize(new.version_label, NFC)
    or length(new.version_label) not between 1 and 100
    or new.version_label ~ '[[:cntrl:]]' then
    raise exception 'submission version label is not canonical' using errcode = '22023';
  end if;
  if new.license_claim is not null and not private.valid_public_alpha_spdx(new.license_claim) then
    raise exception 'submission license claim is not approved for public alpha' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 7319));
  if (select count(*) from api.skill_submissions submission
      where submission.submitter_user_id = caller_id
        and submission.state in ('queued', 'processing')) >= 3 then
    raise exception 'submission active limit exceeded' using errcode = 'P0001';
  end if;
  if (select count(*) from api.skill_submissions submission
      where submission.submitter_user_id = caller_id
        and submission.created_at >= now() - interval '24 hours') >= 10 then
    raise exception 'submission rolling limit exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create function api.renew_skill_submission_claim(
  p_submission_id text,
  p_claim_id uuid,
  p_worker_version text,
  p_lease_seconds integer default 300
)
returns table (submission_id text, claim_id uuid, claim_expires_at timestamptz)
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
    or p_claim_id is null
    or p_worker_version is null or length(p_worker_version) not between 1 and 128
      or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_lease_seconds not between 30 and 900 then
    raise exception 'claim renewal request is invalid' using errcode = '22023';
  end if;
  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id for update;
  if submission_row.id is null then raise exception 'submission was not found' using errcode = 'P0002'; end if;
  if submission_row.state <> 'processing'
    or submission_row.active_claim_id is distinct from p_claim_id
    or submission_row.current_worker_version is distinct from p_worker_version
    or submission_row.claim_expires_at is null or submission_row.claim_expires_at <= now() then
    raise exception 'only the exact live claim can be renewed' using errcode = '55000';
  end if;
  return query
  update api.skill_submissions submission
  set claim_expires_at = greatest(
    submission.claim_expires_at,
    now() + make_interval(secs => p_lease_seconds)
  )
  where submission.id = submission_row.id
  returning submission.public_id, submission.active_claim_id, submission.claim_expires_at;
end;
$$;

create trigger skill_submissions_abuse_bounds
before insert on api.skill_submissions
for each row execute function private.enforce_submission_abuse_bounds();

create function private.enforce_skill_report_insert()
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

create function private.enforce_skill_report_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.public_id, old.reporter_user_id, old.skill_id, old.version_id,
      old.category, old.message, old.idempotency_key, old.created_at)
    is distinct from
    row(new.id, new.public_id, new.reporter_user_id, new.skill_id, new.version_id,
      new.category, new.message, new.idempotency_key, new.created_at) then
    raise exception 'report target, content, and ownership are immutable' using errcode = '23514';
  end if;
  if old.state <> new.state and not (old.state = 'queued' and new.state = 'resolved') then
    raise exception 'illegal report state transition' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger skill_reports_validate_insert
before insert on api.skill_reports
for each row execute function private.enforce_skill_report_insert();
create trigger skill_reports_validate_update
before update on api.skill_reports
for each row execute function private.enforce_skill_report_update();

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purge_user_id uuid;
begin
  purge_user_id := nullif(current_setting('skillmap.account_purge_user_id', true), '')::uuid;
  if tg_op = 'UPDATE' and tg_table_schema = 'private' and tg_table_name in ('submission_events', 'audit_events') then
    if pg_trigger_depth() = 2 and purge_user_id is not null
      and old.actor_user_id = purge_user_id and new.actor_user_id is null
      and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id') then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' and tg_table_schema = 'private' and pg_trigger_depth() = 2
    and purge_user_id is not null and tg_table_name in (
      'submission_events', 'skill_audit_receipts', 'skill_grade_receipts', 'review_cases', 'worker_runs'
    ) then
    return old;
  end if;
  raise exception 'append-only hosted authority rows cannot be changed' using errcode = '55000';
end;
$$;

create trigger audit_events_append_only
before update or delete on private.audit_events
for each row execute function private.reject_append_only_mutation();

alter table api.skill_reports enable row level security;
alter table api.skill_reports force row level security;

create policy skill_reports_own_select on api.skill_reports
for select to authenticated using (reporter_user_id = (select auth.uid()));
create policy skill_reports_own_insert on api.skill_reports
for insert to authenticated with check (
  reporter_user_id = (select auth.uid()) and state = 'queued'
  and disposition_code is null and resolution_reason_code is null
  and public_resolution_message is null and resolution_digest is null and resolved_at is null
);

create view api.my_skill_reports
with (security_invoker = true, security_barrier = true)
as
select public_id as report_id, skill_id, version_id, category, message, state,
  disposition_code, resolution_reason_code, public_resolution_message,
  created_at, updated_at, resolved_at
from api.skill_reports;

create function private.receipt_backed_version_is_restorable(version_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.skill_versions version
    join api.skill_submissions submission on submission.id = version.source_submission_id
    join private.skill_audit_receipts audit
      on audit.id = version.submission_audit_receipt_id and audit.submission_id = submission.id
    join private.skill_grade_receipts grade
      on grade.id = version.submission_grade_receipt_id and grade.submission_id = submission.id
      and grade.audit_receipt_id = audit.id
    where version.id = version_uuid
      and version.publication_state = 'published'
      and version.license_state <> 'restricted'
      and version.source_commit = submission.source_commit
      and version.source_path = submission.source_path
      and version.entrypoint_content_digest = audit.source_content_digest
      and version.license_state = audit.license_state
      and version.spdx_expression is not distinct from audit.spdx_expression
      and version.permission_scripts = audit.permission_scripts
      and (cardinality(version.permission_network) > 0) = audit.network_indicators
      and (cardinality(version.permission_tools) > 0) = audit.tool_indicators
      and version.evidence_provenance_state = 'source-pinned'
      and version.evidence_audit_state in ('passed', 'warnings')
      and audit.state = version.evidence_audit_state
      and version.compatibility_state = 'declared'
      and version.grade_state = 'provisional' and version.grade_band is null
      and grade.state = 'provisional'
  );
$$;

create function api.disposition_skill_report(
  p_report_id text,
  p_disposition_code text,
  p_reason_code text,
  p_public_message text,
  p_idempotency_digest text
)
returns table (report_id text, report_state text, disposition_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row api.skill_reports%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'report disposition authority is required' using errcode = '42501';
  end if;
  if p_report_id is null or p_report_id !~ '^rpt_[0-9a-f]{32}$'
    or p_disposition_code not in ('confirmed', 'no-action', 'duplicate', 'invalid')
    or p_reason_code is null or length(p_reason_code) not between 1 and 64
      or p_reason_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_public_message is null or not private.safe_public_message(p_public_message, 500)
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'report disposition is invalid' using errcode = '22023';
  end if;
  select * into report_row from api.skill_reports report
  where report.public_id = p_report_id for update;
  if report_row.id is null then raise exception 'report was not found' using errcode = 'P0002'; end if;
  if report_row.state = 'resolved' then
    if report_row.resolution_digest = p_idempotency_digest
      and report_row.disposition_code = p_disposition_code
      and report_row.resolution_reason_code = p_reason_code
      and report_row.public_resolution_message = p_public_message then
      return query select report_row.public_id, report_row.state, report_row.disposition_code;
      return;
    end if;
    raise exception 'report is already resolved by another disposition' using errcode = '55000';
  end if;
  update api.skill_reports report
  set state = 'resolved', disposition_code = p_disposition_code,
    resolution_reason_code = p_reason_code, public_resolution_message = p_public_message,
    resolution_digest = p_idempotency_digest, resolved_at = now()
  where report.id = report_row.id
  returning report.public_id, report.state, report.disposition_code
  into report_id, report_state, disposition_code;
  insert into private.audit_events (
    event_type, subject_type, subject_id, idempotency_digest, payload
  ) values (
    'report.dispositioned', 'report', report_row.public_id, p_idempotency_digest,
    jsonb_build_object('dispositionCode', p_disposition_code, 'reasonCode', p_reason_code)
  );
  return next;
end;
$$;

create function api.list_skill_report_queue(p_limit integer default 20)
returns table (
  report_id text, skill_id text, version_id text,
  category text, message text, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'report queue authority is required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'report queue limit must be between 1 and 50' using errcode = '22023';
  end if;
  return query
  select report.public_id, report.skill_id, report.version_id,
    report.category, report.message, report.created_at
  from api.skill_reports report
  where report.state = 'queued'
  order by report.created_at, report.public_id
  limit p_limit;
end;
$$;

create function api.control_catalog_lifecycle(
  p_skill_id text,
  p_version_id text,
  p_action text,
  p_reason_code text,
  p_idempotency_digest text
)
returns table (
  skill_id text, version_id text, skill_lifecycle_state text,
  skill_revoked boolean, version_quarantined boolean, version_revoked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  skill_row private.skills%rowtype;
  version_row private.skill_versions%rowtype;
  prior_event private.audit_events%rowtype;
  subject_type_value text;
  subject_id_value text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'catalog lifecycle authority is required' using errcode = '42501';
  end if;
  if p_skill_id is null or p_skill_id !~ '^skl_[0-9a-f]{32}$'
    or p_action not in ('deprecate-skill', 'revoke-skill', 'restore-skill',
      'quarantine-version', 'revoke-version', 'restore-version')
    or p_reason_code is null or length(p_reason_code) not between 1 and 64
      or p_reason_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or (p_action like '%-skill' and p_version_id is not null)
    or (p_action like '%-version' and (p_version_id is null or p_version_id !~ '^skv_[0-9a-f]{32}$')) then
    raise exception 'catalog lifecycle request is invalid' using errcode = '22023';
  end if;
  select * into skill_row from private.skills skill where skill.public_id = p_skill_id for update;
  if skill_row.id is null then raise exception 'skill was not found' using errcode = 'P0002'; end if;
  if p_version_id is not null then
    select * into version_row from private.skill_versions version
    where version.public_id = p_version_id and version.skill_id = skill_row.id for update;
    if version_row.id is null then
      raise exception 'version does not belong to the exact skill' using errcode = '23514';
    end if;
  end if;
  subject_type_value := case when p_version_id is null then 'skill' else 'skill-version' end;
  subject_id_value := coalesce(p_version_id, p_skill_id);
  select * into prior_event from private.audit_events event
  where event.idempotency_digest = p_idempotency_digest;
  if prior_event.id is not null then
    if prior_event.subject_type <> subject_type_value or prior_event.subject_id <> subject_id_value
      or prior_event.event_type <> 'catalog.' || p_action
      or prior_event.payload <> jsonb_build_object('reasonCode', p_reason_code) then
      raise exception 'lifecycle idempotency digest conflicts with another event' using errcode = '23505';
    end if;
    return query select skill_row.public_id, p_version_id, skill_row.lifecycle_state,
      skill_row.revoked_at is not null, version_row.quarantined_at is not null,
      version_row.revoked_at is not null;
    return;
  end if;
  case p_action
    when 'deprecate-skill' then
      update private.skills set lifecycle_state = 'deprecated', updated_at = now()
      where id = skill_row.id returning * into skill_row;
    when 'revoke-skill' then
      update private.skills set revoked_at = coalesce(revoked_at, now()), updated_at = now()
      where id = skill_row.id returning * into skill_row;
    when 'restore-skill' then
      if skill_row.current_version_id is null
        or not private.receipt_backed_version_is_restorable(skill_row.current_version_id) then
        raise exception 'skill restore requires a valid non-restricted receipt-backed current version'
          using errcode = '55000';
      end if;
      update private.skills set lifecycle_state = 'published', revoked_at = null, updated_at = now()
      where id = skill_row.id returning * into skill_row;
    when 'quarantine-version' then
      update private.skill_versions set quarantined_at = coalesce(quarantined_at, now())
      where id = version_row.id returning * into version_row;
    when 'revoke-version' then
      update private.skill_versions set revoked_at = coalesce(revoked_at, now())
      where id = version_row.id returning * into version_row;
    when 'restore-version' then
      if not private.receipt_backed_version_is_restorable(version_row.id) then
        raise exception 'version restore requires valid non-restricted receipt-backed evidence'
          using errcode = '55000';
      end if;
      update private.skill_versions set quarantined_at = null, revoked_at = null
      where id = version_row.id returning * into version_row;
  end case;
  insert into private.audit_events (
    event_type, subject_type, subject_id, idempotency_digest, payload
  ) values (
    'catalog.' || p_action, subject_type_value, subject_id_value,
    p_idempotency_digest, jsonb_build_object('reasonCode', p_reason_code)
  );
  return query select skill_row.public_id, p_version_id, skill_row.lifecycle_state,
    skill_row.revoked_at is not null, version_row.quarantined_at is not null,
    version_row.revoked_at is not null;
end;
$$;

create policy skill_audit_receipts_public_projection_select on private.skill_audit_receipts
for select to anon, authenticated using (
  exists (
    select 1 from private.skill_versions version
    join private.skills skill on skill.id = version.skill_id and skill.current_version_id = version.id
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where version.submission_audit_receipt_id = skill_audit_receipts.id
      and publisher.catalog_state = 'published' and publisher.revoked_at is null
      and repository.catalog_state = 'published' and repository.revoked_at is null
      and version.publication_state = 'published'
      and version.license_state <> 'restricted'
      and version.quarantined_at is null and version.revoked_at is null
      and skill.visibility_state = 'public'
      and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
  )
);
create policy skill_grade_receipts_public_projection_select on private.skill_grade_receipts
for select to anon, authenticated using (
  exists (
    select 1 from private.skill_versions version
    join private.skills skill on skill.id = version.skill_id and skill.current_version_id = version.id
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where version.submission_grade_receipt_id = skill_grade_receipts.id
      and publisher.catalog_state = 'published' and publisher.revoked_at is null
      and repository.catalog_state = 'published' and repository.revoked_at is null
      and version.publication_state = 'published'
      and version.license_state <> 'restricted'
      and version.quarantined_at is null and version.revoked_at is null
      and skill.visibility_state = 'public'
      and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
  )
);

create view api.catalog_audit_evidence
with (security_invoker = true, security_barrier = true)
as
select audit.public_id as audit_receipt_id, audit.receipt_digest,
  skill.public_id as skill_id, version.public_id as version_id,
  version.source_commit, audit.state, audit.finding_counts,
  audit.public_checks as checks, audit.reason_codes, audit.policy_version,
  audit.host_profile_version, audit.worker_version, audit.created_at as audited_at,
  audit.license_state, audit.spdx_expression, audit.permission_scripts,
  audit.network_indicators, audit.tool_indicators
from private.skill_audit_receipts audit
join private.skill_versions version on version.submission_audit_receipt_id = audit.id
join private.skills skill on skill.id = version.skill_id and skill.current_version_id = version.id
join private.publishers publisher on publisher.id = skill.publisher_id
join private.source_repositories repository on repository.id = skill.source_repository_id
where publisher.catalog_state = 'published' and publisher.revoked_at is null
  and repository.catalog_state = 'published' and repository.revoked_at is null
  and skill.visibility_state = 'public'
  and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
  and version.publication_state = 'published' and version.license_state <> 'restricted'
  and version.quarantined_at is null and version.revoked_at is null;

create view api.catalog_grade_evidence
with (security_invoker = true, security_barrier = true)
as
select grade.public_id as grade_receipt_id, grade.receipt_digest,
  audit.public_id as audit_receipt_id, audit.receipt_digest as audit_receipt_digest,
  skill.public_id as skill_id, version.public_id as version_id,
  version.source_commit, grade.state, grade.total_score, grade.confidence,
  grade.compatibility_evidence_digest, grade.evaluation_suite_digest,
  grade.rubric_version, grade.host_profile_version, grade.evaluator_version,
  grade.hard_gates, grade.dimensions, grade.reason_codes,
  grade.created_at as graded_at
from private.skill_grade_receipts grade
join private.skill_audit_receipts audit on audit.id = grade.audit_receipt_id
join private.skill_versions version on version.submission_grade_receipt_id = grade.id
join private.skills skill on skill.id = version.skill_id and skill.current_version_id = version.id
join private.publishers publisher on publisher.id = skill.publisher_id
join private.source_repositories repository on repository.id = skill.source_repository_id
where publisher.catalog_state = 'published' and publisher.revoked_at is null
  and repository.catalog_state = 'published' and repository.revoked_at is null
  and skill.visibility_state = 'public'
  and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
  and version.publication_state = 'published' and version.license_state <> 'restricted'
  and version.quarantined_at is null and version.revoked_at is null;

revoke all on table api.skill_reports from public, anon, authenticated, service_role;
revoke all on api.my_skill_reports from public, anon, authenticated, service_role;
revoke all on api.catalog_audit_evidence from public, anon, authenticated, service_role;
revoke all on api.catalog_grade_evidence from public, anon, authenticated, service_role;
revoke all on function api.disposition_skill_report(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.list_skill_report_queue(integer) from public, anon, authenticated, service_role;
revoke all on function api.control_catalog_lifecycle(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.renew_skill_submission_claim(text, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.enforce_submission_abuse_bounds() from public, anon, authenticated, service_role;
revoke all on function private.enforce_skill_report_insert() from public, anon, authenticated, service_role;
revoke all on function private.enforce_skill_report_update() from public, anon, authenticated, service_role;
revoke all on function private.receipt_backed_version_is_restorable(uuid) from public, anon, authenticated, service_role;

grant select (
  public_id, skill_id, version_id, category, message, state, disposition_code,
  resolution_reason_code, public_resolution_message, created_at, updated_at, resolved_at
) on api.skill_reports to authenticated;
grant insert (skill_id, version_id, category, message, idempotency_key)
  on api.skill_reports to authenticated;
grant select on api.my_skill_reports to authenticated;
grant execute on function api.disposition_skill_report(text, text, text, text, text) to service_role;
grant execute on function api.list_skill_report_queue(integer) to service_role;
grant execute on function api.control_catalog_lifecycle(text, text, text, text, text) to service_role;
grant execute on function api.renew_skill_submission_claim(text, uuid, text, integer) to service_role;

grant select (
  id, public_id, state, receipt_digest, source_content_digest, normalized_content_digest,
  policy_version, host_profile_version, worker_version, finding_counts, public_checks,
  reason_codes, created_at, license_state, spdx_expression, permission_scripts,
  network_indicators, tool_indicators
) on private.skill_audit_receipts to anon, authenticated;
grant select (
  id, public_id, audit_receipt_id, state, total_score, confidence, receipt_digest,
  normalized_content_digest, audit_receipt_digest, compatibility_evidence_digest,
  evaluation_suite_digest, rubric_version, host_profile_version, evaluator_version,
  hard_gates, dimensions, reason_codes, created_at
) on private.skill_grade_receipts to anon, authenticated;
grant select on api.catalog_audit_evidence to anon, authenticated;
grant select on api.catalog_grade_evidence to anon, authenticated;

comment on table api.skill_reports is
  'Authenticated account-owned suspicious-listing reports. Anonymous reporting is deferred until provider-level anti-spam exists.';
comment on function api.disposition_skill_report(text, text, text, text, text) is
  'Service-role-only idempotent report disposition with append-only audit history.';
comment on function api.list_skill_report_queue(integer) is
  'Service-role-only bounded queued-report listing, oldest first, without reporter or internal identifiers.';
comment on function api.control_catalog_lifecycle(text, text, text, text, text) is
  'Service-role-only idempotent catalog deprecation, quarantine, revocation, and receipt-backed restoration.';
comment on function api.renew_skill_submission_claim(text, uuid, text, integer) is
  'Service-role-only bounded renewal for the exact live claim. Renewal cannot resurrect an expired or stolen lease and never shortens the lease.';
comment on view api.catalog_audit_evidence is
  'Bounded current-public audit evidence projection. receipt_digest is the canonical evidence digest, not a public projection digest.';
comment on view api.catalog_grade_evidence is
  'Bounded current-public grade evidence projection. receipt_digest is the canonical evidence digest, not a public projection digest.';

commit;
