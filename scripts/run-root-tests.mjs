import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(repo, 'test');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const excludedTests = new Set([
  // These are historical/native readiness gates. They require the private
  // macOS plan/evidence workspace and are not part of the portable CLI gate.
  'm3-03-dp-keychain-failure-recovery.mjs',
  'm3-03-apple-signing-readiness.mjs'
]);
const tests = readdirSync(testRoot)
  .filter(name => name.endsWith('.mjs') && name !== 'phase3-local-app-browser-fixture.mjs')
  .filter(name => !excludedTests.has(name) && (name !== 'macos-device-auth-custody.mjs' || process.platform === 'darwin'))
  // M3.12 imports the production Next/TypeScript DeviceAuth seams. The web
  // package requires Node 22+, so the Node 20 CLI lane leaves this cross-stack
  // test to every Node 22 platform while retaining the rest of the CLI suite.
  .filter(name => name !== 'm3-12-device-auth-adversarial.mjs' || nodeMajor >= 22)
  .sort()
  .map(name => path.join('test', name));

if (!tests.length) throw new Error('No root test files were discovered.');
// Keep the portable matrix conservative. Subprocess-heavy workspace and MCP
// suites contend under the default Node fan-out until their individual
// 60-second safety timers fire on otherwise healthy Windows hosts. The
// protected Gitea lane opts into its known capacity explicitly.
const concurrency = process.env.SKILLMAP_TEST_CONCURRENCY?.trim() || '1';
if (concurrency && !/^[1-9]\d*$/.test(concurrency)) {
  throw new Error('SKILLMAP_TEST_CONCURRENCY must be a positive integer.');
}
const testArguments = ['--test', `--test-concurrency=${concurrency}`];
testArguments.push(...tests);
const result = spawnSync(process.execPath, testArguments, {
  cwd: repo,
  env: process.env,
  stdio: 'inherit'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
