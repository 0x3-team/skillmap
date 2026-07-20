#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalDigest } from './operator-receipts.mjs';
import {
  acceptOperatorMode,
  finalizeOperatorMode,
  runDualControlledOperatorAction
} from './operator-dual-control.mjs';

const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTIONS = new Set([
  'deprecate-skill', 'revoke-skill', 'restore-skill',
  'quarantine-version', 'revoke-version', 'restore-version'
]);

export function buildCatalogLifecycleAction(options) {
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.catalog-lifecycle-operation', schemaVersion: 1,
    operationId: options.operationId, skillId: options.skillId,
    versionId: options.versionId, action: options.action, reasonCode: options.reasonCode
  });
  return Object.freeze({
    mode: options.mode,
    approvalId: options.approvalId,
    actionKind: 'catalog.lifecycle',
    subjectType: options.versionId === null ? 'skill' : 'skill-version',
    subjectId: options.versionId ?? options.skillId,
    actionPayload: Object.freeze({
      schemaVersion: 1,
      skillId: options.skillId,
      versionId: options.versionId,
      action: options.action,
      reasonCode: options.reasonCode
    }),
    actionDigest: idempotencyDigest,
    operationId: options.operationId,
    businessRpc: 'control_catalog_lifecycle',
    businessParameters: Object.freeze({
      p_skill_id: options.skillId,
      p_version_id: options.versionId,
      p_action: options.action,
      p_reason_code: options.reasonCode,
      p_idempotency_digest: idempotencyDigest
    })
  });
}

export async function runCatalogLifecycle(options, dependencies = {}) {
  const action = buildCatalogLifecycleAction(options);
  const outcome = await runDualControlledOperatorAction(action, dependencies);
  if (outcome.mode === 'approve') {
    return {
      result: 'operator-action-approved', mutation: true,
      actionKind: action.actionKind, actionDigest: action.actionDigest,
      approval: outcome.approval
    };
  }
  validateResult(outcome.result, options);
  return {
    result: 'completed', mutation: true,
    idempotencyDigest: action.actionDigest, lifecycle: outcome.result
  };
}

export function parseLifecycleArguments(args) {
  const values = Object.create(null);
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const nextMode = acceptOperatorMode(argument, mode);
    if (nextMode !== null) {
      mode = nextMode;
      continue;
    }
    if (!['--skill-id', '--version-id', '--action', '--reason-code', '--operation-id', '--approval-id'].includes(argument)) {
      throw new Error('Unknown option.');
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  const operator = finalizeOperatorMode(mode, values['--approval-id']);
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
  return { help: false, ...operator, skillId, versionId, action, reasonCode, operationId };
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
    || (row.version_revoked !== null && typeof row.version_revoked !== 'boolean')
    || (options.action === 'deprecate-skill' && row.skill_lifecycle_state !== 'deprecated')
    || (options.action === 'revoke-skill' && row.skill_revoked !== true)
    || (options.action === 'restore-skill'
      && (row.skill_lifecycle_state !== 'published' || row.skill_revoked !== false))
    || (options.action === 'quarantine-version' && row.version_quarantined !== true)
    || (options.action === 'revoke-version' && row.version_revoked !== true)
    || (options.action === 'restore-version'
      && (row.version_quarantined !== false || row.version_revoked !== false))) {
    throw new Error('Catalog lifecycle RPC returned an invalid lifecycle projection.');
  }
}

function help() {
  return `SkillMap catalog lifecycle operator\n\n` +
    `Service-role-only, idempotent deprecation, quarantine, revocation, and receipt-backed restoration.\n` +
    `Approval and execution require distinct SKILLMAP_OPERATOR_CREDENTIAL values. ` +
    `Use exactly one mode; --approve records only the exact envelope, and --execute requires --approval-id.\n\n` +
    `Usage:\n` +
    `  node apps/worker/src/lifecycle.mjs --approve --skill-id skl_... --action deprecate-skill --reason-code CODE --operation-id UUID\n` +
    `  node apps/worker/src/lifecycle.mjs --approve --skill-id skl_... --version-id skv_... --action quarantine-version --reason-code CODE --operation-id UUID\n` +
    `Execute: repeat the exact action with --execute --approval-id opa_...\n`;
}

async function main(args) {
  try {
    const options = parseLifecycleArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runCatalogLifecycle(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap catalog lifecycle command failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
