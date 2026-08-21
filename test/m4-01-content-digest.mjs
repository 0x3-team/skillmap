import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  canonicalizeManagedManifest,
  MANIFEST_INVALID_PATH,
  MANIFEST_PATH_COLLISION,
  ManagedManifestError
} from '../dist/core/managed-manifest.js';
import {
  encodeContentDigest,
  ImmutableContentDigestError,
  INVALID_DIGEST,
  DIGEST_MISMATCH,
  SIZE_MISMATCH
} from '../dist/core/immutable-content-digest.js';
import {
  DEFAULT_SKILL_FILESYSTEM_LIMITS,
  SkillFilesystemLimitError
} from '../dist/core/skill-tree-limits.js';

const HELLO_DIGEST = 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const EMPTY_DIGEST = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HELLO_NEWLINE_DIGEST = 'sha256:c865f6c5ab8d1b0bcd383a5e1e3879d22681c96bf462c269b7581d523fbe70ab';

const CONTENT_DIGEST_ONE = 'sha256:68c182ef53dc673c1550e99e9e660e1b27cf551e66eba22feb9078bfb46ef64d';
const CONTENT_DIGEST_EMPTY = 'sha256:59e0790e8a749ad0aae2aa557583b74cc2e1e11d66d99a053967d4f088df7826';
const CONTENT_DIGEST_TWO = 'sha256:70f084ef0f776f1fd7bab4ca44c31d96d9858bdcbb35a86ad6c3750a462d5e49';

const ENVELOPE_ONE_HEX = '736b696c6c6d61702e736b696c6c2d76657273696f6e007631006d616e69666573742d64696765737400763100f0c0096932205e94c7eabfbdf27275b716ec6381c54608f4b5f876576f375b5f0000000166696c652d656e747279007631000000000968656c6c6f2e747874000000000000000566696c652d646967657374007631002cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function sha256(bytes) {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

function baseManifest(files) {
  return {
    schema_version: '1.0',
    identity: { logical_id: 'alpha-helper', public_id: 'pub_alpha_01' },
    display: { name: 'Alpha Helper', description: 'Use for alpha work.' },
    source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha-helper', revision: 'rev-1' },
    files,
    provenance: { publisher_id: 'local-owner', ingest_id: 'ingest-1', created_at: '2026-08-01T00:00:00Z' },
    compatibility: { manifest_major: 1, minimum_consumer_major: 1 }
  };
}

function manifestFile(path, bytes) {
  return {
    path,
    media_type: 'text/plain',
    utf8_bytes: bytes.length,
    digest: sha256(bytes),
    executable: false
  };
}

function oneFileManifest() {
  return baseManifest([manifestFile('hello.txt', Buffer.from('hello', 'utf8'))]);
}

function twoFileManifest() {
  return baseManifest([
    manifestFile('a.txt', Buffer.from('a', 'utf8')),
    manifestFile('b.txt', Buffer.from('b', 'utf8'))
  ]);
}

function assertThrowsCode(fn, ErrorClass, code, field) {
  return assert.throws(
    fn,
    (error) => error instanceof ErrorClass && error.code === code && (field === undefined || error.field === field)
  );
}

function assertThrowsLimit(fn, limit) {
  return assert.throws(
    fn,
    (error) => error instanceof SkillFilesystemLimitError && error.limit === limit
  );
}

test('one accepted file yields the canonical content digest, file digest, and exact envelope bytes', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  const result = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8') }
  ]);
  assert.equal(result.manifestDigest, manifestDigest);
  assert.equal(result.contentDigest, CONTENT_DIGEST_ONE);
  assert.equal(result.envelope.toString('hex'), ENVELOPE_ONE_HEX);
  assert.deepEqual(result.fileDigests, [HELLO_DIGEST]);
});

test('empty accepted file set yields the canonical content digest with count zero', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  const result = encodeContentDigest(canonicalBytes, manifestDigest, []);
  assert.equal(result.contentDigest, CONTENT_DIGEST_EMPTY);
  assert.equal(result.fileDigests.length, 0);
});

