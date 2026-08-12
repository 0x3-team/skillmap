import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import {
  REPLAY_RING_SCHEMA,
  REPLAY_RING_MAX_BYTES,
  REPLAY_RING_MAX_ENTRIES,
  REPLAY_EPOCH_SECONDS,
  REPLAY_LOGICAL_SECONDS,
  REPLAY_PURGE_SECONDS,
  REPLAY_DESTROY_SKEW_SECONDS,
  REPLAY_EXPOSURE_BOUND_SECONDS,
  ReplayRingError,
  parseReplayRingV1,
  readReplayRingBindingV1,
  selectReplayEpochKey,
  redactedReplayRingSummary,
  createFakeReplayKeyProvider,
} from './support/m3-03-replay-provider-proof.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = join(root, 'test', 'fixtures', 'm3-03-replay-provider-proof');
const wrangler = join(root, 'apps', 'web', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const b64 = (value) => Buffer.from(value).toString('base64url');
const key = (byte) => Buffer.alloc(32, byte);
const validEntry = (epochId = 5, byte = 7) => ({
  epoch_id: epochId,
  key_b64url: b64(key(byte)),
});
const validRing = (entries = [validEntry()]) => ({
  schema: REPLAY_RING_SCHEMA,
  primary: entries[entries.length - 1].epoch_id,
  keys: entries,
});

function assertCode(fn, code) {
  assert.throws(fn, (error) => error instanceof ReplayRingError && error.code === code);
}

function rawCurl(port, path, { method = 'GET', headers = [], body } = {}) {
  const args = ['--path-as-is', '--silent', '--show-error', '--request', method];
  for (const header of headers) args.push('--header', header);
  if (body !== undefined) args.push('--data-binary', body);
  args.push('--write-out', '\n%{http_code}', `http://127.0.0.1:${port}${path}`);
  const output = execFileSync('curl', args, { encoding: 'utf8', timeout: 10000 });
  const lines = output.trimEnd().split('\n');
  const status = Number(lines.pop());
  return { status, body: JSON.parse(lines.join('\n')) };
}

function rawHttpRequest(port, path, { method = 'GET', headers = [], body } = {}) {
  const requestHeaders = Object.fromEntries(headers.map((header) => {
    const separator = header.indexOf(':');
    assert.ok(separator > 0, `raw HTTP header must contain a name and value: ${header}`);
    return [header.slice(0, separator), header.slice(separator + 1).trim()];
  }));
  return new Promise((resolveResponse, rejectResponse) => {
    // Workerd rejects a non-empty GET body before reading its stream. Node's
    // default agent advertises keep-alive, which lets that early response race
    // the unread request body on some runners. Use a dedicated, non-reused
    // connection so this fail-closed probe has deterministic HTTP semantics.
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: requestHeaders, agent: false }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.once('end', () => resolveResponse({
        status: response.statusCode,
        headers: response.headers,
        rawBody: responseBody,
      }));
      response.once('error', rejectResponse);
    });
    request.once('error', rejectResponse);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function terminateProcessTree(child, signal) {
  if (hasExited(child)) return;
  if (process.platform === 'win32') {
    // Wrangler's launcher starts a second Node process. Windows does not
    // propagate child.kill() to that process tree, so target this exact PID
    // and its descendants without invoking a shell or matching by name.
    assert.equal(Number.isInteger(child.pid), true, 'local Workerd process must expose a PID for Windows cleanup');
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill(signal);
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForProcessExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve();
  return Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeoutMs),
  ]);
}

test('M3.03 replay ring exports freeze the bounded v1 contract', () => {
  assert.equal(REPLAY_RING_SCHEMA, 'skillmap.device-auth.replay-ring.v1');
  assert.equal(REPLAY_RING_MAX_BYTES, 4096);
  assert.equal(REPLAY_RING_MAX_ENTRIES, 4);
  assert.equal(REPLAY_EPOCH_SECONDS, 300);
  assert.equal(REPLAY_LOGICAL_SECONDS, 600);
  assert.equal(REPLAY_PURGE_SECONDS, 900);
  assert.equal(REPLAY_DESTROY_SKEW_SECONDS, 30);
  assert.equal(REPLAY_EXPOSURE_BOUND_SECONDS, 1230);
});

