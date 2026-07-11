export interface PayloadDigestVerification {
  ok: boolean;
  actual?: string;
  expected?: string;
  error?: string;
}

export interface DashboardSnapshotV2Validation {
  ok: boolean;
  issues: string[];
}

export function canonicalPayloadJson(snapshot: unknown): string;
export function computePayloadDigest(snapshot: unknown): string;
export function computeTransportDigest(raw: string): string;
export function verifyPayloadDigest(snapshot: unknown): PayloadDigestVerification;
export function validateDashboardSnapshotV2(snapshot: unknown): DashboardSnapshotV2Validation;
export function isSha256Digest(value: unknown): boolean;
