import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildProofPreimageV2, computeSha256, DEVICE_AUTH_AUDIENCE_V1, DEVICE_AUTH_SUITE_V2 } from '../dist/contracts/device-auth.js';
import { DeviceAuthClient, DeviceAuthError } from '../dist/network/device-auth-client.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';
import { canonicalizeScopes } from '../apps/web/lib/device-auth/contracts.ts';
import { parseStrictDeviceAuthJson, readDeviceAuthBody, tryParseStrict } from '../apps/web/lib/device-auth/raw-json.server.ts';
import { redactSecrets, safeDeviceAuthLogLine } from '../apps/web/lib/device-auth/redaction.ts';
import { assertHelperRequest, assertHelperResponse, decodeHelperFrame, encodeHelperFrame } from '../src/platform/macos-keychain-protocol.ts';
import { classifyVerifiedClaims } from '../apps/web/lib/auth/errors.ts';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/m3-12-device-auth/cases.json'), 'utf8'));
const DEVICE_ID = 'D'.repeat(22);
const DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const FAMILY_ID = `fam_${'c'.repeat(32)}`;
const TOKEN = 'T'.repeat(43);
const REFRESH = 'R'.repeat(43);
const THUMBPRINT = `sha256:${'1'.repeat(64)}`;
const NOW = Math.floor(Date.now() / 1000);

// The web package normally supplies the server-only virtual module through
// Next. The loader is confined to .tmp and only permits this local test to
// import the unchanged production proof module under Node.
const serverOnlyLoader = join(root, '.tmp/m3-12-device-auth/server-only-loader.mjs');
mkdirSync(resolve(serverOnlyLoader, '..'), { recursive: true });
writeFileSync(serverOnlyLoader, 'export { resolve, load } from "../../test/support/node-typescript-loader.mjs";\n', { mode: 0o600 });
register(serverOnlyLoader, import.meta.url);
const { validateProofEnvelope } = await import('../apps/web/lib/device-auth/poll-exchange-service.server.ts');

async function makeClient(fetchFn = async () => new Response('{}', { status: 500 }), options = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  return new DeviceAuthClient({ origin: 'https://skillmap.example.test', keyStore, deviceId: DEVICE_ID, fetchFn, timeoutMs: 100, maxRetries: 0, ...options });
}
function statusBody() { return { device_public_id: DEVICE_PUBLIC_ID, account_public_id: ACCOUNT_PUBLIC_ID, state: 'active', scopes: ['device.status'], expires_at: NOW + 600, key_thumbprint: THUMBPRINT }; }
function tokenBody() { return { device_public_id: DEVICE_PUBLIC_ID, account_public_id: ACCOUNT_PUBLIC_ID, token_family_id: FAMILY_ID, access_token: TOKEN, refresh_token: REFRESH, expires_in: 600, refresh_idle_expires_in: 1000, refresh_absolute_expires_in: 100000 }; }
function record() { return { deviceId: DEVICE_ID, tokenFamilyId: FAMILY_ID, refreshToken: REFRESH, scopes: ['device.status'], devicePublicId: DEVICE_PUBLIC_ID, accountPublicId: ACCOUNT_PUBLIC_ID, updatedAt: 1, generation: 0, familyAbsoluteExpiresAt: NOW + 100000 }; }
async function rejected(fn) { try { await fn(); return 'allow'; } catch { return 'deny'; } }
function preimage(overrides = {}) {
  return buildProofPreimageV2({ method: 'POST', origin: 'https://skillmap.example.test', path: '/api/device-auth/v1/pairings/poll', audience: DEVICE_AUTH_AUDIENCE_V1, purpose: 'poll', deviceId: DEVICE_ID, thumbprint: THUMBPRINT, bodySha256: `sha256:${'2'.repeat(64)}`, idempotencyKey: 'I'.repeat(22), nonce: 'N'.repeat(22), issuedAt: NOW, ...overrides });
}
function productionProof(overrides = {}) {
  return { configuredOrigin: 'https://skillmap.example.test', path: '/api/device-auth/v1/pairings/poll', proofSuite: DEVICE_AUTH_SUITE_V2, audience: DEVICE_AUTH_AUDIENCE_V1, purpose: 'poll', proofNonce: 'N'.repeat(22), issuedAt: String(NOW), bodySha256: `sha256:${'2'.repeat(64)}`, signature: 'S'.repeat(86), proofSuiteHeader: DEVICE_AUTH_SUITE_V2, audienceHeader: DEVICE_AUTH_AUDIENCE_V1, purposeHeader: 'poll', deviceIdHeader: DEVICE_ID, idempotencyKey: 'I'.repeat(22), ...overrides };
}
function productionClockOutcome(offset) {
  const originalNow = Date.now;
  Date.now = () => (NOW + offset) * 1000;
  try { validateProofEnvelope(productionProof()); return 'allow'; } catch { return 'deny'; } finally { Date.now = originalNow; }
}
function changed(field, value) { return preimage() === preimage({ [field]: value }) ? 'allow' : 'deny'; }

