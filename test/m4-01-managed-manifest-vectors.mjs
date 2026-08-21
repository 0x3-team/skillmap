import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalizeManagedManifest,
  isValidManagedManifestPath,
  MANIFEST_DIGEST_MISMATCH,
  MANIFEST_INVALID_PATH,
  MANIFEST_LIMIT_EXCEEDED,
  MANIFEST_PATH_COLLISION,
  MANIFEST_REQUIRED_FIELD,
  MANIFEST_TYPE_MISMATCH,
  MANIFEST_UNKNOWN_FIELD,
  MANIFEST_UNSUPPORTED_VERSION,
  ManagedManifestError
} from '../dist/core/managed-manifest.js';

const SKILL_DIGEST = 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const Z_TXT_DIGEST = 'sha256:7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed';

function baseManifest() {
  return {
    schema_version: '1.0',
    identity: { logical_id: 'alpha-helper', public_id: 'pub_alpha_01' },
    display: { name: 'Alpha Helper', description: 'Use for alpha work.' },
    source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha-helper', revision: 'rev-1' },
    files: [
      { path: 'SKILL.md', media_type: 'text/markdown; charset=utf-8', utf8_bytes: 5, digest: SKILL_DIGEST, executable: false },
      { path: 'z.txt', media_type: 'text/plain', utf8_bytes: 3, digest: Z_TXT_DIGEST, executable: false }
    ],
    provenance: { publisher_id: 'local-owner', ingest_id: 'ingest-1', created_at: '2026-08-01T00:00:00Z' },
    compatibility: { manifest_major: 1, minimum_consumer_major: 1 }
  };
}

const V1_CANONICAL_HEX = '7b22636f6d7061746962696c697479223a7b226d616e69666573745f6d616a6f72223a312c226d696e696d756d5f636f6e73756d65725f6d616a6f72223a317d2c22646973706c6179223a7b226465736372697074696f6e223a2255736520666f7220616c70686120776f726b2e222c226e616d65223a22416c7068612048656c706572227d2c2266696c6573223a5b7b22646967657374223a227368613235363a32636632346462613566623061333065323665383362326163356239653239653162313631653563316661373432356537333034333336323933386239383234222c2265786563757461626c65223a66616c73652c226d656469615f74797065223a22746578742f6d61726b646f776e3b20636861727365743d7574662d38222c2270617468223a22534b494c4c2e6d64222c22757466385f6279746573223a357d2c7b22646967657374223a227368613235363a37363932633361643335343062623830336330323062336165653636636438383837313233323334656130633665373134336330616464373366663433316564222c2265786563757461626c65223a66616c73652c226d656469615f74797065223a22746578742f706c61696e222c2270617468223a227a2e747874222c22757466385f6279746573223a337d5d2c226964656e74697479223a7b226c6f676963616c5f6964223a22616c7068612d68656c706572222c227075626c69635f6964223a227075625f616c7068615f3031227d2c2270726f76656e616e6365223a7b22637265617465645f6174223a22323032362d30382d30315430303a30303a30305a222c22696e676573745f6964223a22696e676573742d31222c227075626c69736865725f6964223a226c6f63616c2d6f776e6572227d2c22736368656d615f76657273696f6e223a22312e30222c22736f75726365223a7b22617574686f72697479223a226d616e61676564222c226b696e64223a226c6f63616c222c226e616d657370616365223a226f776e6572222c227265766973696f6e223a227265762d31222c22736f757263655f6964223a22616c7068612d68656c706572227d7d';
const V1_MANIFEST_DIGEST = 'sha256:d5f665936d3e01f96a3b7ce0ad2ad6af3294661491c3d4b0b1fa6eb4cbcc93d4';

test('V1 canonical projection matches the M1.03 golden bytes and manifest digest', () => {
  const result = canonicalizeManagedManifest(baseManifest());
  assert.equal(result.canonicalBytes.toString('hex'), V1_CANONICAL_HEX);
  assert.equal(result.manifest.manifest_digest, V1_MANIFEST_DIGEST);
});

test('V2 reordered input and reversed file list produce the same V1 canonical bytes and digest', () => {
  const input = {
    provenance: { created_at: '2026-08-01T00:00:00Z', ingest_id: 'ingest-1', publisher_id: 'local-owner' },
    source: { source_id: 'alpha-helper', revision: 'rev-1', namespace: 'owner', kind: 'local', authority: 'managed' },
    schema_version: '1.0',
    display: { name: 'Alpha Helper', description: 'Use for alpha work.' },
    identity: { public_id: 'pub_alpha_01', logical_id: 'alpha-helper' },
    compatibility: { minimum_consumer_major: 1, manifest_major: 1 },
    files: [
      { path: 'z.txt', media_type: 'text/plain', utf8_bytes: 3, digest: Z_TXT_DIGEST, executable: false },
      { executable: false, digest: SKILL_DIGEST, utf8_bytes: 5, media_type: 'text/markdown; charset=utf-8', path: 'SKILL.md' }
    ]
  };
  const result = canonicalizeManagedManifest(input);
  assert.equal(result.canonicalBytes.toString('hex'), V1_CANONICAL_HEX);
  assert.equal(result.manifest.manifest_digest, V1_MANIFEST_DIGEST);
});

test('V3 changed file bytes produce a different canonical digest', () => {
  const input = baseManifest();
  input.files[1].digest = 'sha256:3fc4ccfe745870e2c0d99f71f30ff0656c8dedd41cc1d7d3d376b0dbe685e2f3';
  const result = canonicalizeManagedManifest(input);
  assert.notEqual(result.canonicalBytes.toString('hex'), V1_CANONICAL_HEX);
  assert.notEqual(result.manifest.manifest_digest, V1_MANIFEST_DIGEST);
});

