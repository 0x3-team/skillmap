import type { LocalQuarantineOutcomeV1 } from '../contracts/local-quarantine-registry.js';

export type QuarantineFixtureClass = 'copied_fixture' | 'synthetic_fixture';

export interface RootCapability {
  rootId: string;
  configuredPath: string;
  canonicalRootPath: string;
  volumeId: number;
  rootFileId: number;
  fixtureClass: QuarantineFixtureClass;
  policyVersion: string;
  establishedAt: string;
}

export interface CandidateSnapshot {
  candidateId: string;
  rootId: string;
  relativePath: string;
  escapedRelativePath: string;
  canonicalSourcePath: string;
  sourceFileId: number;
  sourceVolumeId: number;
  sourceKind: 'file' | 'directory';
  size: number;
  mode: number;
  modifiedAtMs: number;
  changedAtMs: number;
  treeDigest: string;
  snapshotDigest: string;
  observedAt: string;
}

export interface DestinationReservation {
  quarantineRootId: string;
  escapedDestinationRelativePath: string;
  collisionCandidateIndex: number;
  collisionCandidateCount: 100;
  collisionAlgorithm: 'unsuffixed-then-dot-decimal';
  collisionAlgorithmVersion: 1;
  operationId: string;
  reservationNonce: string;
  destinationIdentityDigest: string;
}

export interface QuarantinePreflightSuccess {
  ok: true;
  policyVersion: string;
  sourcePath: string;
  destinationPath: string;
  destinationParentPath: string;
  sourceRootRealPath: string;
  quarantineRootRealPath: string;
  sourceRootVolumeId: number;
  sourceRootFileId: number;
  quarantineRootVolumeId: number;
  quarantineRootFileId: number;
  snapshot: CandidateSnapshot;
  reservation: DestinationReservation;
  preflightDigest: string;
}

export interface QuarantinePreflightFailure {
  ok: false;
  outcome: LocalQuarantineOutcomeV1;
}

export type QuarantinePreflightResult = QuarantinePreflightSuccess | QuarantinePreflightFailure;

export interface QuarantineAuthorization {
  action: 'quarantine';
  operationId: string;
  idempotencyKey: string;
  accountId: string;
  deviceId: string;
  sourceObjectId: string;
  immutableVersionId: string;
  contentDigest: string;
  candidateSnapshotDigest: string;
  preflightDigest: string;
  sourceRootId: string;
  escapedSourceRelativePath: string;
  quarantineRootId: string;
  destinationIdentityDigest: string;
  policyVersion: string;
  parityReceiptId: string;
  parityState: 'PARITY_CONFIRMED';
  cutoverAuthorityId: string;
  cutoverState: 'CUTOVER_AUTHORIZED';
  ownerConsentId: string;
  consentDigest: string;
  explicitConsentAt: string;
  consentExpiresAt: string;
  principalId: string;
  replayNonce: string;
}

export interface QuarantineMutationReceiptV1 {
  kind: 'skillmap.local-quarantine-receipt';
  schemaVersion: 1;
  status: 'MOVE_OBSERVED';
  receiptId: string;
  operationId: string;
  authorizationDigest: string;
  preflightDigest: string;
  candidateSnapshotDigest: string;
  contentDigest: string;
  sourceObjectId: string;
  quarantineObjectIdentityDigest: string;
  destinationIdentityDigest: string;
  quarantinedAt: string;
  restoreExpiresAt: string;
  receiptDigest: string;
}

export interface QuarantineMutationReceiptV2 extends Omit<QuarantineMutationReceiptV1, 'schemaVersion'> {
  schemaVersion: 2;
  treeDigest: string;
}

export type QuarantineMutationReceipt = QuarantineMutationReceiptV1 | QuarantineMutationReceiptV2;

export interface AtomicMoveBinding {
  sourceRootPath: string;
  sourceRootVolumeId: number;
  sourceRootFileId: number;
  sourceRelativePath: string;
  sourceObjectVolumeId: number;
  sourceObjectFileId: number;
  destinationRootPath: string;
  destinationRootVolumeId: number;
  destinationRootFileId: number;
  destinationRelativePath: string;
}

export interface AtomicNoReplaceMover {
  move(sourcePath: string, destinationPath: string, binding: AtomicMoveBinding): Promise<void>;
}

export interface RestoreAuthorization {
  action: 'restore';
  operationId: string;
  idempotencyKey: string;
  accountId: string;
  deviceId: string;
  quarantineReceiptId: string;
  quarantineObjectIdentityDigest: string;
  quarantineDestinationIdentityDigest: string;
  quarantineRootId: string;
  escapedQuarantineRelativePath: string;
  originalRootId: string;
  escapedOriginalRelativePath: string;
  originalDestinationIdentityDigest: string;
  immutableVersionId: string;
  contentDigest: string;
  previewDigest: string;
  ownerConsentId: string;
  consentDigest: string;
  parityReceiptId: string;
  cutoverAuthorityId: string;
  currentHostedLifecycleAuthorizationId: string;
  quarantinedAt: string;
  restoreExpiresAt: string;
  principalId: string;
  policyRevision: string;
  replayNonce: string;
}

export interface HostedRestoreAuthorityReceipt {
  kind: 'skillmap.hosted-restore-authority';
  schemaVersion: 1;
  state: 'RESTORE_AUTHORIZED';
  authorizationId: string;
  operationId: string;
  accountId: string;
  deviceId: string;
  immutableVersionId: string;
  contentDigest: string;
  previewDigest: string;
  ownerConsentId: string;
  consentDigest: string;
  parityReceiptId: string;
  cutoverAuthorityId: string;
  quarantineReceiptId: string;
  principalId: string;
  replayNonce: string;
  issuedAt: string;
  expiresAt: string;
  receiptDigest: string;
}

export interface HostedRestoreAuthorityProvider {
  loadCurrentRestoreAuthority(input: {
    authorizationId: string;
    operationId: string;
    quarantineReceiptId: string;
  }): Promise<HostedRestoreAuthorityReceipt>;
}

export interface RestoreMutationReceipt {
  kind: 'skillmap.local-restore-receipt';
  schemaVersion: 1;
  status: 'RESTORE_OBSERVED';
  receiptId: string;
  operationId: string;
  authorizationDigest: string;
  quarantineReceiptId: string;
  quarantineObjectIdentityDigest: string;
  originalDestinationIdentityDigest: string;
  contentDigest: string;
  restoredAt: string;
  receiptDigest: string;
}
