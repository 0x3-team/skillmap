import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const COMMIT = 'd1c23990af82d1c8c99997cb8d9a2c23707d91fa';
const ENTRIES = [
  {
    path: 'catalog/first-party/skill-audit/SKILL.md',
    digest: '4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a'
  },
  {
    path: 'catalog/first-party/skill-quality-review/SKILL.md',
    digest: 'd38ab7b682ef41dcce18debc7a77857031951ba54b16b53a78a57e48b30745c3'
  },
  {
    path: 'catalog/first-party/skill-supply-chain-review/SKILL.md',
    digest: '295ad7b51050d476e91e4f84bbe6ec184d66452faa6956bd3f54ee1499c683ab'
  }
];

test('hosted seed entrypoint digests bind the exact committed bytes and remain domain-separated', async () => {
  const seed = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  for (const entry of ENTRIES) {
    const committed = execFileSync('git', ['show', `${COMMIT}:${entry.path}`]);
    const current = await readFile(new URL(`../${entry.path}`, import.meta.url));
    const committedDigest = createHash('sha256').update(committed).digest('hex');
    const currentDigest = createHash('sha256').update(current).digest('hex');
    assert.equal(committedDigest, entry.digest, `${entry.path} committed digest`);
    assert.equal(currentDigest, entry.digest, `${entry.path} current digest`);
    assert.match(seed, new RegExp(`${entry.path.replaceAll('/', '\\/')}[\\s\\S]{0,180}sha256:${entry.digest}`));
  }

  assert.match(seed, new RegExp(COMMIT, 'g'));
  assert.equal((seed.match(new RegExp(COMMIT, 'g')) ?? []).length, 3);
  assert.doesNotMatch(seed, /phase1-[ab]@skillmap\.invalid|test\.hidden|(?:draft|private|revoked)-decoy/);
  assert.doesNotMatch(seed, /insert\s+into\s+auth\.users|insert\s+into\s+private\.publisher_members/i);
  assert.doesNotMatch(config, /sql_paths\s*=\s*\[[^\]]*(?:tests|fixtures)/is);
  assert.equal((seed.match(/raw_snapshot_digest[\s\S]*?normalized_artifact_digest[\s\S]*?manifest_digest/g) ?? []).length > 0, true);
  assert.equal((seed.match(/null, 'metadata-only', null, null/g) ?? []).length >= 3, true);
});

test('the pinned source commit carries the MIT repository license named by the seed', () => {
  const license = execFileSync('git', ['show', `${COMMIT}:LICENSE`], { encoding: 'utf8' });
  assert.match(license, /^MIT License/m);
  assert.match(license, /Copyright \(c\) 2026 SkillMap contributors/);
});