test('an empty display description remains valid under the canonical schema', () => {
  const input = baseManifest();
  input.display.description = '';
  const result = canonicalizeManagedManifest(input);
  assert.equal(result.manifest.display.description, '');
});

test('canonicalizer verifies a claimed manifest_digest and rejects mismatches', () => {
  const input = baseManifest();
  input.manifest_digest = 'sha256:' + '0'.repeat(64);
  assert.throws(
    () => canonicalizeManagedManifest(input),
    (error) => error instanceof ManagedManifestError && error.code === MANIFEST_DIGEST_MISMATCH && error.field === 'manifest_digest'
  );
});

function expectCode(fn, code, field) {
  return assert.throws(
    fn,
    (error) => error instanceof ManagedManifestError && error.code === code && (field === undefined || error.field === field)
  );
}

test('closed schema rejects unknown top-level and nested fields', () => {
  expectCode(() => {
    const input = baseManifest();
    input.extra_field = 1;
    canonicalizeManagedManifest(input);
  }, MANIFEST_UNKNOWN_FIELD, 'extra_field');

  expectCode(() => {
    const input = baseManifest();
    input.display.extra = 'x';
    canonicalizeManagedManifest(input);
  }, MANIFEST_UNKNOWN_FIELD, 'display');
});

test('schema version is required and major-only acceptance is bounded', () => {
  expectCode(() => canonicalizeManagedManifest({ ...baseManifest(), schema_version: undefined }), MANIFEST_REQUIRED_FIELD, 'schema_version');
  expectCode(() => canonicalizeManagedManifest({ ...baseManifest(), schema_version: '2.0' }), MANIFEST_UNSUPPORTED_VERSION, 'schema_version');
  expectCode(() => canonicalizeManagedManifest({ ...baseManifest(), schema_version: '1.0.0' }), MANIFEST_UNSUPPORTED_VERSION, 'schema_version');
});

test('path grammar and collision rules reject traversal, absolute, backslash, empty segments, and NFD/case aliases', () => {
  const invalidPaths = [
    '../escape',
    '/absolute',
    'C:/drive',
    'file:payload.txt',
    'dir/%2e%2e/secret.txt',
    'control\u0001.txt',
    'dir\\\\backslash',
    'dir//double',
    'dir/./dot',
    'dir/../dotdot',
    'dir/',
    '',
    'cafe\u0301/NFD'
  ];
  for (const badPath of invalidPaths) {
    expectCode(() => {
      const input = baseManifest();
      input.files[0].path = badPath;
      canonicalizeManagedManifest(input);
    }, MANIFEST_INVALID_PATH, 'files[0].path');
  }
});

test('path collision rejects exact and case-fold duplicates', () => {
  expectCode(() => {
    const input = baseManifest();
    input.files.push({ ...input.files[0], path: 'skill.md' });
    canonicalizeManagedManifest(input);
  }, MANIFEST_PATH_COLLISION, 'files[2].path');

  for (const [first, second] of [
    ['Straße.txt', 'STRASSE.txt'],
    ['ΟΣ.txt', 'ος.txt'],
    ['ſource.txt', 'source.txt'],
    ['µ.txt', 'Μ.txt']
  ]) {
    expectCode(() => {
      const input = baseManifest();
      input.files = [
        { ...input.files[0], path: first },
        { ...input.files[1], path: second }
      ];
      canonicalizeManagedManifest(input);
    }, MANIFEST_PATH_COLLISION, 'files[1].path');
  }
});

test('public IDs use the schema grammar and source/provenance honor 512-byte contract bounds', () => {
  expectCode(() => {
    const input = baseManifest();
    input.identity.public_id = 'pub invalid!';
    canonicalizeManagedManifest(input);
  }, MANIFEST_TYPE_MISMATCH, 'identity.public_id');

  const boundary = baseManifest();
  boundary.source.authority = 'a'.repeat(512);
  boundary.provenance.publisher_id = 'p'.repeat(512);
  assert.doesNotThrow(() => canonicalizeManagedManifest(boundary));

  expectCode(() => {
    const input = baseManifest();
    input.source.authority = 'a'.repeat(513);
    canonicalizeManagedManifest(input);
  }, MANIFEST_LIMIT_EXCEEDED, 'source.authority');
});

test('bounds reject empty files list, oversized counts, and oversized strings', () => {
  expectCode(() => {
    const input = baseManifest();
    input.files = [];
    canonicalizeManagedManifest(input);
  }, MANIFEST_LIMIT_EXCEEDED, 'files');

  expectCode(() => {
    const input = baseManifest();
    input.files = Array.from({ length: 2049 }, (_, i) => ({ ...baseManifest().files[0], path: `f${i}.txt` }));
    canonicalizeManagedManifest(input);
  }, MANIFEST_LIMIT_EXCEEDED, 'files');

  expectCode(() => {
    const input = baseManifest();
    input.files[0].path = 'a/'.repeat(257) + 'x.txt';
    canonicalizeManagedManifest(input);
  }, MANIFEST_INVALID_PATH, 'files[0].path');
});

test('path validation helper rejects non-canonical spellings independently', () => {
  assert.ok(isValidManagedManifestPath('SKILL.md').ok);
  assert.equal(isValidManagedManifestPath('../escape').code, MANIFEST_INVALID_PATH);
  assert.equal(isValidManagedManifestPath('dir\\\\file').code, MANIFEST_INVALID_PATH);
});
