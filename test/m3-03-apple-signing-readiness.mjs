import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  APPLE_READINESS_SCHEMA,
  APPLE_READINESS_STATUS,
  APPLE_READINESS_EXPECTED,
  AppleReadinessError,
  parseToolInventoryV1,
  parseFindIdentityV1,
  parseNativeFindIdentityV1,
  parseNativePublicCertificatesV1,
  parseNativeProfileJsonV1,
  parsePublicCertificatesV1,
  parseProvisioningProfileV1,
  evaluateAppleSigningReadinessV1,
  redactAppleSigningReadinessReceiptV1,
  assertNoSensitiveAppleInventoryV1,
} from './support/m3-03-apple-signing-readiness.mjs';
import { SAFE_COMMANDS, collectInventory, collectToolOnly, readRequest } from '../scripts/m3-03-apple-signing-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/m3-03-apple-signing-readiness/cases.json'), 'utf8'));
const now = new Date(fixture.fixed_now);

function clone(value) { return structuredClone(value); }
function setPath(value, path, next) {
  const parts = path.split('.');
  let target = value;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = clone(next);
}
function inputFor(entry) {
  const value = clone(fixture.base);
  for (const mutation of entry.mutations ?? []) setPath(value, mutation.path, mutation.value);
  return value;
}

test('public schema and status vocabulary are frozen and ordered', () => {
  assert.equal(APPLE_READINESS_SCHEMA, 'skillmap.m3-03.apple-signing-readiness.v1');
  assert.equal(Object.isFrozen(APPLE_READINESS_STATUS), true);
  assert.equal(Object.isFrozen(APPLE_READINESS_EXPECTED), true);
  assert.equal(APPLE_READINESS_STATUS.READY, 'READY_FOR_AUTHORIZED_SIGNING_PROOF');
  assert.equal(APPLE_READINESS_EXPECTED.launcher_bundle_id, 'dev.skillmap.connector.launcher');
  assert.equal(APPLE_READINESS_EXPECTED.helper_bundle_id, 'dev.skillmap.connector.keychain-helper');
  assert.equal(APPLE_READINESS_EXPECTED.access_group_suffix, 'dev.skillmap.connector.credentials');
});

test('all fixture cases evaluate to their explicit expected status with complete sorted checks', () => {
  for (const entry of fixture.cases) {
    const result = evaluateAppleSigningReadinessV1(inputFor(entry), { now });
    assert.equal(result.status, entry.expected_status, entry.id);
    assert.deepEqual(result.checks.map((check) => check.check_id), [...result.checks].map((check) => check.check_id).sort(), entry.id);
    assert.equal(result.checks.length, 27, entry.id);
  }
});

test('parsers reject inherited objects, getters, unknown fields, duplicate JSON, invalid UTF-8, and oversized input', () => {
  const base = inputFor(fixture.cases[0]);
  assert.doesNotThrow(() => parseToolInventoryV1(base.tool));
  assert.doesNotThrow(() => parseFindIdentityV1({ schema: 'skillmap.m3-03.apple-signing-readiness.identity.v1', identities: base.identities }));
  assert.doesNotThrow(() => parsePublicCertificatesV1({ schema: 'skillmap.m3-03.apple-signing-readiness.certificates.v1', certificates: base.identities }));
  assert.doesNotThrow(() => parseProvisioningProfileV1({ schema: 'skillmap.m3-03.apple-signing-readiness.profile.v1', profiles: base.profiles }));
  for (const parser of [parseToolInventoryV1, parseFindIdentityV1, parsePublicCertificatesV1, parseProvisioningProfileV1]) {
    const inherited = Object.create({ schema: 'bad' });
    assert.throws(() => parser(inherited), AppleReadinessError);
    const getter = {};
    Object.defineProperty(getter, 'schema', { get() { throw new Error('getter accessed'); } });
    assert.throws(() => parser(getter), AppleReadinessError);
    assert.throws(() => parser(new Uint8Array(262145)), AppleReadinessError);
    assert.throws(() => parser(new Uint8Array([0xff, 0xfe])), AppleReadinessError);
  }
  assert.throws(() => parseToolInventoryV1('{"schema":"skillmap.m3-03.apple-signing-readiness.tool.v1","schema":"x"}'), AppleReadinessError);
  assert.throws(() => parseToolInventoryV1(JSON.stringify({ ...base.tool, unknown: true })), AppleReadinessError);
  const parsed = parseToolInventoryV1(base.tool);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.runner), true);
});

