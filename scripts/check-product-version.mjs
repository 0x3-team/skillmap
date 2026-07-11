import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package version must be a supported semantic version');

const checks = [
  ['src/server/compatibility.ts', `SKILLMAP_PRODUCT_VERSION = '${manifest.version}'`],
  ['src/core/workspace-state/index.ts', `producerVersion ?? '${manifest.version}'`],
  ['assets/local-app/v1/modules/api.js', `productVersion: '${manifest.version}'`]
];

for (const [relative, expected] of checks) {
  const source = readFileSync(path.join(repo, relative), 'utf8');
  assert.equal(source.includes(expected), true, `${relative} must match package.json version ${manifest.version}`);
}
