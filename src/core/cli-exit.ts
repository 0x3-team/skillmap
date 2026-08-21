import { spawn } from 'node:child_process';
import { DeviceAuthUseCase, type DisplayCodeInfo } from '../services/device-auth-use-case.js';
import { DeviceAuthClient, DeviceAuthError } from '../network/device-auth-client.js';
import type { DeviceKeyStore } from '../platform/device-key-store.js';
import type { CredentialStore } from '../platform/credential-store.js';
import type { DeviceAuthMetadataStore } from '../platform/device-auth-metadata-store.js';
import { createMacOSCustodyStores, MacOSCustodyError } from '../platform/macos-custody-factory.js';

export const CLI_EXIT_CODES = {
  SUCCESS: 0,
  UNAUTHENTICATED: 2,
  UNREACHABLE: 3,
  INTEGRITY_PROTOCOL_ERROR: 4,
  USAGE: 64,
  INTERRUPT: 130
} as const;

export class CliExitError extends Error {
  public readonly exitCode: number;
  public readonly code: string;
  public readonly payload?: Record<string, unknown>;

  constructor(exitCode: number, message: string, code = 'cli_error', payload?: Record<string, unknown>) {
    super(message);
    this.name = 'CliExitError';
    this.exitCode = exitCode;
    this.code = code;
    this.payload = payload;
  }
}

export type DeviceAuthUseCaseFactory = (arg: {
  client: DeviceAuthClient;
  keyStore: DeviceKeyStore;
  credentialStore: CredentialStore;
  metadataStore: DeviceAuthMetadataStore;
  onDisplayCode?: (info: DisplayCodeInfo) => void;
  openBrowser?: (url: string) => Promise<boolean>;
}) => DeviceAuthUseCase;

export interface DeviceAuthCommandDeps {
  useCase?: DeviceAuthUseCase;
  useCaseFactory?: DeviceAuthUseCaseFactory;
  client?: DeviceAuthClient;
  keyStore?: DeviceKeyStore;
  credentialStore?: CredentialStore;
  metadataStore?: DeviceAuthMetadataStore;
  openBrowser?: (url: string) => Promise<boolean>;
  onDisplayCode?: (info: DisplayCodeInfo) => void;
  signal?: AbortSignal;
}

export const SAFE_ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'The request is invalid.',
  invalid_scope: 'The requested scope is invalid.',
  invalid_grant: 'The authorization grant is invalid.',
  authorization_pending: 'Authorization is pending.',
  slow_down: 'Polling must slow down.',
  access_denied: 'Authorization was not granted.',
  expired_token: 'The authorization grant has expired.',
  invalid_client: 'Client authentication failed.',
  invalid_token: 'The access token is invalid.',
  proof_required: 'Device proof is required.',
  proof_invalid: 'Device proof is invalid.',
  insufficient_scope: 'The token does not permit this operation.',
  already_consumed: 'The authorization grant is no longer available.',
  idempotency_conflict: 'The request conflicts with a prior operation.',
  rate_limited: 'Too many requests.',
  secure_storage_unavailable: 'Secure credential storage is unavailable.',
  temporarily_unavailable: 'The service is temporarily unavailable.',
  unreachable: 'Remote service is unreachable.',
  usage_error: 'Invalid CLI command or flags.',
  user_cancelled: 'Operation cancelled by user.',
  interrupt: 'Operation interrupted.',
  signed_out: 'Unauthenticated: signed out.',
  expired: 'Unauthenticated: session expired.',
  revoked: 'Unauthenticated: device revoked.',
  unauthorized: 'The import request is not authorized.',
  session_not_found: 'The import session was not found.',
  session_expired: 'The import session has expired.',
  session_conflict: 'The import session conflicts with a concurrent operation.',
  owner_consent_required: 'Owner consent is required before this import can be finalized.',
  already_accepted: 'The file is already accepted in this session.',
  invalid_response: 'The import service returned an invalid response.',
  IMPORT_SOURCE_CHANGED: 'The local import source changed after scanning.',
  IMPORT_UPLOAD_INCOMPLETE: 'The import upload did not reach exact parity.',
  IMPORT_CHECKPOINT_INVALID: 'The import checkpoint is invalid.',
  IMPORT_CHECKPOINT_EXPIRED: 'The import checkpoint has expired. Start a fresh import.'
};

function displayDeviceAuthCode(info: DisplayCodeInfo): void {
  // Keep pairing instructions on stderr so --json remains valid on stdout.
  // The user code is intentionally displayed; no credential or bearer value is
  // included in this message.
  console.error(`To finish login, open ${info.verificationUri} and enter code ${info.userCode}. The code expires in ${info.expiresIn} seconds.`);
}

