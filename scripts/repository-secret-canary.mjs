import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_SCANNED_FILE_BYTES = 5 * 1024 * 1024;

const SECRET_CANARIES = Object.freeze([
  ['PEM private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /(?:github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{36,255})/],
  ['npm credential', /npm_[A-Za-z0-9]{36,255}/],
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['API secret key', /sk-(?:proj-|svcacct-|ant-api\d{2}-)?[A-Za-z0-9_-]{32,255}/],
  ['Stripe live credential', /(?:sk|rk)_live_[A-Za-z0-9]{20,255}/],
  ['Slack credential', /xox[baprs]-[A-Za-z0-9-]{20,255}/],
  ['Google API credential', /AIza[0-9A-Za-z_-]{35}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,255}/],
  ['SkillMap operator credential', /smo_v1_[0-9a-f]{64}/]
]);

// These files contain intentionally concrete credential canaries used to prove
// that release and Apple-readiness checks fail closed. No other path is exempt.
const REVIEWED_FIXTURE_EXEMPTIONS = new Map([
  ['test/package-candidate-verifier.mjs', new Set(['PEM private key'])],
  ['test/fixtures/m3-03-apple-signing-readiness/cases.json', new Set(['PEM private key'])],
  ['apps/web/tests/import-contracts.test.mjs', new Set(['PEM private key', 'GitHub credential'])],
  ['test/m4-03-secret-blocking.mjs', new Set(['PEM private key'])]
]);

export function scanRepositorySecretCanaries(entries) {
  assert.ok(Array.isArray(entries), 'secret-canary entries must be an array');
  const findings = [];
  for (const entry of entries) {
    assert.equal(typeof entry.path, 'string', 'secret-canary entry path must be a string');
    assert.ok(Buffer.isBuffer(entry.bytes), `secret-canary entry bytes must be a Buffer: ${entry.path}`);
    const normalizedPath = entry.path.split(path.sep).join('/');
    assert.equal(entry.bytes.length <= MAX_SCANNED_FILE_BYTES, true, `tracked file exceeds the 5 MiB secret-scan limit: ${normalizedPath}`);
    if (entry.bytes.includes(0)) continue;
    const text = entry.bytes.toString('utf8');
    for (const [label, pattern] of SECRET_CANARIES) {
      if (!pattern.test(text)) continue;
      if (REVIEWED_FIXTURE_EXEMPTIONS.get(normalizedPath)?.has(label)) continue;
      findings.push({ path: normalizedPath, label });
    }
  }
  return findings;
}

export function readTrackedSecretScanEntries(repo, trackedPaths) {
  return trackedPaths.map(relativePath => {
    const target = path.join(repo, relativePath);
    const stats = lstatSync(target);
    assert.equal(stats.isFile() && !stats.isSymbolicLink(), true, `candidate secret scan accepts regular files only: ${relativePath}`);
    return { path: relativePath, bytes: readFileSync(target) };
  });
}
