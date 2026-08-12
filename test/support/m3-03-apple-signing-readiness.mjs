import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';

export const APPLE_READINESS_SCHEMA = 'skillmap.m3-03.apple-signing-readiness.v1';

export const APPLE_READINESS_STATUS = Object.freeze({
  PRIVATE_KEY_LEAKAGE: 'BLOCKED_PRIVATE_KEY_LEAKAGE',
  OUTPUT_REDACTION_FAILED: 'BLOCKED_OUTPUT_REDACTION_FAILED',
  KEYCHAIN_INTERACTION_RISK: 'BLOCKED_KEYCHAIN_INTERACTION_RISK',
  PATH_INTEGRITY_CHANGED: 'BLOCKED_PATH_INTEGRITY_CHANGED',
  INVENTORY_FAILURE: 'BLOCKED_INVENTORY_FAILURE',
  UNSUPPORTED_HOST: 'BLOCKED_UNSUPPORTED_HOST',
  DISPOSABLE_RUNNER_MISSING: 'BLOCKED_DISPOSABLE_RUNNER_MISSING',
  NETWORK_ISOLATION_MISSING: 'BLOCKED_NETWORK_ISOLATION_MISSING',
  NETWORK_ISOLATION_UNVERIFIED: 'BLOCKED_NETWORK_ISOLATION_UNVERIFIED',
  TOOLCHAIN_MISSING: 'BLOCKED_TOOLCHAIN_MISSING',
  TOOL_FINGERPRINT_MISSING: 'BLOCKED_TOOL_FINGERPRINT_MISSING',
  TASK_ROOT_MISSING: 'BLOCKED_TASK_ROOT_MISSING',
  DEDICATED_KEYCHAIN_MISSING: 'BLOCKED_DEDICATED_KEYCHAIN_MISSING',
  DEFAULT_KEYCHAIN_UNVERIFIED: 'BLOCKED_DEFAULT_KEYCHAIN_UNVERIFIED',
  KEYCHAIN_CONTENT_IDENTITY_UNVERIFIED: 'BLOCKED_KEYCHAIN_CONTENT_IDENTITY_UNVERIFIED',
  KEYCHAIN_DESCRIPTOR_BINDING_UNVERIFIED: 'BLOCKED_KEYCHAIN_DESCRIPTOR_BINDING_UNVERIFIED',
  IDENTITY_OUTPUT_MALFORMED: 'BLOCKED_IDENTITY_OUTPUT_MALFORMED',
  DEVELOPER_ID_APPLICATION_IDENTITY_MISSING: 'BLOCKED_DEVELOPER_ID_APPLICATION_IDENTITY_MISSING',
  IDENTITY_PUBLIC_CERTIFICATE_MISMATCH: 'BLOCKED_IDENTITY_PUBLIC_CERTIFICATE_MISMATCH',
  IDENTITY_CLASS_MISMATCH: 'BLOCKED_IDENTITY_CLASS_MISMATCH',
  CERTIFICATE_REVOKED: 'BLOCKED_CERTIFICATE_REVOKED',
  CERTIFICATE_NOT_YET_VALID: 'BLOCKED_CERTIFICATE_NOT_YET_VALID',
  CERTIFICATE_EXPIRED: 'BLOCKED_CERTIFICATE_EXPIRED',
  IDENTITY_AMBIGUOUS: 'BLOCKED_IDENTITY_AMBIGUOUS',
  TEAM_ID_MISMATCH: 'BLOCKED_TEAM_ID_MISMATCH',
  PROFILE_MALFORMED: 'BLOCKED_PROFILE_MALFORMED',
  PROFILE_NOT_YET_VALID: 'BLOCKED_PROFILE_NOT_YET_VALID',
  PROFILE_EXPIRED: 'BLOCKED_PROFILE_EXPIRED',
  PROFILE_STALE: 'BLOCKED_PROFILE_STALE',
  PROFILE_AMBIGUOUS: 'BLOCKED_PROFILE_AMBIGUOUS',
  PROFILE_TEAM_MISMATCH: 'BLOCKED_PROFILE_TEAM_MISMATCH',
  PROFILE_APP_ID_MISMATCH: 'BLOCKED_PROFILE_APP_ID_MISMATCH',
  PROFILE_ACCESS_GROUP_MISMATCH: 'BLOCKED_PROFILE_ACCESS_GROUP_MISMATCH',
  PROFILE_CERTIFICATE_MISMATCH: 'BLOCKED_PROFILE_CERTIFICATE_MISMATCH',
  PROFILE_DISTRIBUTION_MISMATCH: 'BLOCKED_PROFILE_DISTRIBUTION_MISMATCH',
  READY: 'READY_FOR_AUTHORIZED_SIGNING_PROOF',
});

export const APPLE_READINESS_EXPECTED = Object.freeze({
  launcher_bundle_id: 'dev.skillmap.connector.launcher',
  helper_bundle_id: 'dev.skillmap.connector.keychain-helper',
  access_group_suffix: 'dev.skillmap.connector.credentials',
  keychain_service: 'dev.skillmap.connector.device-auth.v1',
  certificate_class: 'Developer ID Application',
  architecture: 'arm64',
});

