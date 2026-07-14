#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { canonicalDigest } from './operator-receipts.mjs';
import {
  acceptOperatorMode,
  finalizeOperatorMode,
  runDualControlledOperatorAction
} from './operator-dual-control.mjs';

const REPORT_ID = /^rpt_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DISPOSITIONS = new Set(['confirmed', 'no-action', 'duplicate', 'invalid']);
const ENFORCEMENT_ACTIONS = new Set(['quarantine-version', 'revoke-version']);

export function buildReportDispositionAction(options) {
  const idempotencyDigest = canonicalDigest({
    kind: 'skillmap.report-disposition-operation', schemaVersion: 1,
    operationId: options.operationId, reportId: options.reportId,
    disposition: options.disposition, reasonCode: options.reasonCode,
    publicMessage: options.publicMessage, lifecycleAction: options.lifecycleAction
  });
  return Object.freeze({
    mode: options.mode,
    approvalId: options.approvalId,
    actionKind: 'report.disposition',
    subjectType: 'report',
    subjectId: options.reportId,
    actionPayload: Object.freeze({
      schemaVersion: 1,
      reportId: options.reportId,
      dispositionCode: options.disposition,
      reasonCode: options.reasonCode,
      publicMessage: options.publicMessage,
      lifecycleAction: options.lifecycleAction
    }),
    actionDigest: idempotencyDigest,
    operationId: options.operationId,
    businessRpc: 'disposition_skill_report',
    businessParameters: Object.freeze({
      p_report_id: options.reportId,
      p_disposition_code: options.disposition,
      p_reason_code: options.reasonCode,
      p_public_message: options.publicMessage,
      p_lifecycle_action: options.lifecycleAction,
      p_idempotency_digest: idempotencyDigest
    })
  });
}

export async function runReportDisposition(options, dependencies = {}) {
  const action = buildReportDispositionAction(options);
  const outcome = await runDualControlledOperatorAction(action, dependencies);
  if (outcome.mode === 'approve') {
    return {
      result: 'operator-action-approved', mutation: true,
      actionKind: action.actionKind, actionDigest: action.actionDigest,
      approval: outcome.approval
    };
  }
  validateReportDispositionResult(outcome.result, options);
  return {
    result: 'completed', mutation: true,
    idempotencyDigest: action.actionDigest, report: outcome.result
  };
}

export function parseReportDispositionArguments(args) {
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
    if (![
      '--report-id', '--disposition', '--reason-code', '--public-message',
      '--lifecycle-action', '--operation-id', '--approval-id'
    ].includes(argument)) {
      throw new Error('Unknown option.');
    }
    if (values[argument] !== undefined) throw new Error(`Option may be supplied only once: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${argument}`);
    values[argument] = value;
    index += 1;
  }
  const operator = finalizeOperatorMode(mode, values['--approval-id']);
  const reportId = values['--report-id'];
  const disposition = values['--disposition'];
  const reasonCode = values['--reason-code'];
  const publicMessage = values['--public-message'];
  const lifecycleAction = values['--lifecycle-action'] ?? null;
  const operationId = values['--operation-id'];
  if (!REPORT_ID.test(reportId ?? '')) throw new Error('--report-id is invalid.');
  if (!DISPOSITIONS.has(disposition)) throw new Error('--disposition is invalid.');
  if (!REASON.test(reasonCode ?? '') || reasonCode.length > 64) throw new Error('--reason-code is invalid.');
  if (typeof publicMessage !== 'string' || publicMessage.length < 1 || publicMessage.length > 500
    || publicMessage !== publicMessage.trim() || /[\u0000-\u001f\u007f]/.test(publicMessage)) {
    throw new Error('--public-message is invalid.');
  }
  if (disposition === 'confirmed' && !ENFORCEMENT_ACTIONS.has(lifecycleAction)) {
    throw new Error('--lifecycle-action must be quarantine-version or revoke-version for a confirmed report.');
  }
  if (disposition !== 'confirmed' && lifecycleAction !== null) {
    throw new Error('--lifecycle-action is accepted only for a confirmed report.');
  }
  if (!UUID.test(operationId ?? '')) throw new Error('--operation-id must be one canonical lowercase UUID.');
  return {
    help: false, ...operator, reportId, disposition, reasonCode,
    publicMessage, lifecycleAction, operationId
  };
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) : 'Unknown bounded error.';
}

export function validateReportDispositionResult(result, options) {
  if (!Array.isArray(result) || result.length !== 1) throw new Error('Report disposition RPC returned an invalid bounded result.');
  const row = result[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'disposition_code,lifecycle_action,report_id,report_state,skill_id,version_id,version_quarantined,version_revoked'
    || row.report_id !== options.reportId || row.report_state !== 'resolved'
    || row.disposition_code !== options.disposition
    || !/^skl_[0-9a-f]{32}$/.test(row.skill_id)
    || !/^skv_[0-9a-f]{32}$/.test(row.version_id)
    || row.lifecycle_action !== options.lifecycleAction
    || (options.lifecycleAction !== null
      && (typeof row.version_quarantined !== 'boolean'
        || typeof row.version_revoked !== 'boolean'))
    || (options.lifecycleAction === 'quarantine-version' && row.version_quarantined !== true)
    || (options.lifecycleAction === 'revoke-version' && row.version_revoked !== true)
    || (options.lifecycleAction === null
      && (row.version_quarantined !== null || row.version_revoked !== null))) {
    throw new Error('Report disposition RPC returned an invalid report projection.');
  }
}

function help() {
  return `SkillMap report disposition operator\n\n` +
    `Resolve one authenticated suspicious-listing report through a service-role-only idempotent RPC.\n` +
    `Confirmed reports atomically quarantine or revoke the exact reported version.\n` +
    `Approval and execution require distinct SKILLMAP_OPERATOR_CREDENTIAL values. ` +
    `Use exactly one mode; --approve records only the exact envelope, and --execute requires --approval-id.\n\n` +
    `Usage:\n` +
    `  node apps/worker/src/report-disposition.mjs --approve --report-id rpt_... --disposition confirmed --reason-code CODE --public-message MESSAGE --lifecycle-action quarantine-version --operation-id UUID\n` +
    `  node apps/worker/src/report-disposition.mjs --approve --report-id rpt_... --disposition no-action --reason-code CODE --public-message MESSAGE --operation-id UUID\n` +
    `Execute: repeat the exact action with --execute --approval-id opa_...\n`;
}

async function main(args) {
  try {
    const options = parseReportDispositionArguments(args);
    if (options.help) {
      process.stdout.write(help());
      return;
    }
    process.stdout.write(`${JSON.stringify(await runReportDisposition(options))}\n`);
  } catch (error) {
    process.stderr.write(`SkillMap report disposition command failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
