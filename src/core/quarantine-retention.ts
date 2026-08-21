import {
  LOCAL_QUARANTINE_OUTCOMES,
  type LocalQuarantineOutcomeV1
} from '../contracts/local-quarantine-registry.js';

export interface QuarantineRetentionReceipt {
  quarantinedAt: string;
  restoreExpiresAt: string;
}

export interface QuarantineRetentionProjection extends QuarantineRetentionReceipt {
  canRestore: boolean;
}

function parseUtcTimestamp(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

export function computeRestoreExpiryUtc(quarantinedAt: string): string {
  const value = parseUtcTimestamp(quarantinedAt, 'quarantinedAt');
  value.setUTCDate(value.getUTCDate() + 30);
  return value.toISOString();
}

function validateReceipt(receipt: QuarantineRetentionReceipt): { quarantinedAt: Date; restoreExpiresAt: Date } {
  const quarantinedAt = parseUtcTimestamp(receipt.quarantinedAt, 'quarantinedAt');
  const restoreExpiresAt = parseUtcTimestamp(receipt.restoreExpiresAt, 'restoreExpiresAt');
  if (receipt.restoreExpiresAt !== computeRestoreExpiryUtc(receipt.quarantinedAt)) {
    throw new Error('restoreExpiresAt must be exactly 30 UTC calendar days after quarantinedAt.');
  }
  return { quarantinedAt, restoreExpiresAt };
}

export function assertRestoreWindowOpen(
  receipt: QuarantineRetentionReceipt,
  now: Date = new Date()
): LocalQuarantineOutcomeV1 | undefined {
  const { restoreExpiresAt } = validateReceipt(receipt);
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid timestamp.');
  return now.getTime() < restoreExpiresAt.getTime()
    ? undefined
    : LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_RESTORE_WINDOW_EXPIRED;
}

export function projectQuarantineRetention(
  receipt: QuarantineRetentionReceipt,
  now: Date = new Date()
): QuarantineRetentionProjection {
  validateReceipt(receipt);
  return {
    quarantinedAt: receipt.quarantinedAt,
    restoreExpiresAt: receipt.restoreExpiresAt,
    canRestore: assertRestoreWindowOpen(receipt, now) === undefined
  };
}