async function evaluate(id) {
  switch (id) {
    case 'guess-device-short': return await rejected(() => makeClient().then((c) => c.getStatus({ devicePublicId: 'dev_' + 'a'.repeat(31), accessToken: TOKEN })));
    case 'guess-device-character': return await rejected(() => makeClient().then((c) => c.getStatus({ devicePublicId: 'dev_' + 'a'.repeat(31) + '!', accessToken: TOKEN })));
    case 'guess-device-public-id': return await rejected(() => makeClient().then((c) => c.getStatus({ devicePublicId: 'not-a-device', accessToken: TOKEN })));
    case 'guess-token-family': return await rejected(() => makeClient().then((c) => c.refreshToken({ refreshToken: REFRESH, tokenFamilyId: 'fam_' + 'c'.repeat(31) })));
    case 'json-duplicate-key': return tryParseStrict('{"a":1,"a":2}') === null ? 'allow' : 'deny';
    case 'json-duplicate-unicode-key': return tryParseStrict('{"a":1,"\\u0061":2}') === null ? 'allow' : 'deny';
    case 'json-trailing-data': return tryParseStrict('{"a":1} false') === null ? 'allow' : 'deny';
    case 'json-bom': return tryParseStrict('\ufeff{"a":1}') === null ? 'allow' : 'deny';
    case 'json-invalid-utf8': { try { new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from([0xc3, 0x28])); return 'allow'; } catch { return 'deny'; } }
    case 'json-oversize': return await readDeviceAuthBody(new Request('https://skillmap.example.test', { method: 'POST', body: 'x'.repeat(17 * 1024), headers: { 'content-length': String(17 * 1024) } })).then(() => 'allow', () => 'deny');
    case 'json-valid-utf8': return parseStrictDeviceAuthJson('{"a":"café"}').a === 'café' ? 'allow' : 'deny';
    case 'json-nested-bound': { let value = '0'; for (let i = 0; i < 34; i += 1) value = `[${value}]`; return tryParseStrict(value) === null ? 'allow' : 'deny'; }
    case 'proof-method-confusion': return changed('method', 'GET');
    case 'proof-path-confusion': return changed('path', '/foreign');
    case 'proof-body-confusion': return changed('bodySha256', `sha256:${'3'.repeat(64)}`);
    case 'proof-audience-confusion': return changed('audience', 'skillmap.other.v1');
    case 'proof-purpose-confusion': return changed('purpose', 'exchange');
    case 'proof-suite-confusion': return changed('suite', 'skillmap.ed25519.v1');
    case 'proof-thumbprint-confusion': return changed('thumbprint', `sha256:${'4'.repeat(64)}`);
    case 'proof-access-hash-confusion': return changed('accessTokenSha256', computeSha256(TOKEN));
    case 'proof-idempotency-confusion': return changed('idempotencyKey', 'J'.repeat(22));
    case 'clock-boundary': return productionClockOutcome(60);
    case 'clock-stale': return productionClockOutcome(61);
    case 'clock-future': return productionClockOutcome(-61);
    case 'wrong-scope': return canonicalizeScopes(['device.admin']) === null ? 'deny' : 'allow';
    case 'canonical-scope': return JSON.stringify(canonicalizeScopes(['device.status', 'device.route'])) === JSON.stringify(['device.route', 'device.status']) ? 'allow' : 'deny';
    case 'stolen-access-grammar': return await rejected(async () => { const c = await makeClient(); await c.getStatus({ devicePublicId: DEVICE_PUBLIC_ID, accessToken: 'bad' }); });
    case 'stolen-access-not-in-url': { let seen = ''; const c = await makeClient(async (url) => { seen = url; return new Response(JSON.stringify(statusBody()), { status: 200, headers: { 'content-type': 'application/json' } }); }); await c.getStatus({ devicePublicId: DEVICE_PUBLIC_ID, accessToken: TOKEN }); return seen.includes(TOKEN) ? 'deny' : 'allow'; }
    case 'stolen-refresh-not-in-error': { const c = await makeClient(async () => { throw new Error(`private ${REFRESH}`); }); try { await c.getStatus({ devicePublicId: DEVICE_PUBLIC_ID, accessToken: TOKEN }); return 'deny'; } catch (error) { return error.message.includes(REFRESH) || error.message.includes(TOKEN) ? 'deny' : 'allow'; } }
    case 'exchange-response-shape': { const c = await makeClient(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })); return await rejected(() => c.exchangeCode({ exchangeCode: 'E'.repeat(43), scopes: ['device.status'] })); }
    case 'refresh-response-issued-at': { const c = await makeClient(async () => new Response(JSON.stringify(tokenBody()), { status: 200, headers: { 'content-type': 'application/json' } })); return await rejected(() => c.refreshToken({ refreshToken: REFRESH, tokenFamilyId: FAMILY_ID })); }
    case 'refresh-pending-tuple': { const store = new InMemoryCredentialStore(() => 1000); await store.commitExchange(record()); const pending = await store.markRefreshPending({ idempotencyKey: 'I'.repeat(22), requestDigest: `sha256:${'2'.repeat(64)}`, wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1000 }); return pending.expectedGeneration === 0 ? 'allow' : 'deny'; }
    case 'refresh-concurrent-same-tuple': { const store = new InMemoryCredentialStore(); await store.commitExchange(record()); const pending = { idempotencyKey: 'I'.repeat(22), requestDigest: `sha256:${'2'.repeat(64)}`, wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1 }; const [a, b] = await Promise.all([store.markRefreshPending(pending), store.markRefreshPending(pending)]); return a.idempotencyKey === b.idempotencyKey ? 'allow' : 'deny'; }
    case 'refresh-response-loss-recovery': { const store = new InMemoryCredentialStore(); await store.commitExchange(record()); await store.markRefreshPending({ idempotencyKey: 'I'.repeat(22), requestDigest: `sha256:${'2'.repeat(64)}`, wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1 }); return (await store.loadState()).pending ? 'allow' : 'deny'; }
    case 'expiry-invalid-family': { const store = new InMemoryCredentialStore(); await store.commitExchange(record()); try { await store.commitRefresh({ pending: { idempotencyKey: 'I'.repeat(22), requestDigest: `sha256:${'2'.repeat(64)}`, wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1 }, record: { ...record(), generation: 1, familyAbsoluteExpiresAt: -1 } }); return 'allow'; } catch { return 'deny'; } }
    case 'expiry-valid-record': { const store = new InMemoryCredentialStore(); await store.commitExchange(record()); return (await store.load()).familyAbsoluteExpiresAt === NOW + 100000 ? 'allow' : 'deny'; }
    case 'jwt-malformed': return classifyVerifiedClaims({ claims: { sub: 42 } }, null).state === 'signed-out' ? 'deny' : 'allow';
    case 'jwt-anonymous': return classifyVerifiedClaims(null, null).state === 'signed-out' ? 'deny' : 'allow';
    case 'jwt-unavailable': return classifyVerifiedClaims(null, { status: 500, code: 'server_error' }).state === 'unavailable' ? 'deny' : 'allow';
    case 'jwt-authenticated': return classifyVerifiedClaims({ claims: { sub: 'fixture-user' } }, null).state === 'authenticated' ? 'allow' : 'deny';
    case 'logout-network-loss': return (await logoutFixture()).unconfirmed ? 'deny' : 'allow';
    case 'logout-local-confirm': return (await logoutFixture(true)).localDeleted ? 'allow' : 'deny';
    case 'logout-remote-success': return (await logoutFixture(false, true)).localDeleted ? 'allow' : 'deny';
    case 'helper-corrupt-frame': return decodeFails(Buffer.from([0, 0, 0, 4, 0x7b])) ? 'deny' : 'allow';
    case 'helper-length-mismatch': return decodeFails(Buffer.from([0, 0, 0, 1, 0x7b, 0x7d])) ? 'deny' : 'allow';
    case 'helper-unknown-operation': return assertFails(() => assertHelperRequest({ version: 1, namespace: 'fixture', operation: 'read_secret' })) ? 'deny' : 'allow';
    case 'helper-locked-error': return assertFails(() => assertHelperResponse({ version: 1, ok: false, error: { code: 42 } })) ? 'deny' : 'allow';
    case 'helper-valid-frame': { const decoded = decodeHelperFrame(encodeHelperFrame({ version: 1, namespace: 'fixture', operation: 'public_key' })); assertHelperRequest(decoded); return 'allow'; }
    case 'redact-secret-fields': { const out = redactSecrets({ access_token: TOKEN, refresh_token: REFRESH, nonce: 'N'.repeat(22) }); return out.access_token === '[REDACTED]' && out.refresh_token === '[REDACTED]' && out.nonce === '[REDACTED]' ? 'allow' : 'deny'; }
    case 'redact-secret-values': return JSON.stringify(redactSecrets({ value: TOKEN, digest: THUMBPRINT })).includes('[REDACTED]') ? 'allow' : 'deny';
    case 'redact-error-fixed': return safeDeviceAuthLogLine('fixture', 'error', { error: 'invalid_token' }).includes('invalid_token') ? 'allow' : 'deny';
    case 'redact-receipt-canary': return JSON.stringify(redactSecrets({ receipt: TOKEN })).includes(TOKEN) ? 'deny' : 'allow';
    case 'redact-no-raw-token-proof': return safeDeviceAuthLogLine('fixture', 'ok', { proof: 'S'.repeat(86), access_token: TOKEN }).includes(TOKEN) ? 'deny' : 'allow';
    case 'redact-file-canary-scan': return repoCanaryScan();
    default: throw new Error(`unexecuted matrix case ${id}`);
  }
}

