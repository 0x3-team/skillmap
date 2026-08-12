import assert from 'node:assert/strict';

const DP_KEYCHAIN_SCHEMA = 'skillmap.m3-03.dp-keychain-no-profile-capability';
const DP_KEYCHAIN_STATUS = Object.freeze({
  PASS: 'PASS_DP_KEYCHAIN_NO_PROFILE_CAPABILITY',
  FAIL: 'FAIL_DP_KEYCHAIN_NO_PROFILE_CAPABILITY',
});
const ROW_MODES = Object.freeze(['unsigned', 'adhoc']);
const OS_STATUS_NAMES = new Set([
  'errSecSuccess',
  'errSecItemNotFound',
  'errSecDuplicateItem',
  'errSecParam',
  'errSecAuthFailed',
  'errSecInteractionNotAllowed',
  'errSecMissingEntitlement',
  'unknown_osstatus',
]);
const SENSITIVE_MARKERS = Object.freeze([
  'BEGIN PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
  'key_bytes',
  'private_key',
  'password',
  'token',
  'access_token',
  'account_identifier',
  'application-identifier',
  'embedded.mobileprovision',
  'keychain-access-groups',
]);

function fail(message) {
  throw new TypeError(`invalid dp-keychain receipt: ${message}`);
}

function plainRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(label);
  return value;
}

function boundedString(value, label, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(label);
  return value;
}

function digest(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) fail(label);
  return value;
}

function status(value, label) {
  const target = plainRecord(value, label);
  if (!Number.isInteger(target.code) || target.code < -2147483648 || target.code > 2147483647) fail(`${label}.code`);
  if (!OS_STATUS_NAMES.has(target.name)) fail(`${label}.name`);
  if (typeof target.ok !== 'boolean' || target.ok !== (target.code === 0)) fail(`${label}.ok`);
  return { code: target.code, name: target.name, ok: target.ok };
}

function operation(value, label, expectCode) {
  const target = status(value, label);
  if (target.code !== expectCode) fail(`${label}.expected_code`);
  return target;
}

function copyEvidence(value, label, expectedCode) {
  const target = plainRecord(value, label);
  operation(target.status, `${label}.status`, expectedCode);
  if (!Number.isInteger(target.bytes) || target.bytes < 0 || target.bytes > 4096) fail(`${label}.bytes`);
  digest(target.digest, `${label}.digest`);
  if (typeof target.equal !== 'boolean' || target.equal !== (expectedCode === 0)) fail(`${label}.equal`);
  return target;
}