const MAX_BYTES = 256 * 1024;
const TOOL_SCHEMA = 'skillmap.m3-03.apple-signing-readiness.tool.v1';
const IDENTITY_SCHEMA = 'skillmap.m3-03.apple-signing-readiness.identity.v1';
const CERTIFICATE_SCHEMA = 'skillmap.m3-03.apple-signing-readiness.certificates.v1';
const PROFILE_SCHEMA = 'skillmap.m3-03.apple-signing-readiness.profile.v1';
const TOOL_KEYS = Object.freeze(['swiftc', 'codesign', 'security', 'notarytool', 'stapler', 'plutil']);
const HELP_TOOL_KEYS = Object.freeze(['codesign', 'security_find_identity', 'security_cms', 'stapler', 'plutil']);
const PRECEDENCE = Object.freeze([
  APPLE_READINESS_STATUS.PRIVATE_KEY_LEAKAGE,
  APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED,
  APPLE_READINESS_STATUS.KEYCHAIN_INTERACTION_RISK,
  APPLE_READINESS_STATUS.PATH_INTEGRITY_CHANGED,
  APPLE_READINESS_STATUS.INVENTORY_FAILURE,
  APPLE_READINESS_STATUS.UNSUPPORTED_HOST,
  APPLE_READINESS_STATUS.DISPOSABLE_RUNNER_MISSING,
  APPLE_READINESS_STATUS.NETWORK_ISOLATION_UNVERIFIED,
  APPLE_READINESS_STATUS.NETWORK_ISOLATION_MISSING,
  APPLE_READINESS_STATUS.TOOLCHAIN_MISSING,
  APPLE_READINESS_STATUS.TOOL_FINGERPRINT_MISSING,
  APPLE_READINESS_STATUS.TASK_ROOT_MISSING,
  APPLE_READINESS_STATUS.DEDICATED_KEYCHAIN_MISSING,
  APPLE_READINESS_STATUS.DEFAULT_KEYCHAIN_UNVERIFIED,
  APPLE_READINESS_STATUS.KEYCHAIN_CONTENT_IDENTITY_UNVERIFIED,
  APPLE_READINESS_STATUS.KEYCHAIN_DESCRIPTOR_BINDING_UNVERIFIED,
  APPLE_READINESS_STATUS.IDENTITY_OUTPUT_MALFORMED,
  APPLE_READINESS_STATUS.DEVELOPER_ID_APPLICATION_IDENTITY_MISSING,
  APPLE_READINESS_STATUS.IDENTITY_PUBLIC_CERTIFICATE_MISMATCH,
  APPLE_READINESS_STATUS.IDENTITY_CLASS_MISMATCH,
  APPLE_READINESS_STATUS.CERTIFICATE_REVOKED,
  APPLE_READINESS_STATUS.CERTIFICATE_NOT_YET_VALID,
  APPLE_READINESS_STATUS.CERTIFICATE_EXPIRED,
  APPLE_READINESS_STATUS.IDENTITY_AMBIGUOUS,
  APPLE_READINESS_STATUS.TEAM_ID_MISMATCH,
  APPLE_READINESS_STATUS.PROFILE_MALFORMED,
  APPLE_READINESS_STATUS.PROFILE_NOT_YET_VALID,
  APPLE_READINESS_STATUS.PROFILE_EXPIRED,
  APPLE_READINESS_STATUS.PROFILE_STALE,
  APPLE_READINESS_STATUS.PROFILE_AMBIGUOUS,
  APPLE_READINESS_STATUS.PROFILE_TEAM_MISMATCH,
  APPLE_READINESS_STATUS.PROFILE_APP_ID_MISMATCH,
  APPLE_READINESS_STATUS.PROFILE_ACCESS_GROUP_MISMATCH,
  APPLE_READINESS_STATUS.PROFILE_CERTIFICATE_MISMATCH,
  APPLE_READINESS_STATUS.PROFILE_DISTRIBUTION_MISMATCH,
  APPLE_READINESS_STATUS.READY,
]);

export class AppleReadinessError extends Error {
  constructor(code = APPLE_READINESS_STATUS.INVENTORY_FAILURE, message = 'invalid apple readiness input') {
    super(message);
    this.name = 'AppleReadinessError';
    this.code = Object.freeze(code);
  }
}

function fail(code = APPLE_READINESS_STATUS.INVENTORY_FAILURE, message) {
  throw new AppleReadinessError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDataObject(value) {
  if (!isPlainObject(value)) fail();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) fail();
  }
  return value;
}

function assertDataArray(value) {
  if (!Array.isArray(value)) fail();
  for (let index = 0; index < value.length; index += 1) if (!Object.prototype.hasOwnProperty.call(value, index)) fail();
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'length' && !/^\d+$/.test(String(key))) fail();
    if (key !== 'length') {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) fail();
    }
  }
  return value;
}

function cloneFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) fail();
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    assertDataArray(value);
    copy = value.map((item) => cloneFreeze(item, seen));
  } else {
    assertDataObject(value);
    copy = {};
    for (const key of Object.keys(value)) copy[key] = cloneFreeze(value[key], seen);
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function structuralBytes(value, seen = new WeakSet()) {
  if (value === null) return 4;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 2;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return String(value).length;
  if (typeof value !== 'object' || seen.has(value)) fail();
  seen.add(value);
  let total = Array.isArray(value) ? 2 : 2;
  if (Array.isArray(value)) {
    for (const item of value) total += structuralBytes(item, seen);
  } else {
    for (const key of Object.keys(value)) total += Buffer.byteLength(key, 'utf8') + structuralBytes(value[key], seen) + 3;
  }
  seen.delete(value);
  if (total > MAX_BYTES) fail();
  return total;
}

// A small syntax scanner is used before materialization so duplicate decoded
// object members can never be silently accepted by JSON.parse.
function parseStrictJson(source) {
  let offset = 0;
  const bad = () => fail();
  const whitespace = () => { while (offset < source.length && ' \t\r\n'.includes(source[offset])) offset += 1; };
  const parseString = () => {
    if (source[offset] !== '"') bad();
    const start = offset++;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) { offset += 1; try { return JSON.parse(source.slice(start, offset)); } catch { bad(); } }
      if (code < 0x20) bad();
      if (code === 0x5c) {
        offset += 1;
        if (offset >= source.length) bad();
        if (source[offset] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) bad();
          offset += 5;
        } else if ('"\\/bfnrt'.includes(source[offset])) offset += 1;
        else bad();
      } else offset += 1;
    }
    bad();
  };
  const parseValue = () => {
    whitespace();
    if (source[offset] === '"') return parseString();
    if (source[offset] === '{') return parseObject();
    if (source[offset] === '[') return parseArray();
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, offset)) { offset += token.length; return value; }
    }
    const match = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (match) { offset += match[0].length; const number = Number(match[0]); if (!Number.isFinite(number)) bad(); return number; }
    bad();
  };
  const parseObject = () => {
    offset += 1; whitespace(); const out = {}; const keys = new Set();
    if (source[offset] === '}') { offset += 1; return out; }
    while (offset < source.length) {
      const key = parseString();
      if (keys.has(key)) bad();
      keys.add(key); whitespace(); if (source[offset++] !== ':') bad();
      out[key] = parseValue(); whitespace();
      if (source[offset] === '}') { offset += 1; return out; }
      if (source[offset++] !== ',') bad(); whitespace();
    }
    bad();
  };
  const parseArray = () => {
    offset += 1; whitespace(); const out = [];
    if (source[offset] === ']') { offset += 1; return out; }
    while (offset < source.length) {
      out.push(parseValue()); whitespace();
      if (source[offset] === ']') { offset += 1; return out; }
      if (source[offset++] !== ',') bad(); whitespace();
    }
    bad();
  };
  whitespace(); const result = parseValue(); whitespace(); if (offset !== source.length) bad();
  return result;
}

