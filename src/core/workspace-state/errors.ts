import type { ArtifactRole } from './types.js';

export class WorkspaceStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceStateError';
    this.code = code;
  }
}

export class WorkspaceStateConflictError extends WorkspaceStateError {
  constructor(message: string) {
    super('STATE_CONFLICT', message);
    this.name = 'WorkspaceStateConflictError';
  }
}

export class RevisionValidationError extends WorkspaceStateError {
  readonly artifactPath?: string;
  readonly artifactRole?: ArtifactRole;

  constructor(code: string, message: string, artifactPath?: string, artifactRole?: ArtifactRole, options?: ErrorOptions) {
    super(code, message, options);
    this.name = 'RevisionValidationError';
    this.artifactPath = artifactPath;
    this.artifactRole = artifactRole;
  }
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