test('strict parser accepts only the public ring shape and returns copied key bytes', () => {
  const ring = parseReplayRingV1(JSON.stringify(validRing()));
  assert.equal(ring.schema, REPLAY_RING_SCHEMA);
  assert.equal(ring.primary, 5);
  assert.equal(ring.keys.length, 1);
  assert.equal(Object.isFrozen(ring), true);
  assert.equal(Object.isFrozen(ring.keys), true);
  assert.deepEqual(ring.keys[0].key, key(7));
  const copy = parseReplayRingV1(JSON.stringify(validRing()));
  copy.keys[0].key[0] = 99;
  assert.equal(parseReplayRingV1(JSON.stringify(validRing())).keys[0].key[0], 7);
  assert.deepEqual(readReplayRingBindingV1(Buffer.from(JSON.stringify(validRing()), 'utf8')), ring);
  assertCode(() => parseReplayRingV1('not-json'), 'invalid_json');
  assertCode(() => parseReplayRingV1(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(JSON.stringify(validRing()))])), 'invalid_json');
  assertCode(() => parseReplayRingV1(validRing()), 'invalid_binding_type');
  const inherited = Object.create(validRing());
  assertCode(() => parseReplayRingV1(inherited), 'invalid_binding_type');
  const getter = {};
  Object.defineProperty(getter, 'schema', { get() { throw new Error('must not inspect object input'); } });
  assertCode(() => parseReplayRingV1(getter), 'invalid_binding_type');
  assertCode(() => parseReplayRingV1('{"schema":"skillmap.device-auth.replay-ring.v1","schema":"skillmap.device-auth.replay-ring.v1","primary":5,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}]}'), 'invalid_ring');
  assertCode(() => parseReplayRingV1('{"schema":"skillmap.device-auth.replay-ring.v1","primary":-0,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}]}'), 'invalid_ring');
  assertCode(() => redactedReplayRingSummary(validRing()), 'invalid_ring');
});

test('parser rejects malformed, stale, duplicate, oversized, and secret-bearing bindings closed', () => {
  for (const candidate of [
    { ...validRing(), schema: 'skillmap.device-auth.replay-ring.v0' },
    { ...validRing(), unknown: true },
    { ...validRing(), primary: '5' },
    { ...validRing(), keys: [] },
    { ...validRing(), keys: [validEntry(5), validEntry(5, 8)] },
    { ...validRing(), keys: [validEntry(6), validEntry(5)] },
    { ...validRing(), keys: [{ epoch_id: 5, key_b64url: b64(Buffer.alloc(31)) }] },
    { ...validRing(), keys: [{ epoch_id: 5, key_b64url: '***' }] },
    { ...validRing(), keys: [{ epoch_id: 5, key_b64url: b64(key(7)), private_key: 'nope' }] },
    { ...validRing(), primary: -1 },
    JSON.parse('{"schema":"skillmap.device-auth.replay-ring.v1","primary":5,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","__proto__":{}}]}'),
    JSON.parse('{"schema":"skillmap.device-auth.replay-ring.v1","primary":5,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc","constructor":1}]}'),
  ]) assertCode(() => parseReplayRingV1(JSON.stringify(candidate)), 'invalid_ring');
  assertCode(() => parseReplayRingV1('{"schema":"skillmap.device-auth.replay-ring.v1","primary":5e0,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}]}'), 'invalid_ring');
  assertCode(() => parseReplayRingV1('{"schema":"skillmap.device-auth.replay-ring.v1","primary":5,"keys":[{"epoch_id":5.0,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}]}'), 'invalid_ring');
  assertCode(() => parseReplayRingV1(JSON.stringify({ ...validRing(), keys: [validEntry(5), validEntry(6), validEntry(7), validEntry(8), validEntry(9)] })), 'too_many_entries');
  const tooLarge = `${JSON.stringify(validRing())}${' '.repeat(REPLAY_RING_MAX_BYTES)}`;
  assertCode(() => readReplayRingBindingV1(tooLarge), 'ring_too_large');
  assertCode(() => readReplayRingBindingV1(''), 'empty_binding');
  assertCode(() => readReplayRingBindingV1(JSON.stringify({ schema: REPLAY_RING_SCHEMA, primary: 6, keys: [validEntry(5)] })), 'invalid_ring');
  assertCode(() => readReplayRingBindingV1(new Uint8Array([0xff, 0xfe])), 'invalid_json');
});