export function parseCapabilityRowV1(value) {
  const row = plainRecord(value, 'row');
  if (row.schema !== `${DP_KEYCHAIN_SCHEMA}.row.v1`) fail('schema');
  if (!ROW_MODES.includes(row.mode)) fail('mode');
  if (!['unsigned', 'adhoc'].includes(row.signature_state)) fail('signature_state');
  if (row.signature_state !== row.mode) fail('signature_mode');
  const config = plainRecord(row.config, 'config');
  if (config.key_class !== 'kSecClassGenericPassword') fail('config.key_class');
  if (config.data_protection_keychain !== true) fail('config.data_protection_keychain');
  if (config.accessible !== 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly') fail('config.accessible');
  if (config.synchronizable !== false) fail('config.synchronizable');
  if (config.access_group_key_present !== false) fail('config.access_group_key_present');
  if (config.access_group_value_present !== false) fail('config.access_group_value_present');
  if (config.p256_key_type !== 'kSecAttrKeyTypeECSECPrimeRandom' || config.p256_key_bits !== 256) fail('config.p256');
  if (!Number.isInteger(config.value_bytes) || config.value_bytes <= 0 || config.value_bytes > 4096) fail('config.value_bytes');
  digest(config.value_digest, 'config.value_digest');
  const lifecycle = plainRecord(row.lifecycle, 'lifecycle');
  operation(lifecycle.add, 'lifecycle.add', 0);
  operation(lifecycle.duplicate_add, 'lifecycle.duplicate_add', -25299);
  copyEvidence(lifecycle.copy, 'lifecycle.copy', 0);
  operation(lifecycle.update, 'lifecycle.update', 0);
  copyEvidence(lifecycle.copy_after_update, 'lifecycle.copy_after_update', 0);
  operation(lifecycle.wrong_account, 'lifecycle.wrong_account', -25300);
  operation(lifecycle.no_synchronizable_copy, 'lifecycle.no_synchronizable_copy', -25300);
  operation(lifecycle.delete, 'lifecycle.delete', 0);
  operation(lifecycle.post_delete, 'lifecycle.post_delete', -25300);
  const assertions = plainRecord(row.assertions, 'assertions');
  for (const key of ['exact_copy_compare', 'exact_update_compare', 'no_prompt_observed', 'no_canary_in_process_metadata', 'no_canary_in_output', 'known_osstatus_only']) {
    if (assertions[key] !== true) fail(`assertions.${key}`);
  }
  if (row.status !== 'PASS') fail('row.status');
  return row;
}

export function parseCleanupV1(value) {
  const cleanup = plainRecord(value, 'cleanup');
  if (cleanup.schema !== `${DP_KEYCHAIN_SCHEMA}.cleanup.v1`) fail('cleanup.schema');
  if (!['unsigned', 'adhoc'].includes(cleanup.mode)) fail('cleanup.mode');
  operation(cleanup.delete, 'cleanup.delete', cleanup.delete.code);
  if (![-25300, 0].includes(cleanup.delete.code)) fail('cleanup.delete.code');
  operation(cleanup.post_delete, 'cleanup.post_delete', -25300);
  if (cleanup.residue_removed !== (cleanup.delete.code === 0)) fail('cleanup.residue_removed');
  if (cleanup.already_clean !== (cleanup.delete.code === -25300)) fail('cleanup.already_clean');
  if (cleanup.status !== 'PASS') fail('cleanup.status');
  return cleanup;
}

export function assertNoSensitiveCapabilityOutput(value, extraMarkers = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') fail('output');
  for (const marker of [...SENSITIVE_MARKERS, ...extraMarkers]) {
    if (typeof marker === 'string' && marker.length > 0 && text.includes(marker)) throw new Error(`sensitive dp-keychain marker: ${marker}`);
  }
  return true;
}

export function redactCapabilityReceipt(input) {
  const source = plainRecord(input, 'receipt');
  const receipt = {
    schema: `${DP_KEYCHAIN_SCHEMA}.receipt.v1`,
    status: source.status,
    observed_at: boundedString(source.observed_at, 'observed_at', 64),
    source: {
      path: 'test/fixtures/m3-03-dp-keychain-no-profile-capability/CapabilityProbe.swift',
      sha256: digest(source.source?.sha256, 'source.sha256'),
      compiler: boundedString(source.source?.compiler, 'source.compiler'),
      compiler_version_digest: digest(source.source?.compiler_version_digest, 'source.compiler_version_digest'),
    },
    target: plainRecord(source.target, 'target'),
    binaries: source.binaries,
    rows: source.rows,
    cleanup: source.cleanup,
    adversarial: source.adversarial,
    worktree: source.worktree,
    route: { requested: 'gpt-5.6-luna/high', confirmed: false },
    external_mutation: false,
    ledger_mutation: false,
    product_source_or_contract_touched: false,
    non_claims: [
      'No Apple Developer identity, Team ID, entitlement, profile, access group, production key, provider, browser, database, push, or deploy action.',
      'Capability evidence only; no V3 custody, helper, support label, or product contract was selected.',
    ],
  };
  if (![DP_KEYCHAIN_STATUS.PASS, DP_KEYCHAIN_STATUS.FAIL].includes(receipt.status)) fail('status');
  assertNoSensitiveCapabilityOutput(receipt);
  return receipt;
}

export { DP_KEYCHAIN_SCHEMA, DP_KEYCHAIN_STATUS, ROW_MODES, SENSITIVE_MARKERS };