test('parsers return copies and do not observe post-parse mutation', () => {
  const base = inputFor(fixture.cases[0]);
  const parsed = parseProvisioningProfileV1({ schema: 'skillmap.m3-03.apple-signing-readiness.profile.v1', profiles: base.profiles });
  base.profiles[0].bundle_id = 'mutated';
  assert.equal(parsed.profiles[0].bundle_id, 'dev.skillmap.connector.launcher');
  assert.equal(Object.isFrozen(parsed.profiles[0]), true);
});

test('native Apple-shaped adapters reject truncation/wrappers and canonicalize identity/profile output', () => {
  const identity = parseNativeFindIdentityV1('  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Fixture Connector"\n     1 valid identities found\n');
  assert.equal(identity.identities[0].fingerprint_sha1, 'abcdef0123456789abcdef0123456789abcdef01');
  assert.throws(() => parseNativeFindIdentityV1('{"schema":"synthetic"}'), AppleReadinessError);
  assert.throws(() => parseNativeFindIdentityV1('  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Fixture Connector"\n'), AppleReadinessError);
  assert.throws(() => parseNativeFindIdentityV1('  2) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Fixture Connector"\n     1 valid identities found\n'), AppleReadinessError);
  assert.throws(() => parseNativeFindIdentityV1('  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Fixture Connector"\n     2 valid identities found\n'), AppleReadinessError);
  const profile = parseNativeProfileJsonV1({ Name: 'fixture', UUID: '11111111-1111-1111-1111-111111111111', CreationDate: '2026-01-01T00:00:00Z', ExpirationDate: '2027-01-01T00:00:00Z', TeamIdentifier: ['ABCDE12345'], ApplicationIdentifierPrefix: ['ABCDE12345'], Platform: ['MacOS'], ProvisionsAllDevices: true, DeveloperCertificates: ['AQ=='], Entitlements: { 'application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.developer.team-identifier': 'ABCDE12345', 'keychain-access-groups': ['ABCDE12345.dev.skillmap.connector.credentials'], 'get-task-allow': false } });
  assert.equal(profile.bundle_id, 'dev.skillmap.connector.launcher');
  const absentGetTaskAllow = structuredClone(profile);
  delete absentGetTaskAllow.get_task_allow;
  const nativeWithoutGetTaskAllow = parseNativeProfileJsonV1({ Name: 'fixture', UUID: '11111111-1111-1111-1111-111111111111', CreationDate: '2026-01-01T00:00:00Z', ExpirationDate: '2027-01-01T00:00:00Z', TeamIdentifier: ['ABCDE12345'], ApplicationIdentifierPrefix: ['ABCDE12345'], Platform: ['MacOS'], ProvisionsAllDevices: true, DeveloperCertificates: ['AQ=='], Entitlements: { 'application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.developer.team-identifier': 'ABCDE12345', 'keychain-access-groups': ['ABCDE12345.dev.skillmap.connector.credentials'] } });
  assert.equal(nativeWithoutGetTaskAllow.get_task_allow, false);
  assert.throws(() => parseNativeProfileJsonV1({ Name: 'fixture', UUID: '11111111-1111-1111-1111-111111111111', CreationDate: '2026-01-01T00:00:00Z', ExpirationDate: '2027-01-01T00:00:00Z', TeamIdentifier: ['ABCDE12345'], ApplicationIdentifierPrefix: ['ABCDE12345'], Platform: ['MacOS'], ProvisionsAllDevices: true, DeveloperCertificates: ['AQ=='], Entitlements: { 'application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.developer.team-identifier': 'ABCDE12345', 'keychain-access-groups': ['ABCDE12345.dev.skillmap.connector.credentials'], 'get-task-allow': 'false' } }), AppleReadinessError);
  for (const missing of ['application-identifier', 'com.apple.application-identifier', 'com.apple.developer.team-identifier', 'keychain-access-groups']) {
    const malformed = { Name: 'fixture', UUID: '11111111-1111-1111-1111-111111111111', CreationDate: '2026-01-01T00:00:00Z', ExpirationDate: '2027-01-01T00:00:00Z', TeamIdentifier: ['ABCDE12345'], ApplicationIdentifierPrefix: ['ABCDE12345'], Platform: ['MacOS'], ProvisionsAllDevices: true, DeveloperCertificates: ['AQ=='], Entitlements: { 'application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.application-identifier': 'ABCDE12345.dev.skillmap.connector.launcher', 'com.apple.developer.team-identifier': 'ABCDE12345', 'keychain-access-groups': ['ABCDE12345.dev.skillmap.connector.credentials'] } };
    delete malformed.Entitlements[missing];
    assert.throws(() => parseNativeProfileJsonV1(malformed), AppleReadinessError);
  }
  assert.throws(() => parseNativeProfileJsonV1({ Entitlements: {} }), AppleReadinessError);
  assert.throws(() => parseNativePublicCertificatesV1('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\ntrailing'), AppleReadinessError);
});

