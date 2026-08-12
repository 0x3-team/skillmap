export interface CredentialRecord {
  deviceId: string;
  tokenFamilyId: string;
  refreshToken: string;
  scopes: string[];
  devicePublicId?: string;
  accountPublicId?: string;
  updatedAt: number;
  /** M3.08 generation. Optional only for legacy test records. New writes require it. */
  generation?: number;
  /** Immutable absolute family expiry, anchored to the original response issue time. */
  familyAbsoluteExpiresAt?: number;
}

export interface PendingCredentialOperation {
  idempotencyKey: string;
  requestDigest: string;
  wireVersion: string;
  responseVersion: string;
  expectedGeneration: number;
  requestStartedAt: number;
}

export interface CredentialState {
  record: CredentialRecord | null;
  pending: PendingCredentialOperation | null;
}

export interface CredentialStore {
  load(): Promise<CredentialRecord | null>;
  loadState(): Promise<CredentialState>;
  commitExchange(record: CredentialRecord): Promise<void>;
  markRefreshPending(pending: PendingCredentialOperation): Promise<PendingCredentialOperation>;
  commitRefresh(params: { pending: PendingCredentialOperation; record: CredentialRecord }): Promise<void>;
  delete(): Promise<void>;
}

function cloneRecord(record: CredentialRecord): CredentialRecord {
  return {
    ...record,
    scopes: [...record.scopes]
  };
}

function clonePending(pending: PendingCredentialOperation | null): PendingCredentialOperation | null {
  return pending ? { ...pending } : null;
}

function samePending(a: PendingCredentialOperation, b: PendingCredentialOperation): boolean {
  return a.idempotencyKey === b.idempotencyKey
    && a.requestDigest === b.requestDigest
    && a.wireVersion === b.wireVersion
    && a.responseVersion === b.responseVersion
    && a.expectedGeneration === b.expectedGeneration
    && a.requestStartedAt === b.requestStartedAt;
}

function validateRecord(record: CredentialRecord, requireM308 = false): void {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('credential_record_invalid');
  const allowed = new Set(['deviceId', 'tokenFamilyId', 'refreshToken', 'scopes', 'devicePublicId', 'accountPublicId', 'updatedAt', 'generation', 'familyAbsoluteExpiresAt']);
  if (Object.keys(record as object).some((key) => !allowed.has(key))) throw new Error('credential_record_invalid');
  if (!record.deviceId || !record.tokenFamilyId || !record.refreshToken
      || !Array.isArray(record.scopes) || !record.scopes.every((scope) => typeof scope === 'string')
      || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) {
    throw new Error('credential_record_invalid');
  }
  if (requireM308 && (!Number.isSafeInteger(record.generation) || (record.generation as number) < 0
      || !Number.isSafeInteger(record.familyAbsoluteExpiresAt) || (record.familyAbsoluteExpiresAt as number) <= 0)) {
    throw new Error('credential_record_invalid');
  }
  if (record.devicePublicId !== undefined && typeof record.devicePublicId !== 'string') throw new Error('credential_record_invalid');
  if (record.accountPublicId !== undefined && typeof record.accountPublicId !== 'string') throw new Error('credential_record_invalid');
  if (record.generation !== undefined && (!/^[A-Za-z0-9_-]{22}$/.test(record.deviceId)
      || !/^fam_[0-9a-f]{32}$/.test(record.tokenFamilyId) || !/^[A-Za-z0-9_-]{43}$/.test(record.refreshToken)
      || (record.devicePublicId !== undefined && !/^dev_[0-9a-f]{32}$/.test(record.devicePublicId))
      || (record.accountPublicId !== undefined && !/^acct_[0-9a-f]{32}$/.test(record.accountPublicId)))) throw new Error('credential_record_invalid');
  if (record.generation !== undefined && (!Number.isSafeInteger(record.generation) || record.generation < 0)) throw new Error('credential_record_invalid');
  if (record.familyAbsoluteExpiresAt !== undefined && (!Number.isSafeInteger(record.familyAbsoluteExpiresAt) || record.familyAbsoluteExpiresAt <= 0)) throw new Error('credential_record_invalid');
}

