import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectImportFileForSecrets,
  IMPORT_SECRET_SCAN_MAX_BYTES
} from '../dist/core/import-secret-blocker.js';

function inspect(relativePath, content, mediaType = 'text/plain') {
  return inspectImportFileForSecrets({
    relativePath,
    content: Buffer.from(content),
    mediaType
  });
}

test('M4.03 blocks forbidden credential and private-key filenames without reading or echoing bytes', () => {
  const content = 'synthetic-value-that-must-never-appear';
  for (const relativePath of [
    '.env',
    '.env.local',
    '.envrc',
    '.npmrc',
    '.pypirc',
    '.netrc',
    'id_ed25519',
    'config/private.key',
    'config/client.p12',
    'config/service-account-production.json',
    '.aws/credentials',
    '.config/gcloud/application_default_credentials.json'
  ]) {
    const result = inspect(relativePath, content);
    assert.deepEqual(result, {
      decision: 'blocked',
      code: 'IMPORT_SECRET_BLOCKED',
      reason: 'forbidden_filename'
    });
    assert.equal(JSON.stringify(result).includes(content), false);
    assert.equal(JSON.stringify(result).includes(relativePath), false);
  }
});

test('M4.03 blocks high-confidence synthetic credential formats and private-key blocks', () => {
  const fixtures = [
    ['docs/github.txt', `ghp_${'A'.repeat(36)}`, 'credential_pattern'],
    ['docs/aws.txt', `AKIA${'A1'.repeat(8)}`, 'credential_pattern'],
    ['docs/google.txt', `AIza${'A'.repeat(35)}`, 'credential_pattern'],
    ['docs/slack.txt', `xoxb-${'1'.repeat(12)}-${'2'.repeat(12)}-${'a'.repeat(24)}`, 'credential_pattern'],
    ['docs/npm.txt', `npm_${'a'.repeat(36)}`, 'credential_pattern'],
    ['docs/openai.txt', `sk-proj-${'a'.repeat(32)}`, 'credential_pattern'],
    ['docs/anthropic.txt', `sk-ant-api03-${'a'.repeat(32)}`, 'credential_pattern'],
    ['docs/gitlab.txt', `glpat-${'a'.repeat(24)}`, 'credential_pattern'],
    ['docs/huggingface.txt', `hf_${'a'.repeat(32)}`, 'credential_pattern'],
    ['docs/supabase.txt', `sbp_${'a'.repeat(40)}`, 'credential_pattern'],
    ['docs/stripe.txt', `sk_live_${'a'.repeat(24)}`, 'credential_pattern'],
    ['docs/private.txt', '-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----', 'private_key'],
    ['docs/openssh.txt', '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic\n-----END OPENSSH PRIVATE KEY-----', 'private_key'],
    ['docs/pgp.txt', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nsynthetic', 'private_key'],
    ['docs/assignment.txt', `api_key=${'s3cr3t'.repeat(6)}`, 'credential_assignment']
  ];

  for (const [relativePath, content, reason] of fixtures) {
    const result = inspect(relativePath, content);
    assert.deepEqual(result, {
      decision: 'blocked',
      code: 'IMPORT_SECRET_BLOCKED',
      reason
    });
    assert.equal(JSON.stringify(result).includes(content), false);
  }
});

test('M4.03 keeps common documentation placeholders and inert text importable', () => {
  for (const content of [
    'Set API_KEY=YOUR_API_KEY in your own environment.',
    'token: <replace-me>',
    'password = "example"',
    'Authorization: Bearer ${TOKEN}',
    'The word secret is documentation, not a credential.',
    '# Skill\nUse this skill to review authentication code.'
  ]) {
    assert.deepEqual(inspect('references/guide.md', content, 'text/markdown'), {
      decision: 'allowed'
    });
  }
});

test('M4.03 rejects oversized scan input before pattern matching and returns bounded metadata only', () => {
  const content = Buffer.alloc(IMPORT_SECRET_SCAN_MAX_BYTES + 1, 0x61);
  const result = inspectImportFileForSecrets({
    relativePath: 'references/large.txt',
    content,
    mediaType: 'text/plain'
  });
  assert.deepEqual(result, {
    decision: 'blocked',
    code: 'IMPORT_SECRET_SCAN_LIMIT',
    reason: 'scan_limit'
  });
  assert.ok(JSON.stringify(result).length < 160);
});

test('M4.03 does not decode or scan allowlisted inert image bytes as text credentials', () => {
  const fakePng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`ghp_${'A'.repeat(36)}`)
  ]);
  assert.deepEqual(inspectImportFileForSecrets({
    relativePath: 'assets/example.png',
    content: fakePng,
    mediaType: 'image/png'
  }), {
    decision: 'allowed'
  });
});

test('M4.03 fails closed on invalid UTF-8 and unscannable binary classes', () => {
  assert.deepEqual(inspectImportFileForSecrets({
    relativePath: 'references/invalid.txt',
    content: Buffer.from([0xc3, 0x28]),
    mediaType: 'text/plain'
  }), {
    decision: 'blocked',
    code: 'IMPORT_SECRET_SCAN_UNSAFE',
    reason: 'invalid_utf8'
  });

  assert.deepEqual(inspectImportFileForSecrets({
    relativePath: 'references/blob.bin',
    content: Buffer.from([0x00, 0xff, 0x01, 0xfe]),
    mediaType: 'application/octet-stream'
  }), {
    decision: 'blocked',
    code: 'IMPORT_SECRET_SCAN_UNSAFE',
    reason: 'unscannable_binary'
  });
});
