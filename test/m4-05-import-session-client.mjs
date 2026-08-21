import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ImportClient,
  ImportClientError,
  MAX_IMPORT_BYTE_TOTAL,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_COUNT
} from '../dist/network/import-client.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';

const ORIGIN = 'https://skillmap.example.test';
const DEVICE_ID = 'D'.repeat(22);
const ACCESS_TOKEN = 'T'.repeat(43);
const SKILL_ID = `msk_${'a'.repeat(32)}`;
const VERSION_ID = `msv_${'a'.repeat(32)}`;
const SESSION_ID = `imp_${'a'.repeat(32)}`;
const FILE_ID = `msf_${'a'.repeat(32)}`;
const RELEASE_ID = `msr_${'a'.repeat(32)}`;
const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const CONTENT_DIGEST = `sha256:${'2'.repeat(64)}`;
const EXPIRES_AT = '2026-08-20T12:00:00Z';

async function makeClient(fetchFn, options = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  return new ImportClient({
    origin: ORIGIN,
    keyStore,
    deviceId: DEVICE_ID,
    fetchFn,
    ...options
  });
}

function sessionBody(overrides = {}) {
  return {
    session_public_id: SESSION_ID,
    state: 'in_progress',
    expected_file_count: 2,
    expected_byte_total: 8,
    accepted_file_count: 0,
    accepted_byte_total: 0,
    revision: 1,
    expires_at: EXPIRES_AT,
    ...overrides
  };
}