test('selection enforces exact five-minute epoch and logical/purge/destroy boundaries', () => {
  const ring = parseReplayRingV1(JSON.stringify(validRing([validEntry(5, 7), validEntry(6, 8)])));
  assert.deepEqual(selectReplayEpochKey(ring, { responseIssuedAt: 1500, now: 1500 }), { epochId: 5, key: key(7) });
  assert.deepEqual(selectReplayEpochKey(ring, { responseIssuedAt: 1800, now: 1800 }), { epochId: 6, key: key(8) });
  assertCode(() => selectReplayEpochKey(ring, { responseIssuedAt: 2100, now: 2100 }), 'epoch_key_unavailable');
  assertCode(() => selectReplayEpochKey(ring, { responseIssuedAt: 1500, now: 2100 }), 'replay_expired');
  assertCode(() => selectReplayEpochKey(ring, { responseIssuedAt: 1500, now: 1500 + REPLAY_PURGE_SECONDS }), 'replay_expired');
  assertCode(() => selectReplayEpochKey(ring, { responseIssuedAt: 1500, now: 1500 - 31 }), 'clock_before_issued');
  assertCode(() => selectReplayEpochKey(ring, { responseIssuedAt: 1500, now: 1500, destroyedEpochIds: [5] }), 'epoch_key_destroyed');
});

test('fake provider proves rotation, no root derivation, destruction, restore, and truthful retention', async () => {
  const provider = createFakeReplayKeyProvider({ now: () => 1000 });
  await provider.put(3, key(3));
  await provider.put(4, key(4));
  assert.deepEqual(await provider.get(3), key(3));
  assert.deepEqual(await provider.get(4), key(4));
  assert.notDeepEqual(await provider.get(3), await provider.get(4));
  assert.equal((await provider.get(3))[0], 3);
  assert.equal(await provider.get(5), null);
  const summary = redactedReplayRingSummary(parseReplayRingV1(JSON.stringify(await provider.binding())));
  assert.deepEqual(summary, { schema: REPLAY_RING_SCHEMA, primary: 4, epochs: [3, 4], key_bytes: 0 });
  assert.doesNotMatch(JSON.stringify(summary), /AwMDA|key_b64url|private|secret/i);
  await provider.destroy(3);
  assert.equal(await provider.get(3), null);
  await assert.rejects(provider.restore({ epoch_id: 3, key: key(3) }), (error) => error.code === 'destroyed_epoch');
  assert.equal(await provider.retrieveAfterDestroy(3), null);
  const retained = createFakeReplayKeyProvider({ retainedDeletedVersions: true });
  await retained.put(3, key(3));
  await retained.destroy(3);
  assert.equal((await retained.get(3))[0], 3);
  assert.equal((await provider.exposureBound()).seconds, 1230);
  assert.equal((await retained.exposureBound()).seconds, Number.POSITIVE_INFINITY);
  let expiredNow = 1000;
  const expired = createFakeReplayKeyProvider({ now: () => expiredNow });
  await expired.put(9, key(9), { expiresAt: 1999 });
  expiredNow = 2000;
  await assert.rejects(expired.get(9), (error) => error.code === 'expired_epoch');
  await assert.rejects(expired.restore({ epoch_id: 9, key: key(9) }), (error) => error.code === 'expired_epoch');
});