test('order invariance: two files supplied in opposite orders produce the same content digest', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(twoFileManifest());
  const first = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'a.txt', bytes: Buffer.from('a', 'utf8') },
    { path: 'b.txt', bytes: Buffer.from('b', 'utf8') }
  ]);
  const second = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'b.txt', bytes: Buffer.from('b', 'utf8') },
    { path: 'a.txt', bytes: Buffer.from('a', 'utf8') }
  ]);
  assert.equal(first.contentDigest, CONTENT_DIGEST_TWO);
  assert.equal(second.contentDigest, CONTENT_DIGEST_TWO);
  assert.equal(first.contentDigest, second.contentDigest);
});

test('sorting uses unsigned UTF-8 bytes, not locale', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(baseManifest([
    manifestFile('B.txt', Buffer.from('B', 'utf8')),
    manifestFile('a.txt', Buffer.from('a', 'utf8'))
  ]));
  const first = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'a.txt', bytes: Buffer.from('a', 'utf8') },
    { path: 'B.txt', bytes: Buffer.from('B', 'utf8') }
  ]);
  const second = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'B.txt', bytes: Buffer.from('B', 'utf8') },
    { path: 'a.txt', bytes: Buffer.from('a', 'utf8') }
  ]);
  assert.equal(first.contentDigest, second.contentDigest);
});

test('newline change at the same path produces a different content digest', () => {
  const { canonicalBytes: withNewlineBytes, manifestDigest: withNewlineDigest } = canonicalizeManagedManifest(
    baseManifest([{ path: 'hello.txt', media_type: 'text/plain', utf8_bytes: 6, digest: HELLO_NEWLINE_DIGEST, executable: false }])
  );
  const { canonicalBytes: withoutBytes, manifestDigest: withoutDigest } = canonicalizeManagedManifest(oneFileManifest());
  const withNewline = encodeContentDigest(withNewlineBytes, withNewlineDigest, [
    { path: 'hello.txt', bytes: Buffer.from('hello\n', 'utf8') }
  ]);
  const without = encodeContentDigest(withoutBytes, withoutDigest, [
    { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8') }
  ]);
  assert.notEqual(withNewline.contentDigest, without.contentDigest);
});

test('same bytes at different paths produce different content digests', () => {
  const { canonicalBytes: alphaBytes, manifestDigest: alphaDigest } = canonicalizeManagedManifest(
    baseManifest([manifestFile('alpha.txt', Buffer.from('hello', 'utf8'))])
  );
  const { canonicalBytes: betaBytes, manifestDigest: betaDigest } = canonicalizeManagedManifest(
    baseManifest([manifestFile('beta.txt', Buffer.from('hello', 'utf8'))])
  );
  const alpha = encodeContentDigest(alphaBytes, alphaDigest, [
    { path: 'alpha.txt', bytes: Buffer.from('hello', 'utf8') }
  ]);
  const beta = encodeContentDigest(betaBytes, betaDigest, [
    { path: 'beta.txt', bytes: Buffer.from('hello', 'utf8') }
  ]);
  assert.notEqual(alpha.contentDigest, beta.contentDigest);
});

test('concatenation ambiguity resistance: distinct path groupings with identical raw concatenation do not alias', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  const first = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'a', bytes: Buffer.alloc(0) },
    { path: 'bc', bytes: Buffer.alloc(0) }
  ]);
  const second = encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'ab', bytes: Buffer.alloc(0) },
    { path: 'c', bytes: Buffer.alloc(0) }
  ]);
  assert.notEqual(first.contentDigest, second.contentDigest);
});

test('independent manifest digest verification rejects a bad manifest digest', () => {
  const { canonicalBytes } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, 'sha256:' + '0'.repeat(64), [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8') }
    ]),
    ImmutableContentDigestError,
    DIGEST_MISMATCH,
    'manifestDigest'
  );
});