test('redaction removes raw fixture identifiers and canaries while retaining safe suffixes', () => {
  const result = evaluateAppleSigningReadinessV1(inputFor(fixture.cases[0]), { now });
  const receipt = redactAppleSigningReadinessReceiptV1({ result, candidate: { name: 'fixture' }, observed_at: `${fixture.fixed_now.slice(0, -1)}.000Z`, route: { mode: 'fixture' } });
  const serialized = JSON.stringify(receipt);
  assertNoSensitiveAppleInventoryV1(serialized, fixture.canaries);
  assert.doesNotMatch(serialized, /ABCDE12345|aaaaaaaaaaaaaaaa|11111111-1111/);
  assert.match(serialized, /dev\.skillmap\.connector\.credentials/);
  assert.deepEqual(Object.keys(receipt), ['schema', 'status', 'candidate', 'observed_at', 'checks', 'redacted_inventory', 'worktree_integrity', 'non_claims', 'route']);
});

test('fixture CLI never invokes Apple identity/keychain/profile commands', () => {
  const output = execFileSync(process.execPath, ['scripts/m3-03-apple-signing-readiness.mjs', '--mode', 'fixture', '--fixture-case', 'all-ready', '--output', '-'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /READY_FOR_AUTHORIZED_SIGNING_PROOF/);
  assertNoSensitiveAppleInventoryV1(output, fixture.canaries);
});

test('guarded command names cannot be emitted by tool-only collection', () => {
  const run = spawnSync(process.execPath, ['scripts/m3-03-apple-signing-readiness.mjs', '--mode', 'tool-only', '--output', '-'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 2);
  assert.equal(run.signal, null);
  const output = run.stdout;
  assert.doesNotMatch(output, /find-identity|find-certificate|default-keychain|security cms|plutil -convert/);
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY|password\s*[:=]|bearer\s+/i);
});

test('fake command adapter proves tool-only allowlist and argument boundary without Apple tools', async () => {
  const calls = [];
  const fake = async (file, args, taskRoot, expectedExit) => {
    calls.push({ file, args: [...args], taskRoot, expectedExit });
    const stdout = args[0] === '-m' ? 'arm64\n' : args[0] === '-Gn' ? 'staff\n' : '';
    return { ok: true, missing: false, exit: expectedExit, timed_out: false, oversized: false, invalid_utf8: false, stdout, stderr: '', stdout_digest: 'fake', stderr_digest: 'fake' };
  };
  const tool = await collectToolOnly('/tmp/m3-03-fake', fake);
  assert.equal(calls.length, SAFE_COMMANDS.length);
  assert.equal(tool.arch, 'arm64');
  assert.equal(tool.runner.shared_account, true);
  for (const call of calls) {
    assert.equal(call.file.startsWith('/'), true);
    const joined = call.args.join(' ');
    assert.doesNotMatch(joined, /^(?:default-keychain|find-identity|find-certificate|cms|plutil)(?:\s|$)/);
    assert.doesNotMatch(joined, /codesign\s+-s|security\s+(?:import|export|unlock-keychain)|notarytool\s+submit|stapler\s+staple/i);
    assert.doesNotMatch(joined, /ABCDE12345|password|token|BEGIN PRIVATE KEY/i);
  }
  const malformed = await collectToolOnly('/tmp/m3-03-fake', async (file, args, taskRoot, expectedExit) => ({
    ok: true, missing: false, exit: expectedExit, timed_out: false, oversized: false, invalid_utf8: false,
    stdout: file === '/usr/bin/uname' ? 'arm64\nmalformed\n' : file === '/usr/bin/id' && args[0] === '-u' ? '42\n' : file === '/usr/bin/id' && args[0] === '-un' ? 'user\n' : file === '/usr/bin/stat' ? 'console\n' : file === '/usr/bin/id' && args[0] === '-Gn' ? 'staff\n' : file === '/usr/bin/xcrun' && args[0] === '--find' ? `/usr/bin/${args[1]}\n` : '',
    stderr: '', stdout_digest: 'fake', stderr_digest: 'fake',
  }));
  assert.equal(malformed.arch, 'unknown');
  assert.equal(malformed.inventory_failure, true);
});

test('certificate, fingerprint, and access-group lookalikes fail closed', () => {
  const base = inputFor(fixture.cases[0]);
  const evilClass = clone(base);
  evilClass.identities[0].common_name = 'Developer ID Application Evil';
  assert.equal(evaluateAppleSigningReadinessV1(evilClass, { now }).status, APPLE_READINESS_STATUS.IDENTITY_CLASS_MISMATCH);
  const evilIssuer = clone(base);
  evilIssuer.identities[0].issuer = 'Not Apple Developer ID Evil';
  assert.equal(evaluateAppleSigningReadinessV1(evilIssuer, { now }).status, APPLE_READINESS_STATUS.IDENTITY_CLASS_MISMATCH);
  for (const value of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
    const malformed = clone(base);
    malformed.identities[0].fingerprint_sha256 = value;
    assert.throws(() => parseFindIdentityV1({ schema: 'skillmap.m3-03.apple-signing-readiness.identity.v1', identities: malformed.identities }), AppleReadinessError);
  }
  const extraGroup = clone(base);
  extraGroup.profiles[0].keychain_access_groups.push('ABCDE12345.unrelated');
  assert.equal(evaluateAppleSigningReadinessV1(extraGroup, { now }).status, APPLE_READINESS_STATUS.PROFILE_ACCESS_GROUP_MISMATCH);
  const wildcardAndExtra = clone(base);
  wildcardAndExtra.profiles[0].keychain_access_groups = ['ABCDE12345.*', 'ABCDE12345.dev.skillmap.connector.credentials'];
  assert.equal(evaluateAppleSigningReadinessV1(wildcardAndExtra, { now }).status, APPLE_READINESS_STATUS.READY);
});

test('receipt reconstruction never copies caller metadata or unsafe check fields', () => {
  const result = evaluateAppleSigningReadinessV1(inputFor(fixture.cases[0]), { now });
  const canaries = ['ABCDE12345', 'Fixture Connector', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '/Users/fixture/private.key', 'fixture-password-fragment'];
  const receipt = redactAppleSigningReadinessReceiptV1({
    result,
    candidate: { name: canaries.join('-') },
    observed_at: '2026-08-10T12:00:00.000Z',
    worktree_integrity: { status: canaries.join('/') },
    route: { mode: canaries.join(':') },
  });
  assertNoSensitiveAppleInventoryV1(JSON.stringify(receipt), canaries);
  assert.equal(receipt.candidate.name, 'candidate');
  assert.equal(receipt.worktree_integrity.status, 'not_checked');
  assert.equal(receipt.route.mode, 'unknown');
  const unsafeSummary = { ...result, safe_summary: { ...result.safe_summary, architecture: canaries[0] } };
  assert.throws(() => redactAppleSigningReadinessReceiptV1({ result: unsafeSummary, observed_at: '2026-08-10T12:00:00.000Z' }), AppleReadinessError);
  const unsafeChecks = { ...result, checks: result.checks.map((item, index) => index === 0 ? { ...item, check_id: canaries[0] } : item) };
  assert.throws(() => redactAppleSigningReadinessReceiptV1({ result: unsafeChecks, observed_at: '2026-08-10T12:00:00.000Z' }), AppleReadinessError);
});

test('receipt status is recomputed from the complete lexical check set', () => {
  const result = evaluateAppleSigningReadinessV1(inputFor(fixture.cases[0]), { now });
  const shuffled = { ...result, checks: [...result.checks].reverse() };
  const receipt = redactAppleSigningReadinessReceiptV1({ result: shuffled, observed_at: '2026-08-10T12:00:00.000Z' });
  assert.deepEqual(receipt.checks.map((item) => item.check_id), [...receipt.checks].map((item) => item.check_id).sort());
  const forged = { ...result, status: APPLE_READINESS_STATUS.READY, checks: result.checks.map((item, index) => index === 0 ? { ...item, outcome: 'fail', status: APPLE_READINESS_STATUS.UNSUPPORTED_HOST } : item) };
  assert.throws(() => redactAppleSigningReadinessReceiptV1({ result: forged, observed_at: '2026-08-10T12:00:00.000Z' }), AppleReadinessError);
  assert.throws(() => redactAppleSigningReadinessReceiptV1({ result: { ...result, checks: result.checks.slice(1) }, observed_at: '2026-08-10T12:00:00.000Z' }), AppleReadinessError);
});

test('default-keychain, public-certificate, route, and fingerprint evidence are mandatory', () => {
  const base = inputFor(fixture.cases[0]);
  const defaultMissing = clone(base); defaultMissing.keychain.default_verified = false;
  assert.equal(evaluateAppleSigningReadinessV1(defaultMissing, { now }).status, APPLE_READINESS_STATUS.DEFAULT_KEYCHAIN_UNVERIFIED);
  const noCertificate = clone(base); noCertificate.identities[0].public_certificate_match = false;
  assert.equal(evaluateAppleSigningReadinessV1(noCertificate, { now }).status, APPLE_READINESS_STATUS.IDENTITY_PUBLIC_CERTIFICATE_MISMATCH);
  const missingCertificateEvidence = clone(base); delete missingCertificateEvidence.identities[0].public_certificate_match;
  assert.throws(() => parseFindIdentityV1({ schema: 'skillmap.m3-03.apple-signing-readiness.identity.v1', identities: missingCertificateEvidence.identities }), AppleReadinessError);
  const noFingerprint = clone(base); delete noFingerprint.tool.tool_digests.swiftc;
  assert.equal(evaluateAppleSigningReadinessV1(noFingerprint, { now }).status, APPLE_READINESS_STATUS.TOOL_FINGERPRINT_MISSING);
  const routeFailure = clone(base); routeFailure.tool.network.ipv6_ok = false;
  assert.equal(evaluateAppleSigningReadinessV1(routeFailure, { now }).status, APPLE_READINESS_STATUS.NETWORK_ISOLATION_UNVERIFIED);
  const missingRouteEvidence = clone(base); delete missingRouteEvidence.tool.network.ipv6_ok;
  assert.throws(() => parseToolInventoryV1(missingRouteEvidence.tool), AppleReadinessError);
});

test('plain-data size, cyclic, getter, inherited, and sparse-array boundaries fail closed', () => {
  const base = inputFor(fixture.cases[0]);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => parseToolInventoryV1(cyclic), AppleReadinessError);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => parseFindIdentityV1({ schema: 'skillmap.m3-03.apple-signing-readiness.identity.v1', identities: sparse }), AppleReadinessError);
  const huge = clone(base.tool);
  huge.arch = 'x'.repeat(256 * 1024);
  assert.throws(() => parseToolInventoryV1(huge), AppleReadinessError);
  const inherited = Object.create({ schema: base.tool.schema });
  assert.throws(() => parseToolInventoryV1(inherited), AppleReadinessError);
  const getter = {};
  Object.defineProperty(getter, 'schema', { enumerable: true, get() { throw new Error('getter touched'); } });
  assert.throws(() => parseToolInventoryV1(getter), AppleReadinessError);
});

