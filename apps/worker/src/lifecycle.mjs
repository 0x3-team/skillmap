#!/usr/bin/env node

import process from 'node:process';
import { canonicalDigest } from './operator-receipts.mjs';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTIONS = new Set([
  'deprecate-skill', 'revoke-skill', 'restore-skill',
  'quarantine-version', 'revoke-version', 'restore-version'
]);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    process.exit(0);
  }
  if (!options.execute) throw new Error('Refusing catalog lifecycle mutation without the explicit --execute flag.');
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.catalog-lifecycle-operation', schemaVersion: 1,
    operationId: options.operationId, skillId: options.skillId,
    versionId: options.versionId, action: options.action, reasonCode: options.reasonCode
  });
  const result = await createSupabaseRpcClientFromEnvironment().call('control_catalog_lifecycle', {
    p_skill_id: options.skillId,
    p_version_id: options.versionId,
    p_action: options.action,
    p_reason_code: options.reasonCode,
    p_idempotency_digest: idempotencyDigest
  });
  validateResult(result, options);
  process.stdout.write(`${JSON.stringify({ result: 'completed', mutation: true, idempotencyDigest, lifecycle: result })}\n`);
} catch (error) {
  process.stderr.write(`SkillMap catalog lifecycle command failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const values = Object.create(null);
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--execute') {
      if (execute) throw new Error('--execute may be supplied only once.');
      execute = true;
      continue;
    }
    if (!['--skill-id', '--version-id', '--action', '--reason-code', '--operation-id'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  if (!execute) return { help: false, execute };
  const skillId = values['--skill-id'];
  const versionId = values['--version-id'] ?? null;
  const action = values['--action'];
  const reasonCode = values['--reason-code'];
  const operationId = values['--operation-id'];
  if (!SKILL_ID.test(skillId ?? '')) throw new Error('--skill-id is invalid.');
  if (!ACTIONS.has(action)) throw new Error('--action is invalid.');
  const versionAction = action.endsWith('-version');
  if ((versionAction && !VERSION_ID.test(versionId ?? '')) || (!versionAction && versionId !== null)) {
    throw new Error('--version-id is required only for version actions.');
  }
  if (!REASON.test(reasonCode ?? '') || reasonCode.length > 64) throw new Error('--reason-code is invalid.');
  if (!UUID.test(operationId ?? '')) throw new Error('--operation-id must be one canonical lowercase UUID.');
  return { help: false, execute, skillId, versionId, action, reasonCode, operationId };
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

function validateResult(result, options) {
  if (!Array.isArray(result) || result.length !== 1) throw new Error('Catalog lifecycle RPC returned an invalid bounded result.');
  const row = result[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'skill_id,skill_lifecycle_state,skill_revoked,version_id,version_quarantined,version_revoked'
    || row.skill_id !== options.skillId || row.version_id !== options.versionId
    || !['published', 'deprecated'].includes(row.skill_lifecycle_state)
    || typeof row.skill_revoked !== 'boolean'
    || (row.version_quarantined !== null && typeof row.version_quarantined !== 'boolean')
    || (row.version_revoked !== null && typeof row.version_revoked !== 'boolean')) {
    throw new Error('Catalog lifecycle RPC returned an invalid lifecycle projection.');
  }
}

function help() {
  return `SkillMap catalog lifecycle operator\n\n` +
    `Service-role-only, idempotent deprecation, quarantine, revocation, and receipt-backed restoration.\n` +
    `Mutation requires: --execute\n\n` +
    `Usage:\n` +
    `  node apps/worker/src/lifecycle.mjs --execute --skill-id skl_... --action deprecate-skill --reason-code CODE --operation-id UUID\n` +
    `  node apps/worker/src/lifecycle.mjs --execute --skill-id skl_... --version-id skv_... --action quarantine-version --reason-code CODE --operation-id UUID\n`;
}
