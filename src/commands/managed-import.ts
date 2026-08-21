import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertQualifiedInventory } from '../core/identity.js';
import { buildImportManifest, type BuildImportManifestOptions } from '../core/import-manifest-builder.js';
import { buildImportPreview, nonImportableToPreviewRecords } from '../core/import-preview.js';
import { CliExitError, CLI_EXIT_CODES, SAFE_ERROR_MESSAGES } from '../core/cli-exit.js';
import { DeviceAuthClient } from '../network/device-auth-client.js';
import { ImportClient, ImportClientError } from '../network/import-client.js';
import { ImportUploader } from '../network/import-uploader.js';
import { createMacOSCustodyStores, MacOSCustodyError } from '../platform/macos-custody-factory.js';
import type { Inventory, SkillRecord } from '../schemas/types.js';
import { DeviceAuthUseCase } from '../services/device-auth-use-case.js';
import {
  ManagedImportError,
  runManagedImport,
  type ManagedImportDependencies,
  type ManagedImportRequest,
  type ManagedImportResult
} from '../services/managed-import-use-case.js';

const CHECKPOINT_KIND = 'skillmap.managed-import-checkpoint';
const CHECKPOINT_VERSION = 1;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

interface ManagedImportCheckpoint {
  kind: typeof CHECKPOINT_KIND;
  version: typeof CHECKPOINT_VERSION;
  skillId: string;
  contentRevision: string;
  startedAt: string;
  state: 'in_progress' | 'blocked' | 'awaiting_owner_consent' | 'verified';
  sessionPublicId?: string;
}

export interface ManagedImportCommandDeps {
  runtimeFactory?: () => Promise<ManagedImportDependencies>;
  runManagedImportFn?: typeof runManagedImport;
  now?: () => Date;
}

function checkpointFile(cwd: string, skillId: string): string {
  const key = createHash('sha256').update(`skillmap.m4.checkpoint\0${skillId}`, 'utf8').digest('hex').slice(0, 32);
  return path.join(cwd, '.skillmap', 'imports', 'vault', `${key}.json`);
}

function isCheckpoint(value: unknown): value is ManagedImportCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const allowed = new Set(['kind', 'version', 'skillId', 'contentRevision', 'startedAt', 'state', 'sessionPublicId']);
  if (Object.keys(row).some((key) => !allowed.has(key))) return false;
  return row.kind === CHECKPOINT_KIND
    && row.version === CHECKPOINT_VERSION
    && typeof row.skillId === 'string'
    && typeof row.contentRevision === 'string'
    && typeof row.startedAt === 'string'
    && Number.isFinite(Date.parse(row.startedAt))
    && ['in_progress', 'blocked', 'awaiting_owner_consent', 'verified'].includes(String(row.state))
    && (row.sessionPublicId === undefined || /^imp_[0-9a-f]{32}$/.test(String(row.sessionPublicId)));
}

async function readCheckpoint(file: string): Promise<ManagedImportCheckpoint | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return isCheckpoint(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}