test('request parser enforces the closed relative pre-provisioned task-root layout', () => {
  const rootTemp = realpathSync(mkdtempSync(join(tmpdir(), 'skillmap-m303-request-test-')));
  try {
    mkdirSync(join(rootTemp, 'profiles', 'alternates'), { recursive: true, mode: 0o700 });
    chmodSync(rootTemp, 0o700); chmodSync(join(rootTemp, 'profiles'), 0o700); chmodSync(join(rootTemp, 'profiles', 'alternates'), 0o700);
    for (const path of [join(rootTemp, 'signing.keychain-db'), join(rootTemp, 'profiles/launcher.provisionprofile'), join(rootTemp, 'profiles/helper.provisionprofile')]) { writeFileSync(path, 'synthetic', { mode: 0o600 }); chmodSync(path, 0o600); }
    const requestPath = join(rootTemp, 'request.json');
    const valid = { schema: 'skillmap.m3-03.apple-signing-readiness-request.v1', expected_team_id: 'ABCDE12345', disposable_user: 'test-user', disposable_uid: process.getuid(), dedicated_keychain_relpath: 'signing.keychain-db', launcher_profile_relpath: 'profiles/launcher.provisionprofile', helper_profile_relpath: 'profiles/helper.provisionprofile', alternate_profile_relpaths: [] };
    writeFileSync(requestPath, JSON.stringify(valid), { mode: 0o600 });
    assert.equal(readRequest(rootTemp).expected_team_id, 'ABCDE12345');
    writeFileSync(requestPath, '{"schema":"skillmap.m3-03.apple-signing-readiness-request.v1","schema":"x"}', { mode: 0o600 });
    assert.throws(() => readRequest(rootTemp));
    writeFileSync(requestPath, JSON.stringify({ ...valid, dedicated_keychain_relpath: '../escape' }), { mode: 0o600 });
    assert.throws(() => readRequest(rootTemp));
    const link = join(rootTemp, 'profiles', 'launcher-link.provisionprofile'); symlinkSync(join(rootTemp, 'profiles/launcher.provisionprofile'), link);
    writeFileSync(requestPath, JSON.stringify({ ...valid, launcher_profile_relpath: 'profiles/launcher-link.provisionprofile' }), { mode: 0o600 });
    assert.throws(() => readRequest(rootTemp));
    writeFileSync(requestPath, `${' '.repeat(16 * 1024)}x`, { mode: 0o600 });
    assert.throws(() => readRequest(rootTemp));
  } finally { rmSync(rootTemp, { recursive: true, force: true }); }
});

