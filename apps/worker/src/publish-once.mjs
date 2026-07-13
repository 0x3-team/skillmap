#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { canonicalDigest } from './operator-receipts.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const ALLOWED_SPDX = new Set([
  '0BSD', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'Apache-2.0', 'BSD-2-Clause',
  'BSD-3-Clause', 'CC0-1.0', 'GPL-2.0-only', 'GPL-2.0-or-later',
  'GPL-3.0-only', 'GPL-3.0-or-later', 'ISC', 'LGPL-2.1-only',
  'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'MIT',
  'MPL-2.0', 'Unlicense'
]);
const METADATA_KEYS = [
  'publisherHandle', 'publisherDisplayName', 'skillSlug', 'skillDisplayName',
  'summary', 'description', 'capabilities', 'licenseState', 'spdxExpression',
  'permissionScripts', 'permissionNetwork', 'permissionTools'
];

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing publication without the explicit --execute flag.');
  const metadata = validateMetadata(JSON.parse(await readFile(path.resolve(options.metadata), 'utf8')));
  const publicationDigest = canonicalDigest({
    kind: 'skillmap.hosted-publication-request', schemaVersion: 1,
    submissionId: options.submissionId, metadata
  });
  const rpc = createSupabaseRpcClientFromEnvironment();
  const result = await rpc.call('publish_skill_submission', {
    p_submission_id: options.submissionId,
    p_publication_digest: publicationDigest,
    p_publisher_handle: metadata.publisherHandle,
    p_publisher_display_name: metadata.publisherDisplayName,
    p_skill_slug: metadata.skillSlug,
    p_skill_display_name: metadata.skillDisplayName,
    p_summary: metadata.summary,
    p_description: metadata.description,
    p_capabilities: metadata.capabilities,
    p_license_state: metadata.licenseState,
    p_spdx_expression: metadata.spdxExpression,
    p_permission_scripts: metadata.permissionScripts,
    p_permission_network: metadata.permissionNetwork,
    p_permission_tools: metadata.permissionTools
  });
  process.stdout.write(`${JSON.stringify({ result: 'published', mutation: true, publicationDigest, publication: result })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap hosted publication failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  let execute = false;
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (!['--submission-id', '--metadata'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!values['--metadata'] || values['--metadata'].length > 1024 || /[\u0000-\u001f\u007f]/.test(values['--metadata'])) {
    throw new Error('--metadata is required and must be a bounded local JSON path.');
  }
  return { help: false, execute, submissionId: values['--submission-id'], metadata: values['--metadata'] };
}

export function validateMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...METADATA_KEYS].sort().join(',')) {
    throw new Error('Publication metadata must contain exactly the documented fields.');
  }
  boundedSlug(value.publisherHandle, 2, 40, 'publisherHandle');
  boundedSlug(value.skillSlug, 2, 100, 'skillSlug');
  boundedText(value.publisherDisplayName, 100, 'publisherDisplayName');
  boundedText(value.skillDisplayName, 140, 'skillDisplayName');
  boundedText(value.summary, 500, 'summary');
  boundedText(value.description, 20_000, 'description');
  boundedArray(value.capabilities, 50, 100, /^[a-z0-9]+(?:[.:/-][a-z0-9]+)*$/, 'capabilities');
  if (value.licenseState !== 'confirmed' || !ALLOWED_SPDX.has(value.spdxExpression)) {
    throw new Error('Publication requires an approved confirmed SPDX identifier.');
  }
  if (typeof value.permissionScripts !== 'boolean') throw new Error('permissionScripts must be boolean.');
  boundedArray(value.permissionNetwork, 50, 200, null, 'permissionNetwork');
  boundedArray(value.permissionTools, 50, 200, null, 'permissionTools');
  return value;
}

function boundedSlug(value, minimum, maximum, field) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`${field} is invalid.`);
}

function boundedText(value, maximum, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} is invalid.`);
  }
}

function boundedArray(value, maximumItems, maximumLength, pattern, field) {
  if (!Array.isArray(value) || value.length > maximumItems || new Set(value).size !== value.length
    || value.some(item => typeof item !== 'string' || item.length < 1 || item.length > maximumLength
      || /[\u0000-\u001f\u007f]/.test(item) || (pattern && !pattern.test(item)))) {
    throw new Error(`${field} is invalid.`);
  }
}

function safeError(error) {
  if (!(error instanceof Error)) return 'Publication failed with an unknown bounded error.';
  return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}

function help() {
  return `SkillMap hosted publication\n\n` +
    `Publish one accepted receipt-backed submission as metadata only.\n` +
    `Mutation requires --execute and server-only Supabase operator environment variables.\n\n` +
    `Usage: node apps/worker/src/publish-once.mjs --execute --submission-id sub_... --metadata reviewed-publication.json\n`;
}