function normalize(input) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) fail();
    const parsed = cloneFreeze(parseStrictJson(input));
    structuralBytes(parsed);
    return parsed;
  }
  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_BYTES) fail();
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail(); }
    return normalize(decoded);
  }
  const copied = cloneFreeze(input);
  structuralBytes(copied);
  return copied;
}

function exactKeys(value, required, optional = []) {
  assertDataObject(value);
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.has(key)) || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail();
}
function stringValue(value) { if (typeof value !== 'string' || value.length === 0) fail(); return value; }
function booleanValue(value) { if (typeof value !== 'boolean') fail(); return value; }
function stringArray(value) { assertDataArray(value); for (const item of value) stringValue(item); return value; }
function fingerprint(value, length) {
  stringValue(value);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) fail();
  return value;
}

function parseToolValue(value) {
  exactKeys(value, ['schema', 'arch', 'runner', 'network', 'clt', 'tools', 'command_output_valid', 'command_output_oversized', 'command_output_invalid_utf8', 'timed_out'], ['leak', 'metadata_leak', 'keychain_interaction', 'inventory_failure', 'trace_digest', 'tool_path_classes', 'tool_digests', 'tool_help_digests', 'fingerprint_complete', 'help_fingerprint_complete', 'identity_output_valid']);
  if (value.schema !== TOOL_SCHEMA) fail();
  stringValue(value.arch);
  exactKeys(value.runner, ['disposable', 'current_matches', 'non_admin', 'private_home', 'private_task', 'shared_account']);
  exactKeys(value.network, ['evidence', 'offline', 'scutil_ok', 'ipv4_ok', 'ipv6_ok', 'route_parsed', 'ipv4_external', 'ipv6_external', 'unverified']);
  exactKeys(value.clt, ['present', 'xcode_select']);
  exactKeys(value.tools, ['swiftc', 'codesign', 'security', 'notarytool', 'stapler', 'plutil']);
  for (const group of [value.runner, value.network, value.clt, value.tools]) for (const item of Object.values(group)) booleanValue(item);
  for (const key of ['command_output_valid', 'command_output_oversized', 'command_output_invalid_utf8', 'timed_out']) booleanValue(value[key]);
  for (const key of ['leak', 'metadata_leak']) if (key in value && value[key] !== null) stringValue(value[key]);
  for (const key of ['keychain_interaction', 'inventory_failure']) if (key in value) booleanValue(value[key]);
  for (const key of ['fingerprint_complete', 'help_fingerprint_complete']) if (key in value) booleanValue(value[key]);
  if ('identity_output_valid' in value) booleanValue(value.identity_output_valid);
  if ('trace_digest' in value) stringValue(value.trace_digest);
  if ('tool_path_classes' in value) {
    if (!isPlainObject(value.tool_path_classes)) fail();
    if (Object.keys(value.tool_path_classes).length > 0) exactKeys(value.tool_path_classes, [], TOOL_KEYS);
    for (const item of Object.values(value.tool_path_classes)) if (!['system', 'clt', 'xcode'].includes(item)) fail();
  }
  if ('tool_digests' in value) {
    if (!isPlainObject(value.tool_digests)) fail();
    if (Object.keys(value.tool_digests).length > 0) exactKeys(value.tool_digests, [], TOOL_KEYS);
    for (const item of Object.values(value.tool_digests)) fingerprint(item, 64);
  }
  if ('tool_help_digests' in value) {
    if (!isPlainObject(value.tool_help_digests)) fail();
    if (Object.keys(value.tool_help_digests).length > 0) exactKeys(value.tool_help_digests, [], HELP_TOOL_KEYS);
    for (const item of Object.values(value.tool_help_digests)) fingerprint(item, 64);
  }
  return value;
}

function parseIdentityEntries(entries) {
  stringArray([]); // keeps this parser's array boundary explicit
  assertDataArray(entries);
  return entries.map((entry) => {
    exactKeys(entry, ['team_id', 'common_name', 'issuer', 'fingerprint_sha256', 'fingerprint_sha1', 'not_before', 'not_after', 'revoked', 'policy_valid', 'private_key_usable', 'public_certificate_match'], ['raw_line', 'leak']);
  for (const key of ['team_id', 'common_name', 'issuer', 'not_before', 'not_after']) stringValue(entry[key]);
    fingerprint(entry.fingerprint_sha256, 64);
    fingerprint(entry.fingerprint_sha1, 40);
    for (const key of ['revoked', 'policy_valid', 'private_key_usable']) booleanValue(entry[key]);
    booleanValue(entry.public_certificate_match);
    for (const key of ['raw_line', 'leak']) if (key in entry && entry[key] !== null) stringValue(entry[key]);
    return entry;
  });
}

function parseProfileEntries(profiles) {
  assertDataArray(profiles);
  return profiles.map((entry) => {
    exactKeys(entry, ['name', 'uuid', 'creation', 'expiration', 'team_identifier', 'application_identifier_prefix', 'team_entitlement', 'application_identifier', 'bundle_id', 'platform', 'keychain_access_groups', 'developer_certificates', 'provisions_all_devices', 'get_task_allow', 'devices', 'macos', 'ios_application_identifier'], ['duplicate_keys', 'oversized', 'leak']);
    for (const key of ['name', 'uuid', 'creation', 'expiration', 'team_identifier', 'application_identifier_prefix', 'team_entitlement', 'application_identifier', 'bundle_id', 'platform']) stringValue(entry[key]);
    stringArray(entry.keychain_access_groups); stringArray(entry.developer_certificates); stringArray(entry.devices);
    for (const certificate of entry.developer_certificates) fingerprint(certificate, 64);
    for (const key of ['provisions_all_devices', 'get_task_allow', 'macos']) booleanValue(entry[key]);
    if (entry.ios_application_identifier !== null) stringValue(entry.ios_application_identifier);
    for (const key of ['duplicate_keys', 'oversized']) if (key in entry) booleanValue(entry[key]);
    if ('leak' in entry && entry.leak !== null) stringValue(entry.leak);
    return entry;
  });
}