test('fake guarded inventory parses public identity/certificate/profile outputs and evaluates them without real Apple commands', async () => {
  const rootTemp = realpathSync(mkdtempSync(join(tmpdir(), 'skillmap-m303-inventory-test-')));
  try {
    mkdirSync(join(rootTemp, 'profiles', 'alternates'), { recursive: true, mode: 0o700 });
    chmodSync(rootTemp, 0o700); chmodSync(join(rootTemp, 'profiles'), 0o700); chmodSync(join(rootTemp, 'profiles', 'alternates'), 0o700);
    const keychain = join(rootTemp, 'signing.keychain-db');
    const launcher = join(rootTemp, 'profiles/launcher.provisionprofile');
    const helper = join(rootTemp, 'profiles/helper.provisionprofile');
    for (const path of [keychain, launcher, helper]) { writeFileSync(path, 'synthetic', { mode: 0o600 }); chmodSync(path, 0o600); }
    const requestPath = join(rootTemp, 'request.json');
    writeFileSync(requestPath, JSON.stringify({ schema: 'skillmap.m3-03.apple-signing-readiness-request.v1', expected_team_id: 'ABCDE12345', disposable_user: 'ci-runner', disposable_uid: process.getuid(), dedicated_keychain_relpath: 'signing.keychain-db', launcher_profile_relpath: 'profiles/launcher.provisionprofile', helper_profile_relpath: 'profiles/helper.provisionprofile', alternate_profile_relpaths: [] }), { mode: 0o600 });
    const defaultKeychain = join(rootTemp, 'default.keychain-db'); writeFileSync(defaultKeychain, 'default', { mode: 0o600 }); chmodSync(defaultKeychain, 0o600);
    const base = inputFor(fixture.cases[0]);
    const identityJson = JSON.stringify({ schema: 'skillmap.m3-03.apple-signing-readiness.identity.v1', identities: base.identities });
    const certificateJson = JSON.stringify({ schema: 'skillmap.m3-03.apple-signing-readiness.certificates.v1', certificates: base.identities });
    const profiles = [
      { schema: 'skillmap.m3-03.apple-signing-readiness.profile.v1', profiles: [base.profiles[0]] },
      { schema: 'skillmap.m3-03.apple-signing-readiness.profile.v1', profiles: [base.profiles[1]] },
    ];
    const calls = [];
    const fake = async (file, args, taskRoot, expectedExit, input, inheritedKeychainFd) => {
      calls.push({ file, args: [...args], input, inheritedKeychainFd, fd3: inheritedKeychainFd !== undefined && args.includes('/dev/fd/3') });
      if (inheritedKeychainFd !== undefined && args.includes('/dev/fd/3')) { const bytes = Buffer.alloc(9); assert.equal(readSync(inheritedKeychainFd, bytes, 0, bytes.length, 0), 9); assert.equal(bytes.toString('utf8'), 'synthetic'); }
      let stdout = '';
      let exit = expectedExit;
      let ok = true;
      if (file === '/usr/bin/uname') stdout = 'arm64\n';
      else if (file === '/usr/bin/id' && args[0] === '-u') stdout = `${process.getuid()}\n`;
      else if (file === '/usr/bin/id' && args[0] === '-un') stdout = 'ci-runner\n';
      else if (file === '/usr/bin/id' && args[0] === '-Gn') stdout = 'staff\n';
      else if (file === '/usr/bin/stat') stdout = 'console-account\n';
      else if (file === '/usr/sbin/scutil') stdout = 'Network interfaces: none\n';
      else if (file === '/usr/sbin/netstat') stdout = 'Routing tables\nDestination Gateway Flags\n';
      else if (file === '/usr/bin/xcrun' && args[0] === '--find') stdout = `/usr/bin/${args[1]}\n`;
      else if (file === '/usr/bin/security' && args[0] === 'default-keychain') stdout = `"${defaultKeychain}"\n`;
      else if (file === '/usr/bin/security' && args[0] === 'find-identity') stdout = identityJson;
      else if (file === '/usr/bin/security' && args[0] === 'find-certificate') stdout = certificateJson;
      else if (file === '/usr/bin/security' && args[0] === 'cms') stdout = JSON.stringify({ role: calls.filter((call) => call.file === '/usr/bin/security' && call.args[0] === 'cms').length === 1 ? 'launcher' : 'helper' });
      else if (file === '/usr/bin/plutil' && input !== undefined) stdout = JSON.stringify(profiles[JSON.parse(input).role === 'launcher' ? 0 : 1]);
      else if (file === '/usr/bin/codesign' || file === '/usr/bin/security' || file === '/usr/bin/xcrun') stdout = 'usage\n';
      return { ok, missing: false, exit, timed_out: false, oversized: false, invalid_utf8: false, stdout, stderr: '', stdout_digest: 'fake', stderr_digest: 'fake', fd3: inheritedKeychainFd !== undefined && args.includes('/dev/fd/3') };
    };
    const input = await collectInventory(rootTemp, requestPath, fake);
    const result = evaluateAppleSigningReadinessV1(input, { now });
    assert.equal(result.status, APPLE_READINESS_STATUS.READY);
    assert.equal(calls.some((call) => call.args[0] === 'find-identity'), true);
    assert.equal(calls.some((call) => call.args[0] === 'find-certificate'), true);
    const identityCall = calls.find((call) => call.args[0] === 'find-identity');
    const certificateCall = calls.find((call) => call.args[0] === 'find-certificate');
    assert.deepEqual(identityCall.args.slice(-1), ['/dev/fd/3']);
    assert.deepEqual(certificateCall.args.slice(-1), ['/dev/fd/3']);
    assert.equal(identityCall.fd3, true);
    assert.equal(certificateCall.fd3, true);
    assert.equal(identityCall.args.includes(keychain), false);
    assert.equal(certificateCall.args.includes(keychain), false);
    assert.equal(calls.some((call) => call.args[0] === 'cms'), true);
    assert.equal(calls.some((call) => call.file === '/usr/bin/plutil'), true);
    assert.equal(calls.every((call) => !call.args.join(' ').includes('codesign -s')), true);
    let drifted = false;
    const digestDrift = async (...args) => {
      const response = await fake(...args);
      if (!drifted && args[0] === '/usr/bin/security' && args[1][0] === 'find-identity') {
        drifted = true;
        writeFileSync(keychain, 'tampered');
      }
      return response;
    };
    await assert.rejects(() => collectInventory(rootTemp, requestPath, digestDrift));
    writeFileSync(keychain, 'synthetic');
  } finally {
    rmSync(rootTemp, { recursive: true, force: true });
  }
});
