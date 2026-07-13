#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  auditHostedSkillSnapshot,
  createHostedDeclaredCompatibilityReceiptDigest,
  gradeHostedSkill
} from '../../../dist/hosted/audit-grade.js';
import { fetchGithubSkillTree } from '../../../dist/network/github-source-fetcher.js';
import { assertPublicGithubRepository } from './public-github-repository.mjs';

const EXACT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LICENSE_STATES = new Set(['confirmed', 'noassertion', 'restricted']);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  assertNodeVersion();
  await assertPublicGithubRepository(options.repository);
  const sourceDirectory = path.posix.dirname(options.sourcePath);
  const snapshot = await fetchGithubSkillTree(
    options.repository,
    options.commit,
    sourceDirectory === '.' ? '.' : sourceDirectory,
    {
      timeoutMs: 10_000,
      maxResponseBytes: 1024 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
      maxEntries: 500,
      concurrency: 4,
      maxRetries: 2,
      userAgent: 'skillmap-hosted-audit-worker/1'
    }
  );
  if (snapshot.resolvedCommit !== options.commit) {
    throw new Error('GitHub did not resolve the submitted immutable commit exactly.');
  }
  const auditReceipt = auditHostedSkillSnapshot(snapshot, {
    sourcePath: options.sourcePath,
    license: {
      state: options.licenseState,
      ...(options.spdx ? { spdxExpression: options.spdx } : {})
    }
  });
  const hostProfileVersion = 'codex-host/v1';
  const compatibilityReceiptDigest = auditReceipt.compatibility.state === 'declared'
    ? createHostedDeclaredCompatibilityReceiptDigest(auditReceipt, hostProfileVersion)
    : undefined;
  const gradeEvaluation = gradeHostedSkill({
    normalizedPackageDigest: auditReceipt.subject.normalizedEvaluationDigest,
    auditReceipt,
    ...(compatibilityReceiptDigest ? { compatibilityReceiptDigest } : {}),
    hostProfileVersion
  });
  const result = {
    kind: 'skillmap.hosted-audit-dry-run',
    schemaVersion: 1,
    mutation: false,
    source: {
      repository: snapshot.repository,
      commit: snapshot.resolvedCommit,
      path: options.sourcePath,
      manifestDigest: snapshot.manifestDigest
    },
    auditReceipt,
    gradeEvaluation,
    limitations: [
      'No database row was claimed, reviewed, changed, or published.',
      'Repository visibility and content were fetched without GitHub credentials or an Authorization header.',
      'Static inspection never executes submitted content.',
      'A structurally declared host reference can produce only a low-confidence provisional score; static evidence alone cannot mint a current letter grade.'
    ]
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    await writeFile(path.resolve(options.output), serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ result: 'written', output: path.resolve(options.output), mutation: false })}\n`);
  } else {
    process.stdout.write(serialized);
  }
} catch (error) {
  process.stderr.write(`SkillMap hosted audit dry-run failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

export function parseArguments(args) {
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!argument.startsWith('--')) throw new Error(`Unknown positional argument: ${argument}`);
    if (!['--repository', '--commit', '--source-path', '--license-state', '--spdx', '--output'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  for (const required of ['--repository', '--commit', '--source-path', '--license-state']) {
    if (values[required] === undefined) throw new Error(`Missing required option: ${required}`);
  }
  if (!EXACT_COMMIT.test(values['--commit'])) throw new Error('--commit must be an immutable lowercase 40- or 64-hex commit.');
  if (!LICENSE_STATES.has(values['--license-state'])) throw new Error('--license-state must be confirmed, noassertion, or restricted.');
  const sourcePath = validateSourcePath(values['--source-path']);
  const output = values['--output'] === undefined ? undefined : validateOutput(values['--output']);
  return {
    help: false,
    repository: values['--repository'],
    commit: values['--commit'],
    sourcePath,
    licenseState: values['--license-state'],
    spdx: values['--spdx'],
    output
  };
}

function validateSourcePath(value) {
  const components = value.split('/');
  if (value !== value.trim() || value.length < 8 || value.length > 500 || value !== value.normalize('NFC')
    || value.startsWith('/') || value.endsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)
    || components.some(component => !component || component === '.' || component === '..')
    || !/(?:^|\/)SKILL\.md$/.test(value)) {
    throw new Error('--source-path must be a safe relative path ending in SKILL.md.');
  }
  return value;
}

function validateOutput(value) {
  if (value !== value.trim() || value.length > 1_024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('--output must be a bounded local path.');
  }
  return value;
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(major) || major < 22) throw new Error('The hosted audit worker requires Node 22 or newer.');
}

function safeError(error) {
  if (!(error instanceof Error)) return 'The worker failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted audit dry-run\n\n` +
    `Fetch and inspect one exact public GitHub skill version without database mutation or content execution.\n\n` +
    `Usage:\n` +
    `  npm run hosted:audit:dry-run -- --repository OWNER/REPO --commit FULL_SHA --source-path path/to/SKILL.md --license-state STATE [--spdx MIT] [--output receipt.json]\n\n` +
    `License states: confirmed, noassertion, restricted\n` +
    `GitHub access: unauthenticated public-repository preflight and content fetches only.\n` +
    `GITHUB_TOKEN is not read and Authorization headers are never sent.\n`;
}