test('malformed manifest digest strings are rejected', () => {
  const { canonicalBytes } = canonicalizeManagedManifest(oneFileManifest());
  const malformed = [
    'SHA256:' + '0'.repeat(64),
    'sha256:' + '0'.repeat(63),
    'sha256:' + '0'.repeat(65),
    'sha256:gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg',
    'sha256:' + 'A'.repeat(64),
    'md5:' + '0'.repeat(64)
  ];
  for (const digest of malformed) {
    assertThrowsCode(
      () => encodeContentDigest(canonicalBytes, digest, [
        { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8') }
      ]),
      ImmutableContentDigestError,
      INVALID_DIGEST,
      'manifestDigest'
    );
  }
});

test('malformed file digest strings are rejected', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8'), digest: 'SHA256:' + '0'.repeat(64) }
    ]),
    ImmutableContentDigestError,
    INVALID_DIGEST,
    'files[0].digest'
  );
});

test('file digest mismatch is rejected', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8'), digest: 'sha256:' + '0'.repeat(64) }
    ]),
    ImmutableContentDigestError,
    DIGEST_MISMATCH,
    'files[0].digest'
  );
});

test('duplicate path is denied', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assert.throws(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8') },
      { path: 'hello.txt', bytes: Buffer.from('world', 'utf8') }
    ]),
    (error) => (error instanceof ManagedManifestError && error.code === MANIFEST_PATH_COLLISION)
      || (error instanceof ImmutableContentDigestError && error.code === 'DUPLICATE_PATH')
  );
});

test('case-fold path collision is denied', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(
    baseManifest([manifestFile('x.txt', Buffer.from('x', 'utf8'))])
  );
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'Skill.md', bytes: Buffer.from('s', 'utf8') },
      { path: 'SKILL.md', bytes: Buffer.from('S', 'utf8') }
    ]),
    ManagedManifestError,
    MANIFEST_PATH_COLLISION
  );
});

test('size mismatch between claimed size and actual bytes is rejected', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8'), size: 4 }
    ]),
    ImmutableContentDigestError,
    SIZE_MISMATCH,
    'files[0].size'
  );
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'hello.txt', bytes: Buffer.from('hello', 'utf8'), size: 6 }
    ]),
    ImmutableContentDigestError,
    SIZE_MISMATCH,
    'files[0].size'
  );
});

test('accepted file count bound is enforced', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  const files = Array.from({ length: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeFiles + 1 }, (_, i) => ({
    path: `f${i}.txt`,
    bytes: Buffer.from('x', 'utf8')
  }));
  assertThrowsLimit(
    () => encodeContentDigest(canonicalBytes, manifestDigest, files),
    'maxTreeFiles'
  );
});

test('path byte length bound is enforced', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsCode(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'x'.repeat(513), bytes: Buffer.from('x', 'utf8') }
    ]),
    ManagedManifestError,
    MANIFEST_INVALID_PATH
  );
  assert.doesNotThrow(() => encodeContentDigest(canonicalBytes, manifestDigest, [
    { path: 'x'.repeat(512), bytes: Buffer.from('x', 'utf8') }
  ]));
});

test('per-file byte length bound is enforced', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  assertThrowsLimit(
    () => encodeContentDigest(canonicalBytes, manifestDigest, [
      { path: 'big.bin', bytes: Buffer.alloc(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes + 1, 0) }
    ]),
    'maxFileBytes'
  );
});

test('total tree byte length bound is enforced', () => {
  const { canonicalBytes, manifestDigest } = canonicalizeManagedManifest(oneFileManifest());
  const files = [
    { path: 'a.bin', bytes: Buffer.alloc(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes, 0) },
    { path: 'b.bin', bytes: Buffer.alloc(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes, 0) },
    { path: 'c.bin', bytes: Buffer.alloc(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes, 0) },
    { path: 'd.bin', bytes: Buffer.alloc(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes, 0) },
    { path: 'e.bin', bytes: Buffer.from('x', 'utf8') }
  ];
  assertThrowsLimit(
    () => encodeContentDigest(canonicalBytes, manifestDigest, files),
    'maxTreeBytes'
  );
});