export function parseToolInventoryV1(input) { return parseToolValue(normalize(input)); }
export function parseFindIdentityV1(input) {
  const value = normalize(input); exactKeys(value, ['schema', 'identities']);
  if (value.schema !== IDENTITY_SCHEMA) fail();
  parseIdentityEntries(value.identities); return value;
}
export function parsePublicCertificatesV1(input) {
  const value = normalize(input); exactKeys(value, ['schema', 'certificates']);
  if (value.schema !== CERTIFICATE_SCHEMA) fail();
  parseIdentityEntries(value.certificates); return value;
}
export function parseProvisioningProfileV1(input) {
  const value = normalize(input); exactKeys(value, ['schema', 'profiles']);
  if (value.schema !== PROFILE_SCHEMA) fail();
  parseProfileEntries(value.profiles); return value;
}

function nativeDigest(value, algorithm) { return createHash(algorithm).update(value).digest('hex'); }
function nativeSubjectField(subject, name) {
  const match = new RegExp(`(?:^|\\n|/|,\\s*)${name}=([^\\n/,]+)`).exec(subject);
  return match?.[1]?.trim() ?? '';
}

export function parseNativeFindIdentityV1(input) {
  const value = typeof input === 'string' ? input : input instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(input) : fail();
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_BYTES) fail();
  const lines = value.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (lines.some((line) => line.length === 0)) fail();
  if (lines.length === 0) fail();
  const summary = /^\s*([0-9]+) valid identities found$/u.exec(lines.at(-1));
  if (!summary) fail();
  const count = Number(summary[1]);
  const identityLines = lines.slice(0, -1);
  if (!Number.isSafeInteger(count) || count < 1 || identityLines.length !== count) fail();
  const identities = identityLines.map((line, index) => {
    const match = /^\s*([0-9]+)\)\s*([0-9A-Fa-f]{40})\s+"(Developer ID Application: [^:\r\n]+)"\s*$/u.exec(line);
    if (!match) fail();
    if (Number(match[1]) !== index + 1) fail();
    return { fingerprint_sha1: match[2].toLowerCase(), common_name: match[3], private_key_usable: true, policy_valid: true, public_certificate_match: false };
  });
  return Object.freeze({ schema: 'skillmap.m3-03.apple-signing-readiness.native-identity.v1', identities: Object.freeze(identities.map((item) => Object.freeze(item))) });
}

export function parseNativePublicCertificatesV1(input) {
  const value = typeof input === 'string' ? input : input instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(input) : fail();
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_BYTES) fail();
  const blocks = [...value.matchAll(/-----BEGIN CERTIFICATE-----\r?\n[0-9A-Za-z+/=\r\n]+-----END CERTIFICATE-----/gu)].map((match) => match[0]);
  if (blocks.length === 0 || blocks.join('\n') !== value.trim()) fail();
  const certificates = blocks.map((pem) => {
    let certificate;
    try { certificate = new X509Certificate(pem); } catch { fail(); }
    const der = certificate.raw;
    const common_name = nativeSubjectField(certificate.subject, 'CN');
    const team_id = nativeSubjectField(certificate.subject, 'OU');
    if (!/^Developer ID Application: [^:\r\n]+$/u.test(common_name) || !/^[A-Z0-9]{10}$/u.test(team_id)) fail();
    const issuer = nativeSubjectField(certificate.issuer, 'CN');
    if (issuer !== 'Apple Developer ID Certification Authority' || certificate.validFrom === '' || certificate.validTo === '') fail();
    return { team_id, common_name, issuer, fingerprint_sha256: nativeDigest(der, 'sha256'), fingerprint_sha1: nativeDigest(der, 'sha1'), not_before: new Date(certificate.validFrom).toISOString(), not_after: new Date(certificate.validTo).toISOString(), revoked: false, policy_valid: true, private_key_usable: true, public_certificate_match: false };
  });
  return Object.freeze({ schema: 'skillmap.m3-03.apple-signing-readiness.native-certificates.v1', certificates: Object.freeze(certificates.map((item) => Object.freeze(item))) });
}

export function parseNativeProfileJsonV1(input, role = 'launcher') {
  const value = normalize(input);
  if (!isPlainObject(value)) fail();
  const entitlements = value.Entitlements;
  if (!isPlainObject(entitlements)) fail();
  for (const key of ['application-identifier', 'com.apple.application-identifier', 'com.apple.developer.team-identifier', 'keychain-access-groups']) {
    if (!Object.prototype.hasOwnProperty.call(entitlements, key)) fail();
  }
  const team = Array.isArray(value.TeamIdentifier) && value.TeamIdentifier.length === 1 ? value.TeamIdentifier[0] : '';
  const prefix = Array.isArray(value.ApplicationIdentifierPrefix) && value.ApplicationIdentifierPrefix.length === 1 ? value.ApplicationIdentifierPrefix[0] : '';
  const appId = entitlements['application-identifier'];
  const macAppId = entitlements['com.apple.application-identifier'];
  const teamEntitlement = entitlements['com.apple.developer.team-identifier'];
  const bundleId = typeof appId === 'string' && appId.startsWith(`${team}.`) ? appId.slice(team.length + 1) : '';
  const certificateValues = value.DeveloperCertificates;
  if (!Array.isArray(certificateValues) || certificateValues.length === 0) fail();
  const developer_certificates = certificateValues.map((encoded) => {
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) fail();
    let der; try { der = Buffer.from(encoded, 'base64'); } catch { fail(); }
    if (der.length === 0 || der.toString('base64') !== encoded) fail();
    return nativeDigest(der, 'sha256');
  });
  if (!/^[A-Z0-9]{10}$/.test(team) || prefix !== team || !/^[^*\r\n]+$/.test(bundleId) || typeof macAppId !== 'string' || !Array.isArray(value.Platform) || value.Platform.length !== 1 || typeof value.Name !== 'string' || typeof value.UUID !== 'string' || typeof value.CreationDate !== 'string' || typeof value.ExpirationDate !== 'string') fail();
  const creation = new Date(value.CreationDate); const expiration = new Date(value.ExpirationDate);
  if (Number.isNaN(creation.valueOf()) || Number.isNaN(expiration.valueOf())) fail();
  const groups = entitlements['keychain-access-groups'];
  if (!Array.isArray(groups) || groups.some((item) => typeof item !== 'string')) fail();
  if (typeof appId !== 'string' || typeof macAppId !== 'string' || typeof teamEntitlement !== 'string') fail();
  if (Object.prototype.hasOwnProperty.call(entitlements, 'get-task-allow') && typeof entitlements['get-task-allow'] !== 'boolean') fail();
  const getTaskAllow = entitlements['get-task-allow'] === true;
  return Object.freeze({ name: value.Name, uuid: value.UUID, creation: creation.toISOString(), expiration: expiration.toISOString(), team_identifier: team, application_identifier_prefix: prefix, team_entitlement: teamEntitlement, application_identifier: macAppId, bundle_id: bundleId, platform: value.Platform[0], keychain_access_groups: groups, developer_certificates, provisions_all_devices: value.ProvisionsAllDevices === true, get_task_allow: getTaskAllow, devices: Array.isArray(value.ProvisionedDevices) ? value.ProvisionedDevices : [], macos: value.Platform[0] === 'MacOS', ios_application_identifier: null });
}

