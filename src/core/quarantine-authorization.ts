import { validateImportParityReceipt, type ImportParityReceipt } from './import-parity.js';
import type { QuarantineAuthorization, QuarantinePreflightSuccess } from './quarantine-types.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function bindQuarantineAuthorization(input: {
  parityReceipt: ImportParityReceipt;
  preflight: QuarantinePreflightSuccess;
  idempotencyKey: string;
  principalId: string;
  replayNonce: string;
  now?: Date;
}): QuarantineAuthorization {
  const now = input.now ?? new Date();
  validateImportParityReceipt(input.parityReceipt, now);
  if (!SAFE_ID.test(input.idempotencyKey) || !SAFE_ID.test(input.principalId) || !SAFE_ID.test(input.replayNonce)) {
    throw new Error('Quarantine authorization identity is invalid.');
  }
  const candidate = input.parityReceipt.eligibleCandidates[0]!;
  if (candidate.rootId !== input.preflight.snapshot.rootId
    || candidate.relativePath !== input.preflight.snapshot.relativePath) {
    throw new Error('PARITY_CANDIDATE_MISMATCH');
  }
  return {
    action: 'quarantine',
    operationId: input.preflight.reservation.operationId,
    idempotencyKey: input.idempotencyKey,
    accountId: input.parityReceipt.accountId,
    deviceId: input.parityReceipt.deviceId,
    sourceObjectId: candidate.sourceObjectId,
    immutableVersionId: candidate.immutableVersionId,
    contentDigest: candidate.contentDigest,
    candidateSnapshotDigest: input.preflight.snapshot.snapshotDigest,
    preflightDigest: input.preflight.preflightDigest,
    sourceRootId: input.preflight.snapshot.rootId,
    escapedSourceRelativePath: input.preflight.snapshot.escapedRelativePath,
    quarantineRootId: input.preflight.reservation.quarantineRootId,
    destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest,
    policyVersion: input.preflight.policyVersion,
    parityReceiptId: input.parityReceipt.receiptId,
    parityState: input.parityReceipt.parityState,
    cutoverAuthorityId: input.parityReceipt.cutoverAuthorityId,
    cutoverState: input.parityReceipt.cutoverState,
    ownerConsentId: input.parityReceipt.ownerConsentId,
    consentDigest: input.parityReceipt.consentDigest,
    explicitConsentAt: input.parityReceipt.explicitConsentAt,
    consentExpiresAt: input.parityReceipt.consentExpiresAt,
    principalId: input.principalId,
    replayNonce: input.replayNonce
  };
}
