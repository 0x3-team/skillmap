import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(repo, 'test');
const tests = readdirSync(testRoot)
  .filter(name => name.endsWith('.mjs') && name !== 'phase3-local-app-browser-fixture.mjs')
  .sort()
  .map(name => path.join('test', name));

if (!tests.length) throw new Error('No root test files were discovered.');
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: repo,
  env: process.env,
  stdio: 'inherit'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
