import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(repo, 'apps', 'web', 'scripts', 'launch-report-evidence-smoke.mjs'), 'utf8');

test('hosted launch smoke emits pass only after fatal verified synthetic cleanup', () => {
  const finallyIndex = source.indexOf('} finally {');
  const finalPassWrite = source.lastIndexOf('process.stdout.write');
  assert.ok(finallyIndex >= 0, 'hosted launch smoke has no cleanup boundary');
  assert.ok(finalPassWrite > finallyIndex, 'hosted launch smoke can print pass before cleanup completes');

  assert.match(source, /await deleteAndVerifySyntheticUsers\(userIds\)/,
    'hosted launch smoke does not delete and verify every synthetic auth user');
  assert.match(source, /userIds[.]push\(created[.]user[.]id\)/,
    'hosted launch smoke does not track a synthetic auth user immediately after creation');
  assert.doesNotMatch(source, /userIds[.]push\(primary[.]userId, secondary[.]userId\)/,
    'hosted launch smoke defers synthetic user tracking until all setup has succeeded');
  assert.match(source, /admin[.]auth[.]admin[.]getUserById\(userId\)/,
    'hosted launch smoke does not prove synthetic auth users are absent');
  assert.match(source, /Synthetic auth-user cleanup failed/,
    'synthetic auth cleanup is not fatal');

  for (const table of ['private.publishers', 'private.source_repositories', 'private.skills', 'private.skill_versions']) {
    assert.match(source, new RegExp(table.replace('.', '[.]')),
      `hosted launch smoke does not clean or verify ${table}`);
  }
  assert.match(source, /Object[.]values\(counts\)[.]some\(\(value\) => value !== 0\)/,
    'hosted launch smoke does not fail when exact synthetic catalog rows remain');
  assert.match(source, /cleanupReceipt[?][.]verified/,
    'hosted launch smoke can finish without a verified cleanup receipt');
  assert.doesNotMatch(source, /authUsersRemaining:\s*0/,
    'hosted launch smoke hardcodes zero remaining auth users instead of using a verified count');
  assert.doesNotMatch(source, /Cleanup warning:/,
    'hosted launch smoke still downgrades cleanup failure to a warning');
});
