begin;

-- A report insert can conflict either with the owner's request UUID or with
-- the one-queued-report-per-version/category index. Expose the opaque request
-- UUID only through the existing owner-RLS projection so the web action can
-- distinguish an exact retry from a different queued report without guessing
-- from mutable report text.
create or replace view api.my_skill_reports
with (security_invoker = true, security_barrier = true)
as
select public_id as report_id, skill_id, version_id, category, message, state,
  disposition_code, resolution_reason_code, public_resolution_message,
  created_at, updated_at, resolved_at, idempotency_key
from api.skill_reports;

revoke all on api.my_skill_reports from public, anon, authenticated, service_role;
grant select on api.my_skill_reports to authenticated;
grant select (idempotency_key) on api.skill_reports to authenticated;

comment on view api.my_skill_reports is
  'Owner-RLS report history and exact request-ID recovery projection. The opaque idempotency key is visible only to its authenticated owner.';

commit;
