import { hasFlag } from '../core/args.js';
import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

const LOGOUT_FLAGS = new Set(['confirm', 'local-only', 'json']);
type LogoutFlags = Record<string, string | boolean | string[]>;

function validateLogoutInput(positionals: string[], flags: LogoutFlags): void {
  if (positionals.length > 0) {
    throwLogoutUsageError();
  }

  for (const [name, value] of Object.entries(flags)) {
    // The parser represents bare boolean flags as true. Reject inline values
    // and repeated flags instead of silently choosing one interpretation for a
    // safety-sensitive command. `json` is an output-only global convention and
    // is accepted here even though the command does not otherwise consume it.
    if (!LOGOUT_FLAGS.has(name) || value !== true) {
      throwLogoutUsageError();
    }
  }
}

function throwLogoutUsageError(): never {
  throw new CliExitError(
    CLI_EXIT_CODES.USAGE,
    'Usage: skillmap logout [--confirm] [--local-only] [--json]',
    'usage_error',
    {
      success: false,
      error: 'usage_error',
      message: 'Usage: skillmap logout [--confirm] [--local-only] [--json]'
    }
  );
}

export function logoutCommand(
  cwd: string,
  flags: LogoutFlags,
  deps?: DeviceAuthCommandDeps
): Promise<unknown>;
export function logoutCommand(
  cwd: string,
  positionals: string[],
  flags: LogoutFlags,
  deps?: DeviceAuthCommandDeps
): Promise<unknown>;
export async function logoutCommand(
  _cwd: string,
  positionalsOrFlags: string[] | LogoutFlags,
  flagsOrDeps?: LogoutFlags | DeviceAuthCommandDeps,
  injectedDeps?: DeviceAuthCommandDeps
): Promise<unknown> {
  const hasPositionalsArgument = Array.isArray(positionalsOrFlags);
  const positionals = hasPositionalsArgument ? positionalsOrFlags : [];
  const flags = hasPositionalsArgument
    ? (flagsOrDeps as LogoutFlags | undefined) ?? {}
    : positionalsOrFlags;
  const deps = hasPositionalsArgument
    ? injectedDeps
    : flagsOrDeps as DeviceAuthCommandDeps | undefined;

  validateLogoutInput(positionals, flags);

  const localOnly = hasFlag(flags, 'local-only');
  const confirm = hasFlag(flags, 'confirm');

  if (localOnly && !confirm) {
    throw new CliExitError(
      CLI_EXIT_CODES.USAGE,
      '--local-only requires --confirm',
      'usage_error',
      {
        success: false,
        error: 'usage_error',
        message: '--local-only requires --confirm'
      }
    );
  }

  const useCase = resolveDeviceAuthUseCase(deps);

  try {
    // A confirmed local-only logout must stay local. In particular, do not
    // make a status/refresh request before the use case removes credentials.
    const statusBefore = localOnly
      ? { state: 'signed_out' as const }
      : await useCase.getAuthStatus();
    const hadCredentialsBefore = statusBefore.state !== 'signed_out';
    const terminalPreflight = statusBefore.state === 'revoked' || statusBefore.state === 'expired';

    const res = await useCase.logout({ localOnly, confirm });

    if (!res.remoteRevoked && !res.localDeleted) {
      if (terminalPreflight && !res.unconfirmed) {
        return {
          success: true,
          remoteRevoked: false,
          localDeleted: false,
          message: 'Already logged out.',
          summary: 'Already logged out.'
        };
      }

      if (hadCredentialsBefore && !localOnly) {
        throw new CliExitError(
          CLI_EXIT_CODES.UNREACHABLE,
          'Remote service unreachable. Credentials retained for retry. Use --local-only --confirm to delete locally or revoke on dashboard.',
          'unreachable',
          {
            success: false,
            remoteRevoked: false,
            localDeleted: false,
            error: 'unreachable',
            message: 'Remote service unreachable. Credentials retained for retry. Use --local-only --confirm to delete locally or revoke on dashboard.'
          }
        );
      }

      return {
        success: true,
        remoteRevoked: false,
        localDeleted: false,
        message: 'Already logged out.',
        summary: 'Already logged out.'
      };
    }

    const message = localOnly ? 'Local credentials removed.' : 'Successfully logged out.';
    return {
      success: true,
      remoteRevoked: res.remoteRevoked,
      localDeleted: res.localDeleted,
      message,
      summary: message
    };
  } catch (err: unknown) {
    if (err instanceof CliExitError) {
      throw err;
    }
    const mapped = mapDeviceAuthErrorToExitCode(err);
    throw new CliExitError(mapped.exitCode, mapped.message, mapped.code, {
      success: false,
      error: mapped.code,
      message: mapped.message
    });
  }
}
