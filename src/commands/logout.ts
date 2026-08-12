import { hasFlag } from '../core/args.js';
import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

export async function logoutCommand(
  _cwd: string,
  flags: Record<string, string | boolean | string[]>,
  deps?: DeviceAuthCommandDeps
): Promise<unknown> {
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