function validSessionResponse() {
  return new Response(JSON.stringify(sessionBody()), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function assertProofHeaders(headers, { idempotencyKey, accessToken } = {}) {
  assert.equal(headers['X-SkillMap-Device-Id'], DEVICE_ID);
  assert.equal(headers['X-SkillMap-Device-Audience'], 'skillmap.connector.v1');
  assert.equal(headers['X-SkillMap-Device-Proof-Suite'], 'skillmap.ecdsa-p256-sha256.v2');
  assert.equal(headers['X-SkillMap-Device-Purpose'], 'protected.import');
  assert.match(headers['X-SkillMap-Device-Nonce'], /^[A-Za-z0-9_-]{22}$/);
  assert.match(headers['X-SkillMap-Device-Issued-At'], /^\d+$/);
  assert.match(headers['X-SkillMap-Device-Body-SHA256'], /^sha256:[0-9a-f]{64}$/);
  assert.match(headers['X-SkillMap-Device-Proof'], /^[A-Za-z0-9_-]{86}$/);
  assert.match(headers['X-Request-Id'], /^[A-Za-z0-9_-]{22}$/);
  if (idempotencyKey) {
    assert.equal(headers['Idempotency-Key'], idempotencyKey);
  }
  if (accessToken) {
    assert.equal(headers.Authorization, `Bearer ${accessToken}`);
  }
}

function errorResponse(status, code, retryAfter = 0) {
  return new Response(JSON.stringify({
    error: code,
    error_description: '',
    retry_after: retryAfter
  }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('M4.05 beginImportSession calls the correct API route with proof headers and idempotency key', async () => {
  let captured;
  const client = await makeClient(async (url, init) => {
    captured = { url, init };
    return validSessionResponse();
  });
  const providedKey = 'A'.repeat(22);
  const session = await client.beginImportSession({
    skillPublicId: SKILL_ID,
    versionPublicId: VERSION_ID,
    manifestSchemaVersion: '1.0',
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    expectedFileCount: 2,
    expectedByteTotal: 8,
    idempotencyKey: providedKey,
    expiresAt: EXPIRES_AT
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(captured.url, `${ORIGIN}/api/import/v1/sessions`);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.redirect, 'error');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.skill_public_id, SKILL_ID);
  assert.equal(body.version_public_id, VERSION_ID);
  assert.equal(body.manifest_schema_version, '1.0');
  assert.equal(body.manifest_digest, MANIFEST_DIGEST);
  assert.equal(body.content_digest, CONTENT_DIGEST);
  assert.equal(body.expected_file_count, 2);
  assert.equal(body.expected_byte_total, 8);
  assert.equal(body.idempotency_key, providedKey);
  assert.equal(body.expires_at, EXPIRES_AT);
  assertProofHeaders(captured.init.headers, { idempotencyKey: providedKey, accessToken: ACCESS_TOKEN });

  assert.equal(session.sessionPublicId, SESSION_ID);
  assert.equal(session.state, 'in_progress');
  assert.equal(session.expectedFileCount, 2);
  assert.equal(session.revision, 1);
});

test('M4.05 beginImportSession preserves the stored pre-finalization revision on verified replay', async () => {
  const client = await makeClient(async () => new Response(JSON.stringify(sessionBody({
    state: 'verified',
    accepted_file_count: 2,
    accepted_byte_total: 8,
    revision: 4,
    finalization_expected_revision: 3
  })), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));

  const session = await client.beginImportSession({
    skillPublicId: SKILL_ID,
    versionPublicId: VERSION_ID,
    manifestSchemaVersion: '1.0',
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    expectedFileCount: 2,
    expectedByteTotal: 8,
    idempotencyKey: 'R'.repeat(22),
    expiresAt: EXPIRES_AT
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(session.state, 'verified');
  assert.equal(session.revision, 4);
  assert.equal(session.finalizationExpectedRevision, 3);
});

test('M4.05 normalizes a trailing slash before building protected import URLs', async () => {
  let capturedUrl;
  const client = await makeClient(async (url) => {
    capturedUrl = url;
    return validSessionResponse();
  }, { origin: `${ORIGIN}/` });

  await client.beginImportSession({
    skillPublicId: SKILL_ID,
    versionPublicId: VERSION_ID,
    manifestSchemaVersion: '1.0',
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    expectedFileCount: 2,
    expectedByteTotal: 8,
    idempotencyKey: 'N'.repeat(22),
    expiresAt: EXPIRES_AT
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(client.origin, ORIGIN);
  assert.equal(capturedUrl, `${ORIGIN}/api/import/v1/sessions`);
});

test('M4.05 prepareImportTarget sends the canonical projection and validates public file bindings', async () => {
  let captured;
  const client = await makeClient(async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      skill_public_id: SKILL_ID,
      version_public_id: VERSION_ID,
      release_public_id: RELEASE_ID,
      manifest_digest: MANIFEST_DIGEST,
      content_digest: CONTENT_DIGEST,
      file_count: 1,
      byte_total: 4,
      reused: false,
      files: [{
        file_public_id: FILE_ID,
        relative_path: 'SKILL.md',
        media_type: 'text/plain',
        byte_size: 4,
        file_digest: MANIFEST_DIGEST,
        storage_key: `v1/${VERSION_ID}/${FILE_ID}`,
        executable: false,
        ordinal: 0
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const key = 'P'.repeat(22);
  const targetParams = {
    displayName: 'F'.repeat(200),
    description: 'Fixture description',
    manifestSchemaVersion: '1.0',
    canonicalManifestBytes: new TextEncoder().encode('{"schema_version":"1.0"}\n'),
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    canonicalMetadata: { identity: { public_id: 'fixture' } },
    source: { kind: 'local' },
    provenanceState: 'verified',
    files: [{ relativePath: 'SKILL.md', mediaType: 'text/plain', byteSize: 4, fileDigest: MANIFEST_DIGEST, executable: false, ordinal: 0 }],
    idempotencyKey: key
  };
  const target = await client.prepareImportTarget(targetParams, { accessToken: ACCESS_TOKEN });

  assert.equal(captured.url, `${ORIGIN}/api/import/v1/targets`);
  const body = JSON.parse(captured.init.body);
  assert.equal(Buffer.from(body.manifest_projection_base64, 'base64').toString(), '{"schema_version":"1.0"}\n');
  assert.equal(body.files[0].relative_path, 'SKILL.md');
  assert.equal(body.display_name.length, 200);
  assert.equal(captured.init.headers['Idempotency-Key'], key);
  assert.equal(target.versionPublicId, VERSION_ID);
  assert.equal(target.files[0].storageKey, `v1/${VERSION_ID}/${FILE_ID}`);

  const astralDisplayName = '🧭'.repeat(200);
  await client.prepareImportTarget({ ...targetParams, displayName: astralDisplayName }, { accessToken: ACCESS_TOKEN });
  assert.equal(JSON.parse(captured.init.body).display_name, astralDisplayName);

  await assert.rejects(
    client.prepareImportTarget({ ...targetParams, displayName: 'F'.repeat(201) }, { accessToken: ACCESS_TOKEN }),
    (error) => error instanceof ImportClientError && error.code === 'invalid_request'
  );
});

test('M4.05 default payload ceilings support the maximum 2,048-file target projection', async () => {
  let requestBytes = 0;
  const files = Array.from({ length: MAX_IMPORT_FILE_COUNT }, (_, ordinal) => {
    const suffix = ordinal.toString(16).padStart(8, '0');
    const relativePath = `${'directory/'.repeat(50)}${suffix}.md`;
    const filePublicId = `msf_${ordinal.toString(16).padStart(32, '0')}`;
    return {
      relativePath,
      mediaType: 'text/markdown; charset=utf-8',
      byteSize: 0,
      fileDigest: MANIFEST_DIGEST,
      executable: false,
      ordinal,
      filePublicId,
      storageKey: `v1/${VERSION_ID}/${filePublicId}`
    };
  });
  const client = await makeClient(async (_url, init) => {
    requestBytes = new TextEncoder().encode(init.body).byteLength;
    return new Response(JSON.stringify({
      skill_public_id: SKILL_ID,
      version_public_id: VERSION_ID,
      release_public_id: RELEASE_ID,
      manifest_digest: MANIFEST_DIGEST,
      content_digest: CONTENT_DIGEST,
      file_count: files.length,
      byte_total: 0,
      reused: false,
      files: files.map((file) => ({
        file_public_id: file.filePublicId,
        relative_path: file.relativePath,
        media_type: file.mediaType,
        byte_size: file.byteSize,
        file_digest: file.fileDigest,
        storage_key: file.storageKey,
        executable: file.executable,
        ordinal: file.ordinal
      }))
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const target = await client.prepareImportTarget({
    displayName: 'Maximum target',
    description: '',
    manifestSchemaVersion: '1.0',
    canonicalManifestBytes: new Uint8Array(262_144).fill(65),
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    canonicalMetadata: { logical_id: 'maximum-target', display_name: 'Maximum target' },
    source: { authority: 'local', kind: 'directory', namespace: 'test', source_id: 'maximum', revision: '1' },
    provenanceState: 'provisional',
    files: files.map(({ filePublicId: _filePublicId, storageKey: _storageKey, ...file }) => file),
    idempotencyKey: 'M'.repeat(22)
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(requestBytes > 256 * 1024, true);
  assert.equal(target.files.length, MAX_IMPORT_FILE_COUNT);
});

test('M4.05 idempotent retries return the same session and keep the idempotency key stable', async () => {
  const attempts = [];
  const client = await makeClient(async (url, init) => {
    attempts.push({ url, headers: init.headers, nonce: init.headers['X-SkillMap-Device-Nonce'] });
    if (attempts.length === 1) {
      return errorResponse(503, 'temporarily_unavailable', 0);
    }
    return validSessionResponse();
  }, { maxRetries: 2 });
  const providedKey = 'B'.repeat(22);
  const session = await client.beginImportSession({
    skillPublicId: SKILL_ID,
    versionPublicId: VERSION_ID,
    manifestSchemaVersion: '1.0',
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    expectedFileCount: 1,
    expectedByteTotal: 4,
    idempotencyKey: providedKey,
    expiresAt: EXPIRES_AT
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].headers['Idempotency-Key'], providedKey);
  assert.equal(attempts[1].headers['Idempotency-Key'], providedKey);
  assert.equal(attempts[0].headers['X-Request-Id'], attempts[1].headers['X-Request-Id']);
  assert.notEqual(attempts[0].nonce, attempts[1].nonce);
  assert.equal(session.sessionPublicId, SESSION_ID);
});

test('M4.05 rejects invalid/oversized/expired request parameters before network', async () => {
  const client = await makeClient(async () => validSessionResponse());
  const valid = {
    skillPublicId: SKILL_ID,
    versionPublicId: VERSION_ID,
    manifestSchemaVersion: '1.0',
    manifestDigest: MANIFEST_DIGEST,
    contentDigest: CONTENT_DIGEST,
    expectedFileCount: 1,
    expectedByteTotal: 4,
    expiresAt: EXPIRES_AT
  };

  await assert.rejects(
    client.beginImportSession({ ...valid, expectedFileCount: 0 }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
  await assert.rejects(
    client.beginImportSession({ ...valid, expectedFileCount: MAX_IMPORT_FILE_COUNT + 1 }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
  await assert.rejects(
    client.beginImportSession({ ...valid, expectedByteTotal: -1 }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
  await assert.rejects(
    client.beginImportSession({ ...valid, expectedByteTotal: MAX_IMPORT_BYTE_TOTAL + 1 }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
  await assert.rejects(
    client.beginImportSession({ ...valid, expiresAt: 'not-iso' }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
  await assert.rejects(
    client.beginImportSession({ ...valid, manifestDigest: 'bad:digest' }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_request'
  );
});

test('M4.05 uses the accepted M1.03 import bounds', () => {
  assert.equal(MAX_IMPORT_FILE_COUNT, 2_048);
  assert.equal(MAX_IMPORT_FILE_BYTES, 16_777_216);
  assert.equal(MAX_IMPORT_BYTE_TOTAL, 67_108_864);
});

test('M4.05 rejects responses containing internal or foreign identifiers and unknown fields', async () => {
  const client = await makeClient(async () => new Response(JSON.stringify({
    ...sessionBody(),
    id: 123,
    account_id: 'internal'
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  await assert.rejects(
    client.beginImportSession({
      skillPublicId: SKILL_ID,
      versionPublicId: VERSION_ID,
      manifestSchemaVersion: '1.0',
      manifestDigest: MANIFEST_DIGEST,
      contentDigest: CONTENT_DIGEST,
      expectedFileCount: 1,
      expectedByteTotal: 4,
      expiresAt: EXPIRES_AT
    }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'invalid_response'
  );
});

test('M4.05 resume, finalize, expire, prepare, accept, and list call the correct routes and validate responses', async () => {
  const paths = [];
  const client = await makeClient(async (url, init) => {
    paths.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/resume')) {
      return validSessionResponse();
    }
    if (url.includes('/finalize')) {
      return new Response(JSON.stringify({
        session_public_id: SESSION_ID,
        state: 'verified',
        verification_digest: MANIFEST_DIGEST
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/expire')) {
      return new Response(JSON.stringify({
        ...sessionBody(),
        state: 'expired'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/prepare-upload')) {
      return new Response(JSON.stringify({
        session_public_id: SESSION_ID,
        file_public_id: FILE_ID,
        version_public_id: VERSION_ID,
        bucket_id: 'skill-vault-private',
        object_name: `v1/${VERSION_ID}/${FILE_ID}`,
        upload_url: `${ORIGIN}/storage/v1/object/skill-vault-private/v1/${VERSION_ID}/${FILE_ID}`,
        upload_expires_at: EXPIRES_AT,
        content_type: 'text/plain',
        declared_size: 4
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/accept')) {
      return new Response(JSON.stringify({
        ...sessionBody(),
        accepted_file_count: 1,
        accepted_byte_total: 4,
        revision: 2
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/receipts')) {
      return new Response(JSON.stringify({
        session_public_id: SESSION_ID,
        receipts: [{
          file_public_id: FILE_ID,
          relative_path: 'test.txt',
          accepted_byte_size: 4,
          file_digest: MANIFEST_DIGEST,
          ordinal: 0
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });

  const resumed = await client.resumeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 1 }, { accessToken: ACCESS_TOKEN });
  assert.equal(resumed.sessionPublicId, SESSION_ID);

  const finalized = await client.finalizeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 2 }, { accessToken: ACCESS_TOKEN });
  assert.equal(finalized.state, 'verified');
  assert.equal(finalized.verificationDigest, MANIFEST_DIGEST);

  const expired = await client.expireImportSession({ sessionPublicId: SESSION_ID }, { accessToken: ACCESS_TOKEN });
  assert.equal(expired.state, 'expired');

  const prepared = await client.prepareUpload({ sessionPublicId: SESSION_ID, filePublicId: FILE_ID, expectedRevision: 1 }, { accessToken: ACCESS_TOKEN });
  assert.equal(prepared.objectName, `v1/${VERSION_ID}/${FILE_ID}`);

  const accepted = await client.acceptFile({
    sessionPublicId: SESSION_ID,
    filePublicId: FILE_ID,
    expectedRevision: 1,
    fileDigest: MANIFEST_DIGEST,
    byteSize: 4
  }, { accessToken: ACCESS_TOKEN });
  assert.equal(accepted.revision, 2);

  const listed = await client.listReceipts({ sessionPublicId: SESSION_ID, expectedRevision: 2 }, { accessToken: ACCESS_TOKEN });
  assert.equal(listed.receipts.length, 1);
  assert.equal(listed.receipts[0].filePublicId, FILE_ID);

  assert.equal(paths.length, 6);
});

test('M4.05 maps HTTP errors to stable typed codes without leaking server details', async () => {
  const cases = [
    { status: 401, code: 'unauthorized' },
    { status: 403, code: 'insufficient_scope' },
    { status: 404, code: 'session_not_found' },
    { status: 409, code: 'session_conflict' },
    { status: 410, code: 'session_expired' },
    { status: 429, code: 'rate_limited' },
    { status: 503, code: 'temporarily_unavailable' }
  ];
  for (const { status, code } of cases) {
    const client = await makeClient(async () => errorResponse(status, code, 0));
    await assert.rejects(
      client.resumeImportSession({ sessionPublicId: SESSION_ID }, { accessToken: ACCESS_TOKEN }),
      (err) => {
        assert.ok(err instanceof ImportClientError);
        assert.equal(err.code, code);
        assert.equal(err.status, status);
        assert.doesNotMatch(err.message, /internal-secret/);
        return true;
      }
    );
  }
});

test('M4.05 honors bounded timeout and does not hang on a stalled transport', async () => {
  const client = await makeClient(async () => new Promise(() => {}), { timeoutMs: 50, maxRetries: 0 });
  await assert.rejects(
    client.resumeImportSession({ sessionPublicId: SESSION_ID }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'temporarily_unavailable'
  );
});

test('M4.05 rejects non-JSON, malformed, and success-without-required-field responses', async () => {
  const responses = [
    new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response(JSON.stringify(['not', 'an', 'object']), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ state: 'in_progress' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ ...sessionBody(), state: 'unknown_state' }), { status: 200, headers: { 'content-type': 'application/json' } })
  ];
  for (const response of responses) {
    const client = await makeClient(async () => response, { maxRetries: 0 });
    await assert.rejects(
      client.resumeImportSession({ sessionPublicId: SESSION_ID }, { accessToken: ACCESS_TOKEN }),
      (err) => err instanceof ImportClientError && err.code === 'invalid_response'
    );
  }
});
