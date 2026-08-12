begin;

set local search_path = '';

-- M3.03 P1 repair: initiation returns device/user codes once, but the
-- idempotency receipt must not become a durable secret cache. The historical
-- initiate RPC still constructs the response and inserts its receipt in one
-- transaction. A BEFORE trigger replaces only the persisted initiate body
-- with a fixed terminal error. The RPC therefore keeps its first response,
-- preserves changed-digest conflicts, and safely fails same-digest retries
-- after a committed response was already returned or may have been lost.

create or replace function private.device_auth_redact_pairing_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.operation = 'initiate' then
    new.outcome_json := private.device_auth_error_json(
      'temporarily_unavailable',
      'The pairing response cannot be replayed safely.'
    );
  end if;
  return new;
end
$function$;

drop trigger if exists device_auth_redact_pairing_receipt
  on private.device_auth_idempotency_receipts;
create trigger device_auth_redact_pairing_receipt
  before insert or update of outcome_json, operation
  on private.device_auth_idempotency_receipts
  for each row
  when (new.operation = 'initiate')
  execute function private.device_auth_redact_pairing_receipt();

-- Remove raw codes already written by the hosted foundation migration. The
-- trigger also makes this safe if a future migration replays the cleanup.
update private.device_auth_idempotency_receipts
   set outcome_json = private.device_auth_error_json(
     'temporarily_unavailable',
     'The pairing response cannot be replayed safely.'
   )
 where operation = 'initiate';

alter table private.device_auth_idempotency_receipts
  drop constraint if exists device_auth_idempotency_receipts_initiate_no_plaintext_check;
alter table private.device_auth_idempotency_receipts
  add constraint device_auth_idempotency_receipts_initiate_no_plaintext_check
  check (
    operation <> 'initiate'
    or (not (outcome_json ? 'device_code') and not (outcome_json ? 'user_code'))
  );

revoke all on function private.device_auth_redact_pairing_receipt() from public, anon, authenticated, service_role;

commit;