async function writeCheckpoint(file: string, checkpoint: ManagedImportCheckpoint): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${createHash('sha256').update(checkpoint.startedAt).digest('hex').slice(0, 8)}`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

async function loadInventory(cwd: string): Promise<Inventory> {
  const file = path.join(cwd, '.skillmap', 'inventory.json');
  let value: Inventory;
  try {
    value = JSON.parse(await readFile(file, 'utf8')) as Inventory;
  } catch {
    throw new CliExitError(CLI_EXIT_CODES.USAGE, SAFE_ERROR_MESSAGES.usage_error, 'usage_error');
  }
  assertQualifiedInventory(value, 'import a managed skill');
  return value;
}

async function resolveInventorySkill(cwd: string, inventory: Inventory, requested: string): Promise<{
  skill: SkillRecord;
  skillDir: string;
  manifestOptions: BuildImportManifestOptions;
  sourceObjectId: string;
}> {
  const requestedReal = await realpath(path.resolve(cwd, requested));
  const matches: Array<{ skill: SkillRecord; skillDir: string }> = [];
  for (const skill of inventory.skills) {
    const root = inventory.rootRecords.find((entry) => entry.rootId === skill.rootId);
    if (!root) continue;
    const candidate = await realpath(path.resolve(root.realPath, ...skill.relativePath.split('/'))).catch(() => undefined);
    if (candidate === requestedReal) matches.push({ skill, skillDir: candidate });
  }
  if (matches.length !== 1) {
    throw new CliExitError(CLI_EXIT_CODES.USAGE, SAFE_ERROR_MESSAGES.usage_error, 'usage_error');
  }
  const { skill, skillDir } = matches[0];
  const rootRecord = inventory.rootRecords.find((entry) => entry.rootId === skill.rootId)!;
  const sourceObjectId = `lso_${createHash('sha256')
    .update(`skillmap.m4.local-source\0${skill.rootId}\0${skill.relativePath}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
  const manifestOptions: BuildImportManifestOptions = {
    rootRecord,
    publicId: skill.skillId,
    logicalId: skill.skillId,
    source: {
      authority: 'managed',
      kind: 'local',
      namespace: inventory.workspaceId,
      source_id: skill.skillId,
      revision: skill.contentRevision
    },
    provenance: {
      publisher_id: inventory.workspaceId,
      ingest_id: `m4-${skill.skillId}`,
      created_at: rootRecord.approvedAt
    }
  };
  return { skill, skillDir, manifestOptions, sourceObjectId };
}

async function defaultRuntimeFactory(): Promise<ManagedImportDependencies> {
  if (process.platform !== 'darwin'
    || process.env.SKILLMAP_ENABLE_MACOS_CUSTODY !== '1'
    || !process.env.SKILLMAP_DEVICE_AUTH_ORIGIN) {
    throw new CliExitError(
      CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
      SAFE_ERROR_MESSAGES.secure_storage_unavailable,
      'secure_storage_unavailable'
    );
  }
  try {
    const origin = process.env.SKILLMAP_DEVICE_AUTH_ORIGIN;
    const stores = createMacOSCustodyStores();
    const authClient = new DeviceAuthClient({ origin, keyStore: stores.keyStore, metadataStore: stores.metadataStore });
    const auth = new DeviceAuthUseCase({
      client: authClient,
      keyStore: stores.keyStore,
      credentialStore: stores.credentialStore,
      metadataStore: stores.metadataStore
    });
    const client = new ImportClient({
      origin,
      keyStore: stores.keyStore,
      deviceId: await authClient.getDeviceId(),
      production: process.env.NODE_ENV === 'production'
    });
    return { auth, client, uploader: new ImportUploader({ client }) };
  } catch (error) {
    if (error instanceof MacOSCustodyError) {
      throw new CliExitError(
        CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
        SAFE_ERROR_MESSAGES.secure_storage_unavailable,
        'secure_storage_unavailable'
      );
    }
    throw error;
  }
}

function safeSummary(result: ManagedImportResult): string {
  if (result.state === 'awaiting_owner_consent') {
    return 'Upload complete. Open the SkillMap Import page, approve this session, then run the same command again.';
  }
  if (result.state === 'verified') {
    return 'Cloud import parity is verified. Local quarantine remains a separate explicit action.';
  }
  return 'Import is blocked. Review the bounded blocker list and correct the local copy.';
}

function assertInventoryRevision(currentRevision: string | undefined, inventoryRevision: string): string {
  if (currentRevision !== inventoryRevision) {
    throw new CliExitError(
      CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
      SAFE_ERROR_MESSAGES.IMPORT_SOURCE_CHANGED,
      'IMPORT_SOURCE_CHANGED'
    );
  }
  return currentRevision;
}

export async function managedImportCommand(
  cwd: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
  deps: ManagedImportCommandDeps = {}
): Promise<unknown> {
  if (positionals.length !== 1
    || Object.keys(flags).some((flag) => !['dry-run', 'json'].includes(flag))
    || Object.values(flags).some(Array.isArray)) {
    throw new CliExitError(CLI_EXIT_CODES.USAGE, SAFE_ERROR_MESSAGES.usage_error, 'usage_error');
  }
  const inventory = await loadInventory(cwd);
  const resolved = await resolveInventorySkill(cwd, inventory, positionals[0]);
  const now = deps.now ? deps.now() : new Date();
  const requestBase: Omit<ManagedImportRequest, 'sessionStartedAt'> = {
    skillDir: resolved.skillDir,
    sourceObjectId: resolved.sourceObjectId,
    rootId: resolved.skill.rootId,
    relativePath: resolved.skill.relativePath,
    manifestOptions: resolved.manifestOptions
  };

  if (flags['dry-run'] === true) {
    const manifest = await buildImportManifest(resolved.skillDir, resolved.manifestOptions);
    assertInventoryRevision(manifest.sourceReceipt.contentRevision, resolved.skill.contentRevision);
    const preview = buildImportPreview([manifest], { blockedRecords: nonImportableToPreviewRecords(manifest) });
    return {
      state: manifest.importable ? 'preview' : 'blocked',
      preview,
      summary: manifest.importable
        ? 'Managed import preview is ready. No authentication, upload, or local mutation occurred.'
        : 'Managed import is blocked. No authentication, upload, or local mutation occurred.'
    };
  }

  const preflight = await buildImportManifest(resolved.skillDir, resolved.manifestOptions);
  const currentContentRevision = assertInventoryRevision(
    preflight.sourceReceipt.contentRevision,
    resolved.skill.contentRevision
  );
  if (!preflight.importable) {
    const preview = buildImportPreview([preflight], { blockedRecords: nonImportableToPreviewRecords(preflight) });
    return {
      state: 'blocked',
      blockedItems: preflight.nonImportable,
      preview,
      summary: 'Managed import is blocked. No authentication, upload, or local mutation occurred.'
    };
  }

  const file = checkpointFile(cwd, resolved.skill.skillId);
  const existing = await readCheckpoint(file);
  const reusable = existing
    && existing.skillId === resolved.skill.skillId
    && existing.contentRevision === currentContentRevision
    && (existing.state === 'in_progress' || existing.state === 'awaiting_owner_consent')
    && Date.parse(existing.startedAt) + SESSION_TTL_MS > now.getTime();
  const checkpoint: ManagedImportCheckpoint = reusable ? existing : {
    kind: CHECKPOINT_KIND,
    version: CHECKPOINT_VERSION,
    skillId: resolved.skill.skillId,
    contentRevision: currentContentRevision,
    startedAt: now.toISOString(),
    state: 'in_progress'
  };
  await writeCheckpoint(file, checkpoint);

  try {
    const runtime = await (deps.runtimeFactory ?? defaultRuntimeFactory)();
    const result = await (deps.runManagedImportFn ?? runManagedImport)({ ...requestBase, sessionStartedAt: checkpoint.startedAt }, {
      ...runtime,
      now: () => now
    });
    await writeCheckpoint(file, {
      ...checkpoint,
      state: result.state,
      ...(result.sessionPublicId ? { sessionPublicId: result.sessionPublicId } : {})
    });
    return { ...result, summary: safeSummary(result) };
  } catch (error) {
    if (error instanceof ImportClientError) {
      const exitCode = error.code === 'unauthorized' || error.code === 'insufficient_scope'
        ? CLI_EXIT_CODES.UNAUTHENTICATED
        : error.code === 'rate_limited' || error.code === 'temporarily_unavailable'
          ? CLI_EXIT_CODES.UNREACHABLE
          : error.code === 'invalid_request'
            ? CLI_EXIT_CODES.USAGE
            : CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR;
      throw new CliExitError(
        exitCode,
        SAFE_ERROR_MESSAGES[error.code] ?? 'The managed import failed.',
        error.code
      );
    }
    if (error instanceof ManagedImportError) {
      throw new CliExitError(
        CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
        SAFE_ERROR_MESSAGES[error.code] ?? 'The managed import failed a local integrity check.',
        error.code
      );
    }
    throw error;
  }
}
