create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = extensions, private, public;

begin;

select plan(5);

create temporary table local_m207_credential_vectors (
  label text not null primary key,
  raw_token text not null,
  expected_digest_hex text not null,
  key_version integer not null
);

insert into local_m207_credential_vectors (label, raw_token, expected_digest_hex, key_version)
values
  ('a1_v1', 'm207-test-device-token-raw-01', '86aa97e8e7ee358aa99c426cf29ace60c5d3f6c136a53cc93570a2b1e40ceca0', 1),
  ('a1_v2', 'm207-test-device-token-raw-02', '9daff84bd4e54a4fa680d4a8f439a3db8acc0e572c68ffdb67a6341fc3776f6c', 2),
  ('a1_v3', 'm207-test-device-token-raw-03', '2a35b52b6cb476807317419b53f7a7045d1cdcf84b3be32f84bb85eb5e17e64b', 3),
  ('a1_v4', 'm207-test-device-token-raw-04', 'd87da6fe8e1d303fab699dd28a32d1e2e6db56aeccaf9678647d148c297a281a', 4),
  ('a1_v5', 'm207-test-device-token-raw-05', '5a0da8116e6f7d19f2ec22f390ccbae1531ef99d6d6c2c6322e423f9147e7daf', 5),
  ('a1_v6', 'm207-test-device-token-raw-06', 'cea45b2880a3fe16c530447fdd982b74bf7de5add23da568834bbcfa8f702f9f', 6),
  ('a1_guard', 'm207-test-device-token-raw-guard', 'b5e936521f66a66f4418a81f7a9ec12ba395935c00191919dc81125c8a91ce71', 9),
  ('b1_v1', 'm207-test-device-token-raw-03', '2a35b52b6cb476807317419b53f7a7045d1cdcf84b3be32f84bb85eb5e17e64b', 3),
  ('state_disabled', 'm207-test-device-token-raw-disabled', '0e1c67fecc14a904d53997ec8fd5a46b2f1d4667ba7b0e50427ecc4c60d7d5cb', 11),
  ('state_revoked', 'm207-test-device-token-raw-revoked', '00988066fa5834440aed25cae2acb9052a15d1a20f9a009838ba586eb4f7f5d1', 12),
  ('state_compromised', 'm207-test-device-token-raw-compromised', '536d4724593b75040c0ddee0378ee437c08bc0b5e43cea560092a7f70a7665a4', 13),
  ('state_expired', 'm207-test-device-token-raw-expired', '6cc21b1e457a2ec1f100bfbec8135c1f7964089134cd804b4be7c1cd08b14fde', 14);

select is(
  (select count(*) from local_m207_credential_vectors),
  12::bigint,
  'contract captures exactly twelve fixture vectors'
);

select is(
  (select count(*)
   from local_m207_credential_vectors as vectors
   where encode(extensions.hmac(raw_token, 'm207-device-token-vector-key', 'sha256'), 'hex') = expected_digest_hex),
  (select count(*) from local_m207_credential_vectors),
  'fixture vectors are fixed hmac-sha256 digests with shared test key'
);

select is(
  (select count(*)
   from private.device_tokens
   where credential_digest !~ '^hmac-sha256:[0-9a-f]{64}$'),
  0::bigint,
  'stored digests remain strict lower-case hmac-sha256 format'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'device_tokens'
      and column_name like 'raw%'
  ),
  'credential table does not expose raw token columns'
);

select is(
  (select count(*) from local_m207_credential_vectors where key_version > 0),
  (select count(*) from local_m207_credential_vectors),
  'contract requires positive key versions'
);

select finish();
rollback;
