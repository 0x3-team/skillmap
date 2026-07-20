#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { canonicalDigest } from './operator-receipts.mjs';
import {
  acceptOperatorMode,
  finalizeOperatorMode,
  runDualControlledOperatorAction
} from './operator-dual-control.mjs';

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
const PUBLISHER_ID = /^pub_[0-9a-f]{32}$/;
const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;

export function buildPublicationAction(options, metadata) {
  const publicationDigest = canonicalDigest({
    kind: 'skillmap.hosted-publication-request', schemaVersion: 1,
    submissionId: options.submissionId, metadata, operationId: options.operationId
  });
  return Object.freeze({
    mode: options.mode,
    approvalId: options.approvalId,
    actionKind: 'submission.publish',
    subjectType: 'submission',
    subjectId: options.submissionId,
    actionPayload: Object.freeze({
      schemaVersion: 1,
      submissionId: options.submissionId,
      publisherHandle: metadata.publisherHandle,
      publisherDisplayName: metadata.publisherDisplayName,
      skillSlug: metadata.skillSlug,
      skillDisplayName: metadata.skillDisplayName,
      summary: metadata.summary,
      description: metadata.description,
      capabilities: metadata.capabilities,
      licenseState: metadata.licenseState,
      spdxExpression: metadata.spdxExpression,
      permissionScripts: metadata.permissionScripts,
      permissionNetwork: metadata.permissionNetwork,
      permissionTools: metadata.permissionTools
    }),
    actionDigest: publicationDigest,
    operationId: options.operationId,
    businessRpc: 'publish_skill_submission',
    businessParameters: Object.freeze({
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
    })
  });
}

export async function runPublication(options, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const metadata = validateMetadata(JSON.parse(await read(path.resolve(options.metadata), 'utf8')));
  const action = buildPublicationAction(options, metadata);
  const outcome = await runDualControlledOperatorAction(action, dependencies);
  if (outcome.mode === 'approve') {
    return {
      result: 'operator-action-approved', mutation: true,
      actionKind: action.actionKind, actionDigest: action.actionDigest,
      approval: outcome.approval
    };
  }
  const publication = validatePublicationResult(outcome.result, options);
  return {
    result: 'published', mutation: true,
    publicationDigest: action.actionDigest, publication
  };
}

export function validatePublicationResult(result, options) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Publication RPC returned an invalid publication projection.');
  }
  const row = result[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'publisher_id,skill_id,submission_id,submission_state,version_id'
    || !/^sub_[0-9a-f]{32}$/.test(options?.submissionId ?? '')
    || row.submission_id !== options.submissionId
    || !PUBLISHER_ID.test(row.publisher_id ?? '')
    || !SKILL_ID.test(row.skill_id ?? '')
    || !VERSION_ID.test(row.version_id ?? '')
    || row.submission_state !== 'published') {
    throw new Error('Publication RPC returned an invalid publication projection.');
  }
  return result;
}

export function parsePublishArguments(args) {
  let mode = null;
  const values = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const nextMode = acceptOperatorMode(argument, mode);
    if (nextMode !== null) {
      mode = nextMode;
      continue;
    }
    if (!['--submission-id', '--metadata', '--operation-id', '--approval-id'].includes(argument)) {
      throw new Error('Unknown option.');
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  const operator = finalizeOperatorMode(mode, values['--approval-id']);
  if (!/^sub_[0-9a-f]{32}$/.test(values['--submission-id'] ?? '')) throw new Error('--submission-id is required and invalid.');
  if (!values['--metadata'] || values['--metadata'].length > 1024 || /[\u0000-\u001f\u007f]/.test(values['--metadata'])) {
    throw new Error('--metadata is required and must be a bounded local JSON path.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values['--operation-id'] ?? '')) {
    throw new Error('--operation-id is required and must be one canonical UUID.');
  }
  return {
    help: false,
    ...operator,
    submissionId: values['--submission-id'],
    metadata: values['--metadata'],
    operationId: values['--operation-id']
  };
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
    `Approval and execution require distinct SKILLMAP_OPERATOR_CREDENTIAL values. ` +
    `Use exactly one mode; --approve records only the exact envelope, and --execute requires --approval-id.\n\n` +
    `Approve: node apps/worker/src/publish-once.mjs --approve --submission-id sub_... ` +
    `--metadata reviewed-publication.json --operation-id UUID\n` +
    `Execute: repeat the exact action with --execute --approval-id opa_...\n`;
}

async function main(args) {
  try {
    const options = parsePublishArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runPublication(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap hosted publication failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
