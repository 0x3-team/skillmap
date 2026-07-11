import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const relative of ['dist', 'contracts', 'assets/local-app']) {
    normalizeDirectory(path.join(repo, relative));
  }
  normalizeDirectory(path.join(repo, 'docs'), new Set(['plans']));
  for (const relative of [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md'
  ]) chmodSync(path.join(repo, relative), 0o644);
  chmodSync(path.join(repo, 'dist', 'cli.js'), 0o755);
}

function normalizeDirectory(directory, skippedNames = new Set()) {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skippedNames.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeDirectory(target);
    else if (entry.isFile()) chmodSync(target, 0o644);
  }
}