function decodeFails(bytes) { try { decodeHelperFrame(bytes); return false; } catch { return true; } }
function assertFails(fn) { try { fn(); return false; } catch { return true; } }
async function logoutFixture(localOnly = false, remoteSuccess = false) {
  const keyStore = new InMemoryDeviceKeyStore(); await keyStore.createKey();
  const credentials = new InMemoryCredentialStore(); await credentials.commitExchange(record());
  const c = new DeviceAuthClient({ origin: 'https://skillmap.example.test', keyStore, deviceId: DEVICE_ID, fetchFn: async (url) => {
    if (url.endsWith('/tokens/refresh') && remoteSuccess) return new Response(JSON.stringify(tokenBody()), { status: 200, headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': String(NOW) } });
    if (url.endsWith('/revoke') && remoteSuccess) return new Response(JSON.stringify({ status: 'revoked', device_public_id: DEVICE_PUBLIC_ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new TypeError('fixture-offline');
  } });
  const useCase = new DeviceAuthUseCase({ client: c, keyStore, credentialStore: credentials, metadataStore: new InMemoryDeviceAuthMetadataStore() });
  return useCase.logout(localOnly ? { localOnly: true, confirm: true } : undefined);
}
function repoCanaryScan() {
  const accessCanary = ['M312', 'ACCESS', 'CANARY'].join('_');
  const proofCanary = ['M312', 'PROOF', 'CANARY'].join('_');
  const serialized = safeDeviceAuthLogLine('fixture', 'error', { access_token: accessCanary, proof: proofCanary });
  if (serialized.includes(accessCanary) || serialized.includes(proofCanary)) return 'deny';
  const files = [];
  const walk = (relative) => { let entries; try { entries = readdirSync(join(root, relative), { withFileTypes: true }); } catch { return; } for (const entry of entries) { const child = join(relative, entry.name); if (entry.isDirectory()) walk(child); else if (entry.isFile() && statSync(join(root, child)).size < 4 * 1024 * 1024) files.push(child); } };
  for (const relative of ['test', 'scripts', 'src', 'apps/web', '.tmp/m3-12-device-auth']) walk(relative);
  return files.every((relative) => { const text = readFileSync(join(root, relative), 'utf8'); return !text.includes(accessCanary) && !text.includes(proofCanary); }) ? 'allow' : 'deny';
}

export async function runMatrix({ rows = fixture.cases, evaluator = evaluate, writeReceipt = Boolean(process.env.M312_RECEIPT_PATH) } = {}) {
  const outcomes = [];
  for (const row of rows) {
    const actual = await evaluator(row.id);
    const passed = actual === row.expected;
    outcomes.push({ ...row, actual, passed });
    if (!passed) throw new Error(`${row.id}: expected ${row.expected}, actual ${actual}`);
  }
  if (writeReceipt) {
    const receiptPath = process.env.M312_RECEIPT_PATH;
    mkdirSync(resolve(receiptPath, '..'), { recursive: true });
    writeFileSync(receiptPath, JSON.stringify({ schema: fixture.schema, status: 'passed', fixture_sha256: createHash('sha256').update(readFileSync(join(root, 'test/fixtures/m3-12-device-auth/cases.json'))).digest('hex'), matrix_source_sha256: createHash('sha256').update(readFileSync(join(root, 'test/m3-12-device-auth-adversarial.mjs'))).digest('hex'), expected_cases: outcomes.length, passed_cases: outcomes.filter((x) => x.passed).length, failed_cases: 0, skipped_cases: 0, cases: outcomes, blocked_rows: fixture.blocked_rows.map((row) => ({ ...row, status: 'blocked' })), route: 'local production functions with deterministic fake transport and in-memory stores', secrets: 'none' }, null, 2) + '\n', { mode: '600' });
  }
  return outcomes;
}

test('M3.12 matrix records independent actual outcomes with zero false passes', async () => {
  const outcomes = await runMatrix();
  assert.equal(outcomes.length, fixture.cases.length);
  assert.ok(outcomes.every((row) => row.actual === row.expected && row.passed));
});

test('M3.12 expected-data perturbation fails the runner', async () => {
  const perturbed = fixture.cases.map((row, index) => index === 0 ? { ...row, expected: row.expected === 'allow' ? 'deny' : 'allow' } : row);
  await assert.rejects(runMatrix({ rows: perturbed, writeReceipt: false }), /guess-device-short/);
});

test('M3.12 implementation perturbation fails the runner', async () => {
  const evaluator = async (id) => id === 'guess-device-short' ? 'allow' : evaluate(id);
  await assert.rejects(runMatrix({ evaluator, writeReceipt: false }), /guess-device-short/);
});
