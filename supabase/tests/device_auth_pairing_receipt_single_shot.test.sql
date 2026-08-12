begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(12);

select ok(
  exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'device_auth_redact_pairing_receipt'
       and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
  ),
  'pairing receipt redaction trigger function exists'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_trigger t
     where t.tgrelid = 'private.device_auth_idempotency_receipts'::regclass
       and t.tgname = 'device_auth_redact_pairing_receipt'
       and t.tgenabled = 'O'
       and not t.tgisinternal
  ),
  'pairing receipt redaction trigger is enabled on the receipt table'
);

select ok(
  (select pg_catalog.pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF outcome_json, operation%'
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'private.device_auth_idempotency_receipts'::regclass
      and t.tgname = 'device_auth_redact_pairing_receipt'),
  'redaction runs before initiate receipt bodies are stored'
);

select ok(
  pg_catalog.pg_get_functiondef('private.device_auth_redact_pairing_receipt()'::pg_catalog.regprocedure)
    like '%temporarily_unavailable%'
    and pg_catalog.pg_get_functiondef('private.device_auth_redact_pairing_receipt()'::pg_catalog.regprocedure)
      like '%cannot be replayed safely%',
  'redaction stores a fixed safe retry outcome'
);

delete from private.device_auth_idempotency_receipts
 where principal = 'PAIRING-REDACT-P1'
   and operation = 'initiate';

select lives_ok($sql$
  insert into private.device_auth_idempotency_receipts(
    principal_kind, principal, operation, idempotency_key, request_digest,
    outcome_json, expired_at
  ) values (
    'device', 'PAIRING-REDACT-P1', 'initiate', repeat('P', 22),
    'sha256:' || repeat('a', 64),
    jsonb_build_object('device_code', repeat('D', 43), 'user_code', 'ABCDE-FGHJK'),
    now() + interval '10 minutes'
  )
$sql$, 'raw initiate receipt input is accepted before trigger redaction');

select is(
  (select outcome_json->>'error'
     from private.device_auth_idempotency_receipts
    where principal = 'PAIRING-REDACT-P1'
      and operation = 'initiate'),
  'temporarily_unavailable',
  'initiate receipt is stored as a fixed retry error'
);

select ok(
  (select not (outcome_json ? 'device_code') and not (outcome_json ? 'user_code')
     from private.device_auth_idempotency_receipts
    where principal = 'PAIRING-REDACT-P1'
      and operation = 'initiate'),
  'new initiate receipt has no raw device_code or user_code'
);

update private.device_auth_idempotency_receipts
   set outcome_json = jsonb_build_object(
     'device_code', repeat('E', 43), 'user_code', 'KLMNO-PQRST'
   )
 where principal = 'PAIRING-REDACT-P1'
   and operation = 'initiate';

select is(
  (select outcome_json->>'error'
     from private.device_auth_idempotency_receipts
    where principal = 'PAIRING-REDACT-P1'
      and operation = 'initiate'),
  'temporarily_unavailable',
  'updates cannot reintroduce raw pairing codes into an initiate receipt'
);

select ok(
  (select not (outcome_json ? 'device_code') and not (outcome_json ? 'user_code')
     from private.device_auth_idempotency_receipts
    where principal = 'PAIRING-REDACT-P1'
      and operation = 'initiate'),
  'redacted initiate receipt remains code-free after update'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'private.device_auth_idempotency_receipts'::regclass
       and conname = 'device_auth_idempotency_receipts_initiate_no_plaintext_check'
  ),
  'initiate receipt table has a no-plaintext structural check'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)'::pg_catalog.regprocedure
  ) like '%return v_stored_outcome%'
  and pg_catalog.pg_get_functiondef(
    'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)'::pg_catalog.regprocedure
  ) like '%idempotency_conflict%',
  'initiate keeps exact-digest lookup and changed-digest conflict handling'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)'::pg_catalog.regprocedure
  ) like '%device_code%'
  and pg_catalog.pg_get_functiondef(
    'private.device_auth_redact_pairing_receipt()'::pg_catalog.regprocedure
  ) not like '%device_code%'
  and pg_catalog.pg_get_functiondef(
    'private.device_auth_redact_pairing_receipt()'::pg_catalog.regprocedure
  ) not like '%user_code%',
  'first response still carries pairing codes while the receipt redactor never handles raw code fields'
);

select * from finish();
rollback;