function check(check_id, pass, failure_status) {
  return { check_id, outcome: pass ? 'pass' : 'fail', status: pass ? null : failure_status, blocked_by: null, evidence: {} };
}
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function digest(value, domain) { return createHash('sha256').update(`${domain}\0${value}`, 'utf8').digest('hex'); }
function leakText(value) { return typeof value === 'string' && /(private[ _-]?key|password|token|binary[ _-]?canary|canary)/i.test(value); }

function evaluateInputCopy(input) {
  const value = normalize(input);
  exactKeys(value, ['tool', 'keychain', 'identities', 'profiles', 'request'], ['candidate_profiles']);
  exactKeys(value.keychain, ['dedicated', 'non_symlink', 'owner_only', 'under_task_root', 'not_default', 'not_login'], ['task_root_verified', 'default_verified', 'content_identity_verified', 'descriptor_binding_verified']);
  exactKeys(value.request, ['team_id', 'profile_roles']);
  // Shape checks for fields which can be represented as BLOCKED_PROFILE_MALFORMED
  // are performed in the evaluator, but unknown fields and prototype tricks are
  // rejected here before any policy decision is made.
  return value;
}

export function evaluateAppleSigningReadinessV1(input, { now = new Date() } = {}) {
  let value;
  let inventoryFailure = false;
  let profileMalformed = false;
  try { value = evaluateInputCopy(input); } catch { inventoryFailure = true; value = { tool: {}, keychain: {}, identities: [], profiles: [], request: {} }; }
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf())) fail();

  let tool = value.tool;
  try { tool = parseToolValue(tool); } catch { inventoryFailure = true; tool = {}; }
  let keychain = value.keychain;
  try {
    exactKeys(keychain, ['dedicated', 'non_symlink', 'owner_only', 'under_task_root', 'not_default', 'not_login'], ['task_root_verified', 'default_verified', 'content_identity_verified', 'descriptor_binding_verified']);
    for (const item of Object.values(keychain)) booleanValue(item);
  } catch { inventoryFailure = true; keychain = {}; }
  let identities = value.identities;
  try { parseIdentityEntries(identities); } catch { inventoryFailure = true; identities = []; }
  let profiles = value.profiles;
  try { parseProfileEntries(profiles); } catch { profileMalformed = true; profiles = Array.isArray(profiles) ? profiles : []; }
  if (profiles.some((profile) => profile.duplicate_keys === true || profile.oversized === true)) profileMalformed = true;
  let candidateProfiles = value.candidate_profiles ?? [];
  try { parseProfileEntries(candidateProfiles); } catch { profileMalformed = true; candidateProfiles = Array.isArray(candidateProfiles) ? candidateProfiles : []; }
  if (candidateProfiles.some((profile) => profile.duplicate_keys === true || profile.oversized === true)) profileMalformed = true;
  let request = value.request;
  try { exactKeys(request, ['team_id', 'profile_roles']); stringValue(request.team_id); stringArray(request.profile_roles); } catch { inventoryFailure = true; request = {}; }

  const requestTeam = request.team_id;
  const usable = identities.filter((item) => item.private_key_usable === true && item.policy_valid === true);
  const selected = usable.length === 1 ? usable[0] : null;
  const teams = new Set(identities.map((item) => item.team_id).filter(Boolean));
  const typeValid = usable.length > 0 && usable.every((item) => /^Developer ID Application: [^:\r\n]+$/.test(item.common_name) && item.issuer === 'Apple Developer ID Certification Authority');
  const teamValid = usable.length > 0 && usable.every((item) => /^[A-Z0-9]{10}$/.test(item.team_id)) && (usable.length !== 1 || usable[0].team_id === requestTeam);
  const dateValid = Boolean(selected && validDate(selected.not_before) && validDate(selected.not_after));
  const identityTime = usable.length !== 1 || (dateValid && Date.parse(selected.not_before) <= instant && instant < Date.parse(selected.not_after));
  const identityTimeStatus = !dateValid || Date.parse(selected?.not_before ?? '') > instant
    ? APPLE_READINESS_STATUS.CERTIFICATE_NOT_YET_VALID : APPLE_READINESS_STATUS.CERTIFICATE_EXPIRED;

  const profileDateValid = profiles.every((p) => validDate(p.creation) && validDate(p.expiration));
  const profileFuture = profiles.some((p) => validDate(p.creation) && Date.parse(p.creation) > instant) || candidateProfiles.some((p) => validDate(p.creation) && Date.parse(p.creation) > instant);
  const profileExpired = profiles.some((p) => validDate(p.expiration) && Date.parse(p.expiration) <= instant);
  const profileCurrent = !profileMalformed && profiles.length === 2 && profileDateValid
    && profiles.every((p) => Date.parse(p.creation) <= instant && instant < Date.parse(p.expiration));
  const profileStale = profileCurrent && profiles.some((selectedProfile) => candidateProfiles.some((candidate) => candidate.bundle_id === selectedProfile.bundle_id && validDate(candidate.creation) && Date.parse(candidate.creation) > Date.parse(selectedProfile.creation)));
  const profileAmbiguous = profileCurrent && profiles.some((selectedProfile) => {
    const candidates = [selectedProfile, ...candidateProfiles].filter((candidate) => candidate.bundle_id === selectedProfile.bundle_id && validDate(candidate.creation));
    const newest = candidates.map((candidate) => candidate.creation).sort().at(-1);
    return candidates.filter((candidate) => candidate.creation === newest).length > 1;
  });
  const expectedBundles = [APPLE_READINESS_EXPECTED.launcher_bundle_id, APPLE_READINESS_EXPECTED.helper_bundle_id];
  const appIdsValid = !profileMalformed && profiles.length === 2 && new Set(profiles.map((p) => p.bundle_id)).size === 2
    && expectedBundles.every((bundle) => profiles.some((p) => p.bundle_id === bundle))
    && profiles.every((p) => !p.bundle_id.includes('*') && p.application_identifier === `${requestTeam}.${p.bundle_id}` && p.macos === true);
  const teamsValid = !profileMalformed && profiles.length === 2 && profiles.every((p) => p.team_identifier === requestTeam && p.application_identifier_prefix === requestTeam && p.team_entitlement === requestTeam);
  const allowedGroups = new Set([`${requestTeam}.${APPLE_READINESS_EXPECTED.access_group_suffix}`, `${requestTeam}.*`]);
  const groupsValid = !profileMalformed && profiles.length === 2 && profiles.every((p) => {
    const groups = p.keychain_access_groups;
    return groups.length > 0 && new Set(groups).size === groups.length && groups.every((group) => allowedGroups.has(group));
  });
  const certValid = !profileMalformed && Boolean(selected) && profiles.length === 2 && profiles.every((p) => p.developer_certificates.includes(selected.fingerprint_sha256));
  const distributionValid = !profileMalformed && profiles.length === 2 && profiles.every((p) => p.provisions_all_devices === true && p.get_task_allow === false && p.devices.length === 0);
  const privateLeak = leakText(tool?.leak) || profiles.some((p) => leakText(p.leak));
  const metadataLeak = typeof tool?.metadata_leak === 'string' && tool.metadata_leak.length > 0;
  const commandFailure = Boolean(tool?.command_output_valid === false || tool?.command_output_oversized || tool?.command_output_invalid_utf8 || tool?.timed_out || tool?.inventory_failure);
  const interactionRisk = Boolean(tool?.keychain_interaction);

  const routeEvidence = Boolean(tool.network?.evidence && tool.network?.scutil_ok !== false && tool.network?.ipv4_ok !== false && tool.network?.ipv6_ok !== false && tool.network?.route_parsed !== false);
  const routeMalformed = Boolean(tool.network?.unverified || (tool.network?.evidence && (tool.network?.scutil_ok === false || tool.network?.ipv4_ok === false || tool.network?.ipv6_ok === false || tool.network?.route_parsed === false)));
  const offlineStatus = routeMalformed ? APPLE_READINESS_STATUS.NETWORK_ISOLATION_UNVERIFIED : APPLE_READINESS_STATUS.NETWORK_ISOLATION_MISSING;
  const toolFingerprints = Boolean(tool.fingerprint_complete !== false && tool.help_fingerprint_complete !== false
    && TOOL_KEYS.every((key) => ['system', 'clt', 'xcode'].includes(tool.tool_path_classes?.[key]))
    && TOOL_KEYS.every((key) => /^[0-9a-f]{64}$/.test(tool.tool_digests?.[key] ?? ''))
    && HELP_TOOL_KEYS.every((key) => /^[0-9a-f]{64}$/.test(tool.tool_help_digests?.[key] ?? '')));
  const checks = [
    check('host.arch', tool.arch === APPLE_READINESS_EXPECTED.architecture, APPLE_READINESS_STATUS.UNSUPPORTED_HOST),
    check('runner.disposable', Boolean(tool.runner?.disposable && tool.runner.current_matches && tool.runner.non_admin && tool.runner.private_home && tool.runner.private_task && !tool.runner.shared_account), APPLE_READINESS_STATUS.DISPOSABLE_RUNNER_MISSING),
    check('runner.offline', Boolean(routeEvidence && tool.network.offline), offlineStatus),
    check('tools.clt', Boolean(tool.clt?.present && tool.clt.xcode_select), APPLE_READINESS_STATUS.TOOLCHAIN_MISSING),
    check('tools.apple', Boolean(tool.tools && Object.values(tool.tools).every(Boolean)) && !commandFailure && toolFingerprints, !toolFingerprints ? APPLE_READINESS_STATUS.TOOL_FINGERPRINT_MISSING : commandFailure ? APPLE_READINESS_STATUS.INVENTORY_FAILURE : APPLE_READINESS_STATUS.TOOLCHAIN_MISSING),
    check('paths.task-root', Boolean(keychain.task_root_verified ?? keychain.under_task_root), APPLE_READINESS_STATUS.TASK_ROOT_MISSING),
    check('keychain.dedicated', Boolean(keychain.dedicated && keychain.non_symlink && keychain.owner_only && keychain.under_task_root && keychain.not_default && keychain.not_login), APPLE_READINESS_STATUS.DEDICATED_KEYCHAIN_MISSING),
    check('keychain.default', Boolean(keychain.default_verified ?? keychain.not_default), APPLE_READINESS_STATUS.DEFAULT_KEYCHAIN_UNVERIFIED),
    check('keychain.content-identity', keychain.content_identity_verified === true, APPLE_READINESS_STATUS.KEYCHAIN_CONTENT_IDENTITY_UNVERIFIED),
    check('keychain.descriptor-binding', keychain.descriptor_binding_verified === true, APPLE_READINESS_STATUS.KEYCHAIN_DESCRIPTOR_BINDING_UNVERIFIED),
    check('identity.present', !inventoryFailure && usable.length > 0, APPLE_READINESS_STATUS.DEVELOPER_ID_APPLICATION_IDENTITY_MISSING),
    check('identity.public-certificate', !inventoryFailure && usable.length > 0 && usable.every((item) => item.public_certificate_match === true), APPLE_READINESS_STATUS.IDENTITY_PUBLIC_CERTIFICATE_MISMATCH),
    check('identity.output', !inventoryFailure && tool.identity_output_valid === true, APPLE_READINESS_STATUS.IDENTITY_OUTPUT_MALFORMED),
    check('identity.type', !inventoryFailure && typeValid, APPLE_READINESS_STATUS.IDENTITY_CLASS_MISMATCH),
    check('identity.team', !inventoryFailure && teamValid, APPLE_READINESS_STATUS.TEAM_ID_MISMATCH),
    check('identity.unique', !inventoryFailure && usable.length === 1 && teams.size <= 1, APPLE_READINESS_STATUS.IDENTITY_AMBIGUOUS),
    check('identity.time', !inventoryFailure && identityTime, identityTimeStatus),
    check('identity.revocation', !inventoryFailure && usable.every((item) => item.revoked !== true), APPLE_READINESS_STATUS.CERTIFICATE_REVOKED),
    check('profile.decode', !inventoryFailure && !profileMalformed, APPLE_READINESS_STATUS.PROFILE_MALFORMED),
    check('profile.current', !inventoryFailure && !profileMalformed && profileCurrent && !profileFuture && !profileExpired && !profileStale && !profileAmbiguous,
      profileFuture ? APPLE_READINESS_STATUS.PROFILE_NOT_YET_VALID : profileExpired ? APPLE_READINESS_STATUS.PROFILE_EXPIRED : profileStale ? APPLE_READINESS_STATUS.PROFILE_STALE : profileAmbiguous ? APPLE_READINESS_STATUS.PROFILE_AMBIGUOUS : APPLE_READINESS_STATUS.PROFILE_MALFORMED),
    check('profile.team', !inventoryFailure && teamsValid, APPLE_READINESS_STATUS.PROFILE_TEAM_MISMATCH),
    check('profile.app-id', !inventoryFailure && appIdsValid, APPLE_READINESS_STATUS.PROFILE_APP_ID_MISMATCH),
    check('profile.keychain-group', !inventoryFailure && groupsValid, APPLE_READINESS_STATUS.PROFILE_ACCESS_GROUP_MISMATCH),
    check('profile.certificate', !inventoryFailure && certValid, APPLE_READINESS_STATUS.PROFILE_CERTIFICATE_MISMATCH),
    check('profile.distribution', !inventoryFailure && distributionValid, APPLE_READINESS_STATUS.PROFILE_DISTRIBUTION_MISMATCH),
    check('redaction.private-key', !privateLeak, APPLE_READINESS_STATUS.PRIVATE_KEY_LEAKAGE),
    check('redaction.metadata', !metadataLeak, APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED),
  ];
  if (interactionRisk) { const item = checks.find((candidate) => candidate.check_id === 'keychain.dedicated'); item.outcome = 'fail'; item.status = APPLE_READINESS_STATUS.KEYCHAIN_INTERACTION_RISK; }
  if (inventoryFailure) { const item = checks.find((candidate) => candidate.check_id === 'tools.apple'); item.outcome = 'fail'; item.status = APPLE_READINESS_STATUS.INVENTORY_FAILURE; }
  checks.sort((a, b) => a.check_id.localeCompare(b.check_id));
  const failed = new Set(checks.filter((item) => item.outcome === 'fail').map((item) => item.status));
  const status = PRECEDENCE.find((candidate) => failed.has(candidate)) ?? APPLE_READINESS_STATUS.READY;
  return Object.freeze({
    status,
    checks: Object.freeze(checks.map((item) => Object.freeze(item))),
    safe_summary: Object.freeze({
      architecture: typeof tool.arch === 'string' ? tool.arch : 'unknown',
      profile_count: profiles.length,
      identity_count: identities.length,
      online_revocation_checked: false,
      notarization_checked: false,
      bundle_suffixes: expectedBundles.map((bundle) => bundle.replace('dev.skillmap.connector.', '')),
      access_group_suffix: APPLE_READINESS_EXPECTED.access_group_suffix,
      team_digest: typeof requestTeam === 'string' ? digest(requestTeam, 'skillmap.apple.team.v1') : null,
      tool_path_classes: tool.tool_path_classes ?? {},
      tool_digests: tool.tool_digests ?? {},
      tool_help_digests: tool.tool_help_digests ?? {},
    }),
  });
}

