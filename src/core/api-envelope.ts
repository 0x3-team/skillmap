import { randomUUID } from 'node:crypto';
import { assertContract } from '../contracts/validate.js';
import type { ApiErrorEnvelope, ApiSuccessEnvelope, RevisionRef } from '../schemas/types.js';

export type ApiCompatibility = ApiSuccessEnvelope<unknown>['compatibility'];

export interface ApiReceiptContext {
  servingRevision: RevisionRef | null;
  currentRevision: RevisionRef | null;
  compatibility?: ApiCompatibility;
  requestId?: string;
}

const API_ENVELOPE_SCHEMA = 'https://skillmap.dev/contracts/api-envelope/v1.schema.json';

export function apiSuccess<T>(data: T, context: ApiReceiptContext): ApiSuccessEnvelope<T> {
  const envelope: ApiSuccessEnvelope<T> = {
    kind: 'skillmap.api-response',
    schemaVersion: 1,
    ok: true,
    requestId: context.requestId ?? randomUUID(),
    servingRevision: context.servingRevision,
    currentRevision: context.currentRevision,
    compatibility: context.compatibility ?? 'compatible',
    data
  };
  assertContract(API_ENVELOPE_SCHEMA, envelope);
  return envelope;
}

export function apiError(
  code: string,
  message: string,
  context: ApiReceiptContext,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {}
): ApiErrorEnvelope {
  const safeMessage = sanitizeSafeMessage(message);
  const envelope: ApiErrorEnvelope = {
    kind: 'skillmap.api-response',
    schemaVersion: 1,
    ok: false,
    requestId: context.requestId ?? randomUUID(),
    servingRevision: context.servingRevision,
    currentRevision: context.currentRevision,
    compatibility: context.compatibility ?? 'compatible',
    error: {
      code: normalizeCode(code),
      message: safeMessage,
      retryable: options.retryable ?? false,
      ...(options.details ? { details: options.details } : {})
    }
  };
  assertContract(API_ENVELOPE_SCHEMA, envelope);
  return envelope;
}

export function revisionConflict(
  expectedRevision: string,
  currentRevision: RevisionRef | null,
  context: Omit<ApiReceiptContext, 'currentRevision'>
): ApiErrorEnvelope {
  return apiError('REVISION_CONFLICT', 'The workspace changed before this operation could be applied.', {
    ...context,
    currentRevision
  }, {
    retryable: true,
    details: { expectedRevision, currentRevisionId: currentRevision?.revisionId ?? null }
  });
}

export function sanitizeSafeMessage(message: string): string {
  const bounded = String(message).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240);
  if (containsFilesystemLocation(bounded)) {
    return 'A local filesystem operation failed. Review the local SkillMap diagnostics for details.';
  }
  if (containsSensitiveText(bounded)) {
    return 'The operation failed without exposing sensitive diagnostic details.';
  }
  return bounded || 'The operation failed.';
}

export function containsSensitiveText(value: string): boolean {
  return /\b(?:Bearer|token|secret|password|private[ -]?key|api[ _-]?key)\b/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b(?:set-cookie|cookie)\s*:/i.test(value)
    || /\b(?:session|sessionid|session_id)\s*=/i.test(value);
}

export function containsFilesystemLocation(value: string): boolean {
  return /file:\/\//i.test(value)
    || /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]*/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:[\\/][^\s"'<>),;]*/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]*/.test(value);
}

function normalizeCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return normalized || 'INTERNAL_ERROR';
}
