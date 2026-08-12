import type { CredentialRecord, CredentialState, CredentialStore, PendingCredentialOperation } from './credential-store.js';
import { MacOSHelperError, requestHelper, type MacOSHelperTransport } from './macos-keychain-helper-client.js';

function recordFrom(value: Record<string, unknown>): CredentialRecord {
  const allowed = new Set(['deviceId', 'tokenFamilyId', 'refreshToken', 'scopes', 'devicePublicId', 'accountPublicId', 'updatedAt', 'generation', 'familyAbsoluteExpiresAt']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('credential_record_invalid');
  if (typeof value.deviceId !== 'string' || typeof value.tokenFamilyId !== 'string' || typeof value.refreshToken !== 'string'
      || !Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === 'string')
      || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) throw new Error('credential_record_invalid');
  if (value.devicePublicId !== undefined && typeof value.devicePublicId !== 'string') throw new Error('credential_record_invalid');
  if (value.accountPublicId !== undefined && typeof value.accountPublicId !== 'string') throw new Error('credential_record_invalid');
  if (value.generation !== undefined && (!/^[A-Za-z0-9_-]{22}$/.test(value.deviceId)
      || !/^fam_[0-9a-f]{32}$/.test(value.tokenFamilyId) || !/^[A-Za-z0-9_-]{43}$/.test(value.refreshToken)
      || (value.devicePublicId !== undefined && !/^dev_[0-9a-f]{32}$/.test(value.devicePublicId))
      || (value.accountPublicId !== undefined && !/^acct_[0-9a-f]{32}$/.test(value.accountPublicId)))) throw new Error('credential_record_invalid');
  if (value.generation !== undefined && (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0)) throw new Error('credential_record_invalid');
  if (value.familyAbsoluteExpiresAt !== undefined && (!Number.isSafeInteger(value.familyAbsoluteExpiresAt) || (value.familyAbsoluteExpiresAt as number) <= 0)) throw new Error('credential_record_invalid');
  return {
    deviceId: value.deviceId,
    tokenFamilyId: value.tokenFamilyId,
    refreshToken: value.refreshToken,
    scopes: [...value.scopes] as string[],
    ...(typeof value.devicePublicId === 'string' ? { devicePublicId: value.devicePublicId } : {}),
    ...(typeof value.accountPublicId === 'string' ? { accountPublicId: value.accountPublicId } : {}),
    updatedAt: value.updatedAt,
    ...(value.generation !== undefined ? { generation: value.generation as number } : {}),
    ...(value.familyAbsoluteExpiresAt !== undefined ? { familyAbsoluteExpiresAt: value.familyAbsoluteExpiresAt as number } : {})
  };
}

function pendingFrom(value: unknown): PendingCredentialOperation | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new MacOSHelperError('credential_corrupt');
  const pending = value as Record<string, unknown>;
  const allowed = new Set(['idempotencyKey', 'requestDigest', 'wireVersion', 'responseVersion', 'expectedGeneration', 'requestStartedAt']);
  if (Object.keys(pending).some((key) => !allowed.has(key))) throw new MacOSHelperError('credential_corrupt');
  if (typeof pending.idempotencyKey !== 'string' || typeof pending.requestDigest !== 'string'
      || !/^[A-Za-z0-9_-]{22}$/.test(pending.idempotencyKey) || !/^sha256:[0-9a-f]{64}$/.test(pending.requestDigest)
      || pending.wireVersion !== 'v1' || pending.responseVersion !== 'v1'
      || !Number.isSafeInteger(pending.expectedGeneration) || (pending.expectedGeneration as number) < 0
      || !Number.isSafeInteger(pending.requestStartedAt) || (pending.requestStartedAt as number) < 0) throw new MacOSHelperError('credential_corrupt');
  return {
    idempotencyKey: pending.idempotencyKey,
    requestDigest: pending.requestDigest,
    wireVersion: pending.wireVersion,
    responseVersion: pending.responseVersion,
    expectedGeneration: pending.expectedGeneration as number,
    requestStartedAt: pending.requestStartedAt as number
  };
}

export class MacOSCredentialStore implements CredentialStore {
  public constructor(
    private readonly transport: MacOSHelperTransport,
    private readonly namespace = 'skillmap.device-auth.v1'
  ) {}

  public async loadState(): Promise<CredentialState> {
    const result = await requestHelper(this.transport, this.namespace, 'credential_load');
    const allowedResult = new Set(['record', 'pending']);
    if (Object.keys(result).some((key) => !allowedResult.has(key))) throw new MacOSHelperError('credential_corrupt');
    let record: CredentialRecord | null = null;
    if (result.record !== undefined && result.record !== null) {
      if (typeof result.record !== 'object' || Array.isArray(result.record)) throw new MacOSHelperError('credential_corrupt');
      try { record = recordFrom(result.record as Record<string, unknown>); }
      catch { throw new MacOSHelperError('credential_corrupt'); }
    }
    return { record, pending: pendingFrom(result.pending) };
  }

  public async load(): Promise<CredentialRecord | null> {
    return (await this.loadState()).record;
  }

  public async commitExchange(record: CredentialRecord): Promise<void> {
    try { recordFrom(record as unknown as Record<string, unknown>); }
    catch { throw new MacOSHelperError('credential_corrupt'); }
    await requestHelper(this.transport, this.namespace, 'credential_commit_exchange', { record });
  }

  public async markRefreshPending(pending: PendingCredentialOperation): Promise<PendingCredentialOperation> {
    pendingFrom(pending);
    const result = await requestHelper(this.transport, this.namespace, 'credential_mark_refresh_pending', { pending });
    return pendingFrom(result.pending) ?? pending;
  }

  public async commitRefresh(params: { pending: PendingCredentialOperation; record: CredentialRecord }): Promise<void> {
    pendingFrom(params.pending);
    try { recordFrom(params.record as unknown as Record<string, unknown>); }
    catch { throw new MacOSHelperError('credential_corrupt'); }
    await requestHelper(this.transport, this.namespace, 'credential_commit_refresh', { pending: params.pending, record: params.record });
  }

  public async delete(): Promise<void> {
    await requestHelper(this.transport, this.namespace, 'credential_delete');
  }

  /** @deprecated Retained only for old non-M3.08 callers; never used by the active protocol. */
  public async replaceRefreshGeneration(newRefreshToken: string, newFamilyId?: string, updatedAtSec?: number): Promise<void> {
    const state = await this.loadState();
    if (!state.record) throw new MacOSHelperError('not_found');
    await this.commitExchange({ ...state.record, refreshToken: newRefreshToken, ...(newFamilyId ? { tokenFamilyId: newFamilyId } : {}), updatedAt: updatedAtSec ?? state.record.updatedAt });
  }

  /** @deprecated Retained only for old tests; active protocol has no mark/get operation. */
  public async markPendingOperation(pending: PendingCredentialOperation | null): Promise<void> {
    if (pending === null) {
      const state = await this.loadState();
      if (state.record) await this.commitExchange(state.record);
      return;
    }
    await this.markRefreshPending(pending);
  }

  /** @deprecated Retained only for old tests; active protocol returns pending with credential_load. */
  public async getPendingOperation(): Promise<PendingCredentialOperation | null> {
    return (await this.loadState()).pending;
  }
}