const NON_CLAIMS = Object.freeze([
  'no signing or private-key operation was performed',
  'no identity, certificate, profile, keychain, or Apple account was changed',
  'no Secure Enclave or generic-password item was created/read/changed/deleted',
  'no notarization, Gatekeeper, online revocation, portal, browser, provider, or network check was performed',
  'no product, native helper, manifest, lockfile, migration, ledger, Git history, push, deploy, or live system was changed',
  'held descriptors and pre/post identity checks fail closed on path replacement but are not an atomic kernel transaction',
  'READY means ready to attempt the separately authorized proof, not M3.01/M3.03 acceptance',
]);

const CHECK_IDS = Object.freeze([
  'host.arch', 'runner.disposable', 'runner.offline', 'tools.clt', 'tools.apple', 'paths.task-root', 'keychain.dedicated', 'keychain.default', 'keychain.content-identity', 'keychain.descriptor-binding',
  'identity.present', 'identity.public-certificate', 'identity.output', 'identity.type', 'identity.team', 'identity.unique', 'identity.time', 'identity.revocation',
  'profile.decode', 'profile.current', 'profile.team', 'profile.app-id', 'profile.keychain-group', 'profile.certificate', 'profile.distribution',
  'redaction.private-key', 'redaction.metadata',
]);
const CHECK_IDS_LEXICAL = Object.freeze([...CHECK_IDS].sort((a, b) => a.localeCompare(b)));
const SAFE_ARCHITECTURES = new Set(['arm64', 'x86_64', 'unknown']);
const SAFE_ROUTE_MODES = new Set(['fixture', 'tool-only', 'inventory', 'unknown']);
const SAFE_INTEGRITY_STATES = new Set(['not_checked', 'validated locally']);

