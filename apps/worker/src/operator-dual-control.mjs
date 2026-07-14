import { createOperatorSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APPROVAL_ID = /^opa_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OPERATOR_ID = /^opr_[0-9a-f]{32}$/;
const ACTION_RPC = Object.freeze({
  'submission.publisher-authorization': 'record_skill_submission_publisher_authorization',
  'submission.collision-review': 'review_skill_submission_collisions',
  'submission.publish': 'publish_skill_submission',
  'catalog.lifecycle': 'control_catalog_lifecycle',
  'report.disposition': 'disposition_skill_report'
});

export function acceptOperatorMode(argument, currentMode) {
  if (argument !== '--approve' && argument !== '--execute') return null;
  if (currentMode !== null) {
    throw new Error('Exactly one of --approve or --execute is required and may be supplied only once.');
  }
  return argument.slice(2);
}

export function finalizeOperatorMode(mode, rawApprovalId) {
  if (mode !== 'approve' && mode !== 'execute') {
    throw new Error('Exactly one of --approve or --execute is required.');
  }
  if (mode === 'approve') {
    if (rawApprovalId !== undefined) throw new Error('--approval-id is accepted only with --execute.');
    return Object.freeze({ mode, approvalId: null });
  }
  if (!APPROVAL_ID.test(rawApprovalId ?? '')) {
    throw new Error('--approval-id is required for --execute and must be one canonical operator approval ID.');
  }
  return Object.freeze({ mode, approvalId: rawApprovalId });
}

export async function runDualControlledOperatorAction(action, dependencies = {}) {
  validateAction(action);
  const rpc = dependencies.rpc ?? createOperatorSupabaseRpcClientFromEnvironment({
    mode: action.mode,
    approvalId: action.approvalId
  });
  if (action.mode === 'approve') {
    const result = await rpc.call('approve_operator_action', {
      p_action_kind: action.actionKind,
      p_subject_type: action.subjectType,
      p_subject_id: action.subjectId,
      p_action_payload: action.actionPayload,
      p_action_digest: action.actionDigest,
      p_operation_id: action.operationId
    });
    return Object.freeze({ mode: 'approve', approval: validateApprovalResult(result, action.actionDigest) });
  }
  const result = await rpc.call(action.businessRpc, action.businessParameters);
  return Object.freeze({ mode: 'execute', result });
}

function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)
    || !Object.hasOwn(ACTION_RPC, action.actionKind)
    || ACTION_RPC[action.actionKind] !== action.businessRpc
    || typeof action.subjectType !== 'string' || typeof action.subjectId !== 'string'
    || !action.actionPayload || typeof action.actionPayload !== 'object' || Array.isArray(action.actionPayload)
    || !DIGEST.test(action.actionDigest ?? '') || !UUID.test(action.operationId ?? '')
    || !action.businessParameters || typeof action.businessParameters !== 'object'
    || Array.isArray(action.businessParameters)) {
    throw new Error('Dual-controlled operator action is invalid.');
  }
  const validSubject = action.actionKind.startsWith('submission.')
    ? action.subjectType === 'submission' && /^sub_[0-9a-f]{32}$/.test(action.subjectId)
    : action.actionKind === 'report.disposition'
      ? action.subjectType === 'report' && /^rpt_[0-9a-f]{32}$/.test(action.subjectId)
      : (action.subjectType === 'skill' && /^skl_[0-9a-f]{32}$/.test(action.subjectId))
        || (action.subjectType === 'skill-version' && /^skv_[0-9a-f]{32}$/.test(action.subjectId));
  if (!validSubject) throw new Error('Dual-controlled operator subject is invalid.');
  const mode = finalizeOperatorMode(action.mode, action.approvalId === null ? undefined : action.approvalId);
  if (mode.mode !== action.mode || mode.approvalId !== action.approvalId) {
    throw new Error('Dual-controlled operator mode is invalid.');
  }
}

function validateApprovalResult(result, actionDigest) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Operator approval RPC returned an invalid bounded result.');
  }
  const row = result[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).sort().join(',') !== 'action_digest,approval_id,approver_id,expires_at'
    || !APPROVAL_ID.test(row.approval_id ?? '')
    || row.action_digest !== actionDigest
    || !OPERATOR_ID.test(row.approver_id ?? '')
    || typeof row.expires_at !== 'string' || !Number.isFinite(Date.parse(row.expires_at))) {
    throw new Error('Operator approval RPC returned an invalid approval projection.');
  }
  return Object.freeze({ ...row });
}