test('fake provider uses generation CAS with deterministic unavailable/conflict failpoints', async () => {
  const beforeRead = createFakeReplayKeyProvider({ failpoints: { unavailable_before_read: 1 } });
  await assert.rejects(beforeRead.get(1), (error) => error.code === 'unavailable');

  const beforeCas = createFakeReplayKeyProvider({ failpoints: { unavailable_before_cas: 1 } });
  await assert.rejects(beforeCas.put(1, key(1)), (error) => error.code === 'unavailable');
  assert.equal(await beforeCas.get(1), null);

  const provider = createFakeReplayKeyProvider();
  await provider.put(1, key(1));
  await assert.rejects(provider.put(1, key(2)), (error) => error.code === 'generation_conflict');
  const [winner, loser] = await Promise.allSettled([
    provider.compareAndSwap(1, 1, key(2)),
    provider.compareAndSwap(1, 1, key(3)),
  ]);
  assert.equal([winner, loser].filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal([winner, loser].filter((result) => result.reason?.code === 'generation_conflict').length, 1);
  assert.deepEqual(await provider.get(1), key(2));

  const afterCas = createFakeReplayKeyProvider({ failpoints: { unavailable_after_cas: 1 } });
  await assert.rejects(afterCas.put(2, key(2)), (error) => error.code === 'unavailable');
  assert.deepEqual(await afterCas.get(2), key(2));

  const duringDestroy = createFakeReplayKeyProvider({ failpoints: { unavailable_during_destroy: 1 } });
  await duringDestroy.put(3, key(3));
  await assert.rejects(duringDestroy.destroy(3), (error) => error.code === 'unavailable');
  assert.deepEqual(await duringDestroy.get(3), key(3));
  await duringDestroy.destroy(3);
  await assert.rejects(duringDestroy.put(3, key(4)), (error) => error.code === 'destroyed_epoch');
});

test('local binding rejects numeric normalization forms before JSON materialization', async () => {
  const { default: worker } = await import('./fixtures/m3-03-replay-provider-proof/worker.mjs?m3-local-binding-lexical');
  for (const primary of ['5e0', '5.0', '-0']) {
    const result = await worker.fetch(new Request('http://127.0.0.1/proof/binding', { headers: { 'x-skillmap-replay-raw-target': '/proof/binding' } }), {
      REPLAY_BINDING_SUMMARY: `{"schema":"${REPLAY_RING_SCHEMA}","primary":${primary},"epochs":[5]}`,
    });
    assert.equal(result.status, 503, primary);
    assert.deepEqual(await result.json(), { error: 'provider_unavailable' });
  }
});

test('workerd fixture serves only redacted ring proof and rejects provider/secret input', { timeout: 120000 }, async (t) => {
  if (!existsSync(wrangler)) return t.skip('candidate apps/web/node_modules/.bin/wrangler is unavailable');
  const temp = mkdtempSync(join(tmpdir(), 'skillmap-m303-workerd-'));
  const tempFixtureDir = join(temp, 'test', 'fixtures', 'm3-03-replay-provider-proof');
  mkdirSync(tempFixtureDir, { recursive: true });
  copyFileSync(join(fixtureDir, 'worker.mjs'), join(tempFixtureDir, 'worker.mjs'));
  copyFileSync(join(fixtureDir, 'wrangler.jsonc'), join(tempFixtureDir, 'wrangler.jsonc'));
  mkdirSync(join(temp, 'test', 'support'), { recursive: true });
  copyFileSync(join(root, 'test', 'support', 'm3-03-replay-provider-proof.mjs'), join(temp, 'test', 'support', 'm3-03-replay-provider-proof.mjs'));
  const configPath = join(tempFixtureDir, 'wrangler.jsonc');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env };
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[name];
  const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--no-bundle', '--config', configPath, '--persist-to', join(temp, 'persist'), '--port', String(port)], {
    cwd: tempFixtureDir, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { response = await fetch(`http://127.0.0.1:${port}/proof/binding`, { headers: { 'x-skillmap-replay-raw-target': '/proof/binding' } }); if (response.ok) break; } catch {}
      await delay(250);
    }
    assert.ok(response?.ok, `local Workerd did not become ready: ${stderr.slice(-500)}`);
    const binding = await fetch(`http://127.0.0.1:${port}/proof/binding`, { headers: { 'x-skillmap-replay-raw-target': '/proof/binding' } });
    assert.equal(binding.status, 200);
    const bindingBody = await binding.json();
    assert.deepEqual(bindingBody, { status: 'ok', schema: REPLAY_RING_SCHEMA, primary: 5, epochs: [5], key_bytes: 0 });
    assert.equal(binding.headers.get('x-skillmap-replay-proof'), 'local-only');

    const rawRing = JSON.stringify(validRing());
    const parsed = await fetch(`http://127.0.0.1:${port}/proof/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: rawRing,
    });
    assert.equal(parsed.status, 200);
    const body = await parsed.json();
    assert.deepEqual(body, { status: 'ok', schema: REPLAY_RING_SCHEMA, primary: 5, epochs: [5], key_bytes: 0 });
    assert.deepEqual(body, { status: 'ok', ...redactedReplayRingSummary(parseReplayRingV1(rawRing)) });
    assert.equal(parsed.headers.get('x-skillmap-replay-proof'), 'local-only');

    // The edge transport can reject a non-empty GET before the Worker sees it.
    // Exercise the Worker seam directly as well, with the same declared body
    // length and no body, to prove its own JSON fail-closed response.
    const directGetWithContentLength = await (await import('./fixtures/m3-03-replay-provider-proof/worker.mjs?m3-direct-get-content-length')).default.fetch(
      new Request('http://127.0.0.1/proof/binding', {
        headers: { 'content-length': '1', 'x-skillmap-replay-raw-target': '/proof/binding' },
      }),
      { REPLAY_BINDING_SUMMARY: '{"schema":"skillmap.device-auth.replay-ring.v1","primary":5,"epochs":[5]}' },
    );
    assert.equal(directGetWithContentLength.status, 400);
    assert.deepEqual(await directGetWithContentLength.json(), { error: 'invalid_request' });

    for (const alias of ['/proof/./binding', '/proof/../proof/binding', '/x/../proof/binding', '/proof/%2e/binding', '/proof/%2E%2E/proof/binding', '/x/%2e%2e/proof/binding']) {
      const rejected = rawCurl(port, alias, { headers: [`x-skillmap-replay-raw-target: ${alias}`] });
      assert.equal(rejected.status, 404, alias);
      assert.deepEqual(rejected.body, { error: 'not_found' });
    }
    const getBody = rawCurl(port, '/proof/binding', { headers: ['content-type: application/json', 'x-skillmap-replay-raw-target: /proof/binding'], body: rawRing });
    assert.equal(getBody.status, 400);
    assert.deepEqual(getBody.body, { error: 'invalid_request' });
    const getContentLength = await rawHttpRequest(port, '/proof/binding', { headers: ['content-length: 1', 'x-skillmap-replay-raw-target: /proof/binding'], body: 'x' });
    if (getContentLength.status === 400) {
      assert.equal(getContentLength.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(getContentLength.rawBody), { error: 'invalid_request' });
    } else {
      assert.equal(getContentLength.status, 500);
      assert.equal(getContentLength.rawBody, 'Error: Network connection lost.');
    }
    // Give curl an explicit empty upload so it writes the terminating zero-size
    // chunk. A bare Transfer-Encoding header can leave Workerd waiting for a
    // request body until the client-side timeout instead of exercising the
    // intended fail-closed request validation.
    const getChunked = rawCurl(port, '/proof/binding', { headers: ['transfer-encoding: chunked', 'x-skillmap-replay-raw-target: /proof/binding'], body: '' });
    assert.equal(getChunked.status, 400);
    assert.deepEqual(getChunked.body, { error: 'invalid_request' });

    const allowedQuery = await fetch(`http://127.0.0.1:${port}/proof/binding?key=secret`, { headers: { 'x-skillmap-replay-raw-target': '/proof/binding' } });
    assert.equal(allowedQuery.status, 400);
    assert.deepEqual(await allowedQuery.json(), { error: 'invalid_request' });
    const parseQuery = await fetch(`http://127.0.0.1:${port}/proof/parse?key=secret`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: rawRing });
    assert.equal(parseQuery.status, 400);
    assert.deepEqual(await parseQuery.json(), { error: 'invalid_request' });
    const wrongType = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'x-skillmap-replay-raw-target': '/proof/parse' }, body: rawRing });
    assert.equal(wrongType.status, 400);
    assert.deepEqual(await wrongType.json(), { error: 'invalid_request' });
    const wrongCharset = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: rawRing });
    assert.equal(wrongCharset.status, 400);
    assert.deepEqual(await wrongCharset.json(), { error: 'invalid_request' });
    const malformed = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: 'not-json' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'invalid_json' });
    const bom = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(rawRing)]) });
    assert.equal(bom.status, 400);
    assert.deepEqual(await bom.json(), { error: 'invalid_json' });
    const malformedRing = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: '{}' });
    assert.equal(malformedRing.status, 400);
    assert.deepEqual(await malformedRing.json(), { error: 'invalid_ring' });
    const duplicate = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: '{"schema":"skillmap.device-auth.replay-ring.v1","schema":"skillmap.device-auth.replay-ring.v1","primary":5,"keys":[{"epoch_id":5,"key_b64url":"BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"}]}' });
    assert.equal(duplicate.status, 400);
    assert.deepEqual(await duplicate.json(), { error: 'invalid_ring' });
    const exactlyBounded = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: `${rawRing}${' '.repeat(1024 - Buffer.byteLength(rawRing))}` });
    assert.equal(exactlyBounded.status, 200);
    assert.deepEqual(await exactlyBounded.json(), { status: 'ok', schema: REPLAY_RING_SCHEMA, primary: 5, epochs: [5], key_bytes: 0 });
    const oversized = await fetch(`http://127.0.0.1:${port}/proof/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skillmap-replay-raw-target': '/proof/parse' }, body: ' '.repeat(1025) });
    assert.equal(oversized.status, 400);
    assert.deepEqual(await oversized.json(), { error: 'invalid_request' });
    for (const [method, path] of [
      ['GET', '/'], ['POST', '/proof/binding'], ['GET', '/proof/parse'], ['DELETE', '/proof/binding'], ['GET', '/proof/other'], ['POST', '/proof/other'],
    ]) {
      const rejected = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined, body: method === 'POST' ? rawRing : undefined });
      assert.equal(rejected.status, 404, `${method} ${path}`);
      assert.deepEqual(await rejected.json(), { error: 'not_found' });
    }
    assert.doesNotMatch(`${stdout}\n${stderr}`, /sk-[A-Za-z0-9]|CLOUDFLARE_API_TOKEN|key_b64url|AwMDA/);
  } finally {
    terminateProcessTree(child, 'SIGTERM');
    await waitForProcessExit(child, 5000);
    if (!hasExited(child)) terminateProcessTree(child, 'SIGKILL');
    if (!hasExited(child)) await waitForProcessExit(child, 2000);
    assert.equal(hasExited(child), true, 'local Workerd process must terminate during cleanup');
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
    rmSync(temp, { recursive: true, force: true });
  }
});

test('wrangler dry-run config remains local and does not contact a provider', () => {
  if (!existsSync(wrangler)) return;
  const env = { ...process.env };
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) delete env[name];
  const temp = mkdtempSync(join(tmpdir(), 'skillmap-m303-dry-run-'));
  const tempFixtureDir = join(temp, 'fixture');
  mkdirSync(tempFixtureDir, { recursive: true });
  const configPath = join(tempFixtureDir, 'wrangler.jsonc');
  copyFileSync(join(fixtureDir, 'worker.mjs'), join(tempFixtureDir, 'worker.mjs'));
  copyFileSync(join(fixtureDir, 'wrangler.jsonc'), configPath);
  try {
    const result = spawnSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', configPath], { cwd: tempFixtureDir, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Uploading|Deployed|https:\/\/api\.cloudflare\.com/i);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