function safeChecks(input) {
  if (!Array.isArray(input) || input.length !== CHECK_IDS.length) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  const byId = new Map();
  for (const item of input) {
    if (!isPlainObject(item)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
    exactKeys(item, ['check_id', 'outcome', 'status', 'blocked_by', 'evidence']);
    if (!CHECK_IDS.includes(item.check_id) || !['pass', 'fail', 'not_run'].includes(item.outcome) || byId.has(item.check_id) || !isPlainObject(item.evidence)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
    if (item.outcome === 'fail') {
      if (!Object.values(APPLE_READINESS_STATUS).includes(item.status) || item.status === APPLE_READINESS_STATUS.READY) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
    } else if (item.status !== null || (item.outcome === 'pass' && item.blocked_by !== null) || (item.outcome === 'not_run' && (typeof item.blocked_by !== 'string' || !CHECK_IDS.includes(item.blocked_by)))) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
    byId.set(item.check_id, { check_id: item.check_id, outcome: item.outcome, status: item.outcome === 'fail' ? item.status : null, blocked_by: item.outcome === 'not_run' ? item.blocked_by : null, evidence: {} });
  }
  if (byId.size !== CHECK_IDS.length) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  return CHECK_IDS_LEXICAL.map((id) => byId.get(id));
}

function recomputeStatus(checks) {
  const failed = new Set(checks.filter((item) => item.outcome === 'fail').map((item) => item.status));
  return PRECEDENCE.find((candidate) => failed.has(candidate)) ?? APPLE_READINESS_STATUS.READY;
}

function safeSummary(input) {
  if (!isPlainObject(input)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  exactKeys(input, ['architecture', 'profile_count', 'identity_count', 'online_revocation_checked', 'notarization_checked', 'bundle_suffixes', 'access_group_suffix', 'team_digest', 'tool_path_classes', 'tool_digests', 'tool_help_digests']);
  if (!SAFE_ARCHITECTURES.has(input.architecture) || !Number.isSafeInteger(input.profile_count) || input.profile_count < 0 || input.profile_count > 8 || !Number.isSafeInteger(input.identity_count) || input.identity_count < 0 || input.identity_count > 8 || typeof input.online_revocation_checked !== 'boolean' || typeof input.notarization_checked !== 'boolean') fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (!Array.isArray(input.bundle_suffixes) || input.bundle_suffixes.length !== 2 || input.bundle_suffixes[0] !== 'launcher' || input.bundle_suffixes[1] !== 'keychain-helper' || input.access_group_suffix !== APPLE_READINESS_EXPECTED.access_group_suffix) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (input.team_digest !== null && !/^[0-9a-f]{64}$/.test(input.team_digest)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (!isPlainObject(input.tool_path_classes) || !isPlainObject(input.tool_digests)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (Object.keys(input.tool_path_classes).length > 0) exactKeys(input.tool_path_classes, ['swiftc', 'codesign', 'security', 'notarytool', 'stapler', 'plutil']);
  if (Object.keys(input.tool_digests).length > 0) exactKeys(input.tool_digests, ['swiftc', 'codesign', 'security', 'notarytool', 'stapler', 'plutil']);
  if (!isPlainObject(input.tool_help_digests)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (Object.keys(input.tool_help_digests).length > 0) exactKeys(input.tool_help_digests, HELP_TOOL_KEYS);
  for (const value of Object.values(input.tool_path_classes)) if (!['system', 'clt', 'xcode'].includes(value)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  for (const value of Object.values(input.tool_digests)) if (!/^[0-9a-f]{64}$/.test(value)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  for (const value of Object.values(input.tool_help_digests)) if (!/^[0-9a-f]{64}$/.test(value)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  return {
    architecture: input.architecture,
    profile_count: input.profile_count,
    identity_count: input.identity_count,
    online_revocation_checked: input.online_revocation_checked,
    notarization_checked: input.notarization_checked,
    bundle_suffixes: ['launcher', 'keychain-helper'],
    access_group_suffix: APPLE_READINESS_EXPECTED.access_group_suffix,
    team_digest: input.team_digest,
    tool_path_classes: { ...input.tool_path_classes },
    tool_digests: { ...input.tool_digests },
    tool_help_digests: { ...input.tool_help_digests },
  };
}

export function redactAppleSigningReadinessReceiptV1({ result, candidate = {}, observed_at, worktree_integrity = {}, route = {} }) {
  if (!result || !Object.values(APPLE_READINESS_STATUS).includes(result.status)) fail();
  const checks = safeChecks(result.checks);
  const recomputed = recomputeStatus(checks);
  const failedIds = new Set(checks.filter((item) => item.outcome === 'fail').map((item) => item.check_id));
  if (checks.some((item) => item.outcome === 'not_run' && !failedIds.has(item.blocked_by))) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (recomputed === APPLE_READINESS_STATUS.READY && checks.some((item) => item.outcome !== 'pass')) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (result.status !== recomputed) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  const inventory = safeSummary(result.safe_summary);
  if (typeof observed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(observed_at)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  const integrityStatus = worktree_integrity && SAFE_INTEGRITY_STATES.has(worktree_integrity.status) ? worktree_integrity.status : 'not_checked';
  const mode = route && SAFE_ROUTE_MODES.has(route.mode) ? route.mode : 'unknown';
  const receipt = {
    schema: APPLE_READINESS_SCHEMA,
    status: result.status,
    candidate: { name: 'candidate' },
    observed_at,
    checks,
    redacted_inventory: inventory,
    worktree_integrity: { status: integrityStatus },
    non_claims: [...NON_CLAIMS],
    route: { mode, evidence: 'validated locally' },
  };
  assertNoSensitiveAppleInventoryV1(JSON.stringify(receipt), []);
  return Object.freeze(receipt);
}

export function assertNoSensitiveAppleInventoryV1(serialized, canaries = []) {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  const values = Array.isArray(canaries) ? canaries : Object.values(canaries ?? {}).flat();
  for (const canary of values) if (typeof canary === 'string' && canary.length > 3 && serialized.includes(canary)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  if (/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|BEGIN PRIVATE KEY|password\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}|(?:home|user|keychain|profile)[-_ ]?path\s*[:=]/i.test(serialized)) fail(APPLE_READINESS_STATUS.OUTPUT_REDACTION_FAILED);
  return true;
}