function openVerificationUri(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/open', [url], { shell: false, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

export function resolveDeviceAuthUseCase(deps?: DeviceAuthCommandDeps): DeviceAuthUseCase {
  const onDisplayCode = deps?.onDisplayCode;
  const openBrowser = deps?.openBrowser;

  if (deps?.useCase) {
    // Pre-injected use case is authoritative. Return it unchanged: hooks were
    // bound at construction time, never patched onto private readonly fields.
    return deps.useCase;
  }

  if (deps?.client && deps?.keyStore && deps?.credentialStore && deps?.metadataStore) {
    if (deps.useCaseFactory) {
      // CLI-owned construction seam: the caller receives the resolved stores
      // and hooks and is free to build its own DeviceAuthUseCase.
      return deps.useCaseFactory({
        client: deps.client,
        keyStore: deps.keyStore,
        credentialStore: deps.credentialStore,
        metadataStore: deps.metadataStore,
        onDisplayCode,
        openBrowser
      });
    }
    return new DeviceAuthUseCase({
      client: deps.client,
      keyStore: deps.keyStore,
      credentialStore: deps.credentialStore,
      metadataStore: deps.metadataStore,
      openBrowser,
      onDisplayCode
    });
  }

  if (!deps && process.platform === 'darwin' && process.env.SKILLMAP_ENABLE_MACOS_CUSTODY === '1') {
    const origin = process.env.SKILLMAP_DEVICE_AUTH_ORIGIN;
    if (!origin) {
      throw new CliExitError(CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, SAFE_ERROR_MESSAGES.secure_storage_unavailable, 'secure_storage_unavailable');
    }
    try {
      const stores = createMacOSCustodyStores();
      const metadataStore = stores.metadataStore;
      const client = new DeviceAuthClient({ origin, keyStore: stores.keyStore, metadataStore });
      return new DeviceAuthUseCase({
        client,
        keyStore: stores.keyStore,
        credentialStore: stores.credentialStore,
        metadataStore,
        onDisplayCode: displayDeviceAuthCode,
        openBrowser: openVerificationUri
      });
    } catch (error) {
      if (error instanceof MacOSCustodyError) {
        throw new CliExitError(CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, SAFE_ERROR_MESSAGES.secure_storage_unavailable, 'secure_storage_unavailable');
      }
      throw error;
    }
  }

  // Default production resolution: until production secure store lands, fail clearly
  throw new CliExitError(
    CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
    SAFE_ERROR_MESSAGES.secure_storage_unavailable,
    'secure_storage_unavailable',
    { error: 'secure_storage_unavailable', message: SAFE_ERROR_MESSAGES.secure_storage_unavailable }
  );
}

export function mapDeviceAuthErrorToExitCode(err: unknown): { exitCode: number; code: string; message: string } {
  if (err instanceof CliExitError) {
    const safeMsg = SAFE_ERROR_MESSAGES[err.code] ?? SAFE_ERROR_MESSAGES.usage_error ?? 'CLI command error.';
    return { exitCode: err.exitCode, code: err.code, message: safeMsg };
  }

  if (err instanceof DeviceAuthError) {
    const safeMsg = SAFE_ERROR_MESSAGES[err.code] ?? 'Device authentication error.';
    switch (err.code) {
      case 'secure_storage_unavailable':
      case 'invalid_client':
      case 'proof_required':
      case 'proof_invalid':
      case 'idempotency_conflict':
      case 'invalid_request':
      case 'invalid_scope':
        return { exitCode: CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, code: err.code, message: safeMsg };

      case 'authorization_pending':
      case 'slow_down':
      case 'access_denied':
      case 'expired_token':
      case 'invalid_grant':
      case 'invalid_token':
      case 'already_consumed':
      case 'insufficient_scope':
        return { exitCode: CLI_EXIT_CODES.UNAUTHENTICATED, code: err.code, message: safeMsg };

      case 'temporarily_unavailable':
      case 'rate_limited':
        return { exitCode: CLI_EXIT_CODES.UNREACHABLE, code: err.code, message: safeMsg };

      default:
        return { exitCode: CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, code: err.code, message: safeMsg };
    }
  }

  // The native Keychain helper deliberately exposes only a fixed class name
  // and bounded reason code. Never surface its reason to the CLI user; all
  // helper failures are the same secure-storage availability outcome.
  if (err && typeof err === 'object' && ((err as { name?: unknown }).name === 'MacOSHelperError' || (err as { name?: unknown }).name === 'MacOSCustodyError')) {
    return {
      exitCode: CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
      code: 'secure_storage_unavailable',
      message: SAFE_ERROR_MESSAGES.secure_storage_unavailable
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  if (rawMsg.includes('Operation aborted') || rawMsg.includes('user_cancelled')) {
    return { exitCode: CLI_EXIT_CODES.INTERRUPT, code: 'interrupt', message: SAFE_ERROR_MESSAGES.interrupt };
  }
  if (rawMsg.includes('fetch failed') || rawMsg.includes('ENOTFOUND') || rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ETIMEDOUT')) {
    return { exitCode: CLI_EXIT_CODES.UNREACHABLE, code: 'unreachable', message: SAFE_ERROR_MESSAGES.unreachable };
  }

  return { exitCode: 1, code: 'error', message: 'An unexpected error occurred.' };
}