function validatePending(pending: PendingCredentialOperation): void {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) throw new Error('credential_pending_invalid');
  const allowed = new Set(['idempotencyKey', 'requestDigest', 'wireVersion', 'responseVersion', 'expectedGeneration', 'requestStartedAt']);
  if (Object.keys(pending as object).length !== 6 || Object.keys(pending as object).some((key) => !allowed.has(key))) throw new Error('credential_pending_invalid');
  if (!/^[A-Za-z0-9_-]{22}$/.test(pending.idempotencyKey)
      || !/^sha256:[0-9a-f]{64}$/.test(pending.requestDigest)
      || pending.wireVersion !== 'v1' || pending.responseVersion !== 'v1'
      || !Number.isSafeInteger(pending.expectedGeneration) || pending.expectedGeneration < 0
      || !Number.isSafeInteger(pending.requestStartedAt) || pending.requestStartedAt < 0) {
    throw new Error('credential_pending_invalid');
  }
}

export class InMemoryCredentialStore implements CredentialStore {
  private record: CredentialRecord | null = null;
  private pendingOperation: PendingCredentialOperation | null = null;
  private readonly clockFn: () => number;

  constructor(clock?: () => number) {
    this.clockFn = clock ?? (() => Math.floor(Date.now() / 1000));
  }

  public async load(): Promise<CredentialRecord | null> {
    return this.record ? cloneRecord(this.record) : null;
  }

  public async loadState(): Promise<CredentialState> {
    return {
      record: this.record ? cloneRecord(this.record) : null,
      pending: clonePending(this.pendingOperation)
    };
  }

  public async commitExchange(record: CredentialRecord): Promise<void> {
    validateRecord(record);
    const updatedAt = record.updatedAt > 0 ? record.updatedAt : this.clockFn();
    this.record = cloneRecord({ ...record, updatedAt });
    this.pendingOperation = null;
  }

  public async markRefreshPending(pending: PendingCredentialOperation): Promise<PendingCredentialOperation> {
    validatePending(pending);
    if (!this.record) throw new Error('credential_not_found');
    const generation = this.record.generation ?? 0;
    if (generation !== pending.expectedGeneration) throw new Error('credential_generation_conflict');
    if (this.pendingOperation) {
      if (!samePending(this.pendingOperation, pending)) throw new Error('credential_pending_conflict');
      return clonePending(this.pendingOperation)!;
    }
    this.pendingOperation = { ...pending };
    return clonePending(this.pendingOperation)!;
  }

  public async commitRefresh(params: { pending: PendingCredentialOperation; record: CredentialRecord }): Promise<void> {
    validatePending(params.pending);
    validateRecord(params.record, true);
    if (!this.record) throw new Error('credential_not_found');
    const currentGeneration = this.record.generation ?? 0;
    if (currentGeneration === params.record.generation && this.pendingOperation && samePending(this.pendingOperation, params.pending)) {
      if (params.record.generation !== params.pending.expectedGeneration + 1) throw new Error('credential_generation_invalid');
      this.record = cloneRecord(params.record);
      this.pendingOperation = null;
      return;
    }
    if (currentGeneration === params.record.generation && this.pendingOperation === null
        && this.record.refreshToken === params.record.refreshToken) return;
    if (currentGeneration !== params.pending.expectedGeneration || !this.pendingOperation || !samePending(this.pendingOperation, params.pending)) {
      throw new Error('credential_commit_conflict');
    }
    if (params.record.generation !== params.pending.expectedGeneration + 1) throw new Error('credential_generation_invalid');
    if (this.record.familyAbsoluteExpiresAt !== undefined && this.record.familyAbsoluteExpiresAt !== params.record.familyAbsoluteExpiresAt) throw new Error('credential_family_expiry_conflict');
    this.record = cloneRecord(params.record);
    this.pendingOperation = null;
  }

  public async delete(): Promise<void> {
    this.record = null;
    this.pendingOperation = null;
  }

  /** @deprecated M3.07 compatibility; active code uses markRefreshPending. */
  public async replaceRefreshGeneration(newRefreshToken: string, newFamilyId?: string, updatedAtSec?: number): Promise<void> {
    if (!this.record) throw new Error('Cannot replace refresh generation: no credential record found');
    this.record = { ...this.record, refreshToken: newRefreshToken, ...(newFamilyId ? { tokenFamilyId: newFamilyId } : {}), updatedAt: updatedAtSec ?? this.clockFn() };
  }

  /** @deprecated M3.07 compatibility; active code uses markRefreshPending. */
  public async markPendingOperation(pending: PendingCredentialOperation | null): Promise<void> {
    if (pending === null) { this.pendingOperation = null; return; }
    await this.markRefreshPending(pending);
  }

  /** @deprecated M3.07 compatibility; active code uses loadState. */
  public async getPendingOperation(): Promise<PendingCredentialOperation | null> {
    return clonePending(this.pendingOperation);
  }
}
