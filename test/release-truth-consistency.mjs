import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const currentMain = '29a356a9b809d29ff8c986fbd5a0af78d87e479c';
const releaseTree = '3a70dbafca99153ad80d67601a5b2e3bbc2d47d5';
const sources = Object.fromEntries([
  'README.md',
  'HANDOFF.md',
  'CHANGELOG.md',
  'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/plans/2026-07-12-skillmap-release-ledger.md',
  'apps/web/app/release-status/page.tsx',
  'apps/worker/README.md',
  'docs/operations/free-public-alpha-runbook.md'
].map(file => [file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')]));

test('canonical release truth binds the merged source and scoped CI receipts', () => {
  for (const file of [
    'HANDOFF.md',
    'CHANGELOG.md',
    'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
    'docs/plans/2026-07-12-skillmap-release-ledger.md'
  ]) {
    assert.match(sources[file], new RegExp(currentMain), file);
  }
  assert.match(sources['HANDOFF.md'], new RegExp(releaseTree));
  assert.match(sources['HANDOFF.md'], /Gitea candidate run `44` passed/i);
  assert.match(sources['HANDOFF.md'], /job `86937705880` passed the JIT `hosted-web` scope/i);
  assert.match(sources['HANDOFF.md'], /post-merge Gitea `main` run `47` passed/i);
  assert.match(sources['HANDOFF.md'], /later candidate\/merge ledger row/i);
  assert.match(sources['docs/plans/2026-07-12-skillmap-release-ledger.md'], /Locally validated, pushed, merged, and scoped remote CI verified/i);
  assert.match(sources['README.md'], /baseline source-integration receipt is already pushed and merged/i);
});

test('canonical release truth does not collapse source acceptance into deployment or launch', () => {
  for (const [file, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\bno push\b|has not been pushed|no authoritative current-commit CI/i, file);
  }
  for (const file of [
    'HANDOFF.md',
    'CHANGELOG.md',
    'docs/plans/2026-07-12-skillmap-free-public-launch-implementation-plan.md',
    'docs/plans/2026-07-12-skillmap-release-ledger.md',
    'apps/web/app/release-status/page.tsx'
  ]) {
    assert.match(sources[file], /not deployed|deployment[^.]+not|not deployment/i, file);
    assert.match(sources[file], /not[^.]+verified live|verified-live[^.]+not|does not prove[^.]+verified-live|live-verification boundaries/i, file);
  }
  assert.match(sources['HANDOFF.md'], /Launch remains `NO-GO`/i);
  assert.match(sources['docs/plans/2026-07-12-skillmap-release-ledger.md'], /`NO-GO`/i);
  assert.match(sources['CHANGELOG.md'], /Later Unreleased[\s\S]+own candidate and merge receipt/i);
  assert.match(sources['apps/web/app/release-status/page.tsx'], /No remote Supabase or web deployment, live OAuth path, hosted backup, public indexing, or open-user launch is claimed/i);
});

test('go-to-market checklist records source integration without claiming external gates', () => {
  const checklist = sources['docs/launch/free-public-alpha-go-to-market.md'];
  assert.match(checklist, /- \[x\].*merged/i);
  assert.match(checklist, /- \[ \].*Production Supabase, web, OAuth/i);
  assert.match(checklist, /- \[ \].*pilot/i);
  assert.match(checklist, /- \[ \].*index/i);
});

test('operator documentation binds the final migration and executable argument shapes', () => {
  for (const file of ['apps/worker/README.md', 'docs/operations/free-public-alpha-runbook.md']) {
    const source = sources[file];
    assert.match(source, /20260713060000_operator_submission_read_plane[.]sql/, file);
    assert.match(source, /hosted:queue:list/, file);
    assert.match(source, /hosted:queue:inspect/, file);
    assert.match(source, /best-effort[^.]+live/i, file);
    assert.match(source, /restart[^.]+no cursor|restart once from no cursor/i, file);
    assert.match(source, /not[^.]+at-least-once/i, file);
    assert.match(source, /after-updated-at/, file);
    assert.match(source, /licref_[0-9a-f]{32}/, file);
    assert.match(source, /sha256:[0-9a-f]{64}/, file);
    assert.doesNotMatch(source, /sha256:[.]{3}/, file);
  }
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const workerScripts = JSON.parse(readFileSync(
    new URL('../apps/worker/package.json', import.meta.url), 'utf8'
  )).scripts;
  assert.match(scripts['hosted:queue:list'], /submission-queue[.]mjs/);
  assert.match(scripts['hosted:queue:inspect'], /submission-detail[.]mjs/);
  assert.match(workerScripts['queue:list'], /submission-queue[.]mjs/);
  assert.match(workerScripts['queue:inspect'], /submission-detail[.]mjs/);
});
