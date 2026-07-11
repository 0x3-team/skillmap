export const STATE_SCHEMA_VERSION = 1 as const;
export const STATE_LAYOUT_VERSION = 1 as const;

export type ArtifactRole = 'canonical-intent' | 'raw-truth' | 'derived';
export type PointerKind = 'skillmap.workspace-current' | 'skillmap.workspace-last-known-good';

export interface ArtifactRule {
  role: ArtifactRole;
  routingCritical: boolean;
}

export interface RevisionArtifact extends ArtifactRule {
  path: string;
  bytes: number;
  digest: string;
}

export interface RevisionMutation {
  kind: 'legacy-migration' | 'legacy-snapshot' | 'rollback' | 'recovery';
  actor?: string;
  reason?: string;
  sourceRevisionId?: string;
  targetRevisionId?: string;
}

export interface WorkspaceRevisionManifest {
  kind: 'skillmap.workspace-revision';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  workspaceId: string;
  revisionId: string;
  sequence: number;
  parentRevisionId: string | null;
  createdAt: string;
  fencingToken: number;
  mutation: RevisionMutation;
  canonicalIntentDigest: string;
  rawTruthDigest: string;
  routingSafetyDigest: string;
  readModelDigest: string;
  effectiveDigest: string | null;
  effectiveRevisionDigest: string | null;
  workspaceRevision: string;
  artifacts: RevisionArtifact[];
  producer: { name: 'skillmap'; version: string };
  compatibility: { minReaderSchemaVersion: 1; maxReaderSchemaVersion: 1 };
  redaction: { classification: 'local-sensitive' };
  payloadDigest: string;
}

export interface RoutingApprovalReceipt {
  kind: 'skillmap.routing-approval';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  revisionId: string;
  routingSafetyDigest: string;
  approvedAt: string;
  receiptDigest: string;
}

export interface WorkspacePointer {
  kind: PointerKind;
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  workspaceId: string;
  revisionId: string;
  sequence: number;
  workspaceRevision: string;
  manifestDigest: string;
  canonicalIntentDigest: string;
  rawTruthDigest: string;
  routingSafetyDigest: string;
  readModelDigest: string;
  effectiveDigest: string | null;
  effectiveRevisionDigest: string | null;
  fencingToken: number;
  publishedAt: string;
  routingApproval?: RoutingApprovalReceipt;
  payloadDigest: string;
}

export interface WorkspaceStateMarker {
  kind: 'skillmap.workspace-state';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  layoutVersion: typeof STATE_LAYOUT_VERSION;
  workspaceId: string;
  migrationRevisionId: string;
  activatedAt: string;
  legacyMode: 'read-only-projection';
  payloadDigest: string;
}

export interface FenceState {
  kind: 'skillmap.workspace-fence';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  token: number;
  updatedAt: string;
  payloadDigest: string;
}

export interface LockOwner {
  kind: 'skillmap.workspace-writer-lock';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  ownerId: string;
  pid: number;
  hostname: string;
  operation: string;
  acquiredAt: string;
  expiresAt: string;
  fencingToken: number;
  payloadDigest: string;
}

export interface LegacyProjectionIndex {
  kind: 'skillmap.legacy-projection-index';
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  workspaceId: string;
  revisionId: string;
  generatedAt: string;
  artifacts: RevisionArtifact[];
  payloadDigest: string;
}

export type DivergenceSeverity = 'blocking' | 'warning';

export interface LegacyDivergence {
  path: string;
  role: ArtifactRole;
  severity: DivergenceSeverity;
  code: 'missing' | 'unexpected' | 'digest-mismatch' | 'type-mismatch' | 'projection-index-mismatch';
  expectedDigest?: string;
  actualDigest?: string;
}

export interface ValidatedRevision {
  directory: string;
  manifest: WorkspaceRevisionManifest;
  manifestDigest: string;
}

export interface WorkspaceStateRead {
  source: 'current' | 'last-known-good';
  currentPointer: WorkspacePointer;
  selectedPointer: WorkspacePointer;
  revision: ValidatedRevision;
  currentFailure?: {
    code: string;
    message: string;
    artifactPath?: string;
    artifactRole?: ArtifactRole;
  };
  legacyDivergence: LegacyDivergence[];
}

export interface PublishOptions {
  expectedRevisionId?: string;
  approveForRouting?: boolean;
  actor?: string;
  reason?: string;
}

export interface MigrationOptions {
  confirm: boolean;
  approveForRouting?: boolean;
  actor?: string;
  reason?: string;
}

export interface RollbackOptions extends PublishOptions {
  targetRevisionId: string;
  expectedRevisionId: string;
}

export interface RecoveryOptions {
  confirm: boolean;
  actor?: string;
  reason?: string;
}

export interface PublicationResult {
  pointer: WorkspacePointer;
  manifest: WorkspaceRevisionManifest;
  lastKnownGoodUpdated: boolean;
  projectionIndexUpdated: boolean;
  warnings: string[];
}

export interface VerifiedRevisionAncestryPage {
  currentPointer: WorkspacePointer;
  revisions: ValidatedRevision[];
  nextRevisionId: string | null;
}

export interface WorkspaceMutationLock {
  readonly fencingToken: number;
  readonly ownerId: string;
  migrateLegacy(options: MigrationOptions): Promise<PublicationResult>;
  publishLegacySnapshot(options?: PublishOptions): Promise<PublicationResult>;
}

export type WorkspaceStateFailpoint =
  | 'after-lock-acquired'
  | 'after-revision-created'
  | 'after-artifact-written'
  | 'after-manifest-synced'
  | 'before-current-pointer-swap'
  | 'after-current-pointer-swap'
  | 'after-last-known-good-swap';

export interface WorkspaceStateStoreOptions {
  producerVersion?: string;
  lockLeaseMs?: number;
  now?: () => Date;
  failpoint?: (name: WorkspaceStateFailpoint) => void | Promise<void>;
}
