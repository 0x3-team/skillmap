import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

type WhoamiFlags = Record<string, string | boolean | string[]>;

function validateWhoamiInput(positionals: string[], flags: WhoamiFlags): void {
  if (positionals.length > 0) {
    throwWhoamiUsageError();
  }

  for (const [name, value] of Object.entries(flags)) {
    if (name !== 'json' || value !== true) {
      throwWhoamiUsageError();
    }
  }
}

function throwWhoamiUsageError(): never {
  const usage = 'Usage: skillmap whoami [--json]';
  throw new CliExitError(CLI_EXIT_CODES.USAGE, usage, 'usage_error', {
    authenticated: false,
    error: 'usage_error',
    message: usage
  });
}

export function whoamiCommand(
  cwd: string,
  flags: WhoamiFlags,
  deps?: DeviceAuthCommandDeps
): Promise<unknown>;
export function whoamiCommand(
  cwd: string,
  positionals: string[],
  flags: WhoamiFlags,
  deps?: DeviceAuthCommandDeps
): Promise<unknown>;
export async function whoamiCommand(
  _cwd: string,
  positionalsOrFlags: string[] | WhoamiFlags,
  flagsOrDeps?: WhoamiFlags | DeviceAuthCommandDeps,
  injectedDeps?: DeviceAuthCommandDeps
): Promise<unknown> {
  const hasPositionalsArgument = Array.isArray(positionalsOrFlags);
  const positionals = hasPositionalsArgument ? positionalsOrFlags : [];
  const flags = hasPositionalsArgument
    ? (flagsOrDeps as WhoamiFlags | undefined) ?? {}
    : positionalsOrFlags;
  const deps = hasPositionalsArgument
    ? injectedDeps
    : flagsOrDeps as DeviceAuthCommandDeps | undefined;

  validateWhoamiInput(positionals, flags);
  const useCase = resolveDeviceAuthUseCase(deps);

  try {
    const status = await useCase.getAuthStatus();

    if (status.state === 'authenticated' && status.authenticated) {
      const summaryLines = [
        `Device ID: ${status.devicePublicId ?? 'unknown'}`,
        `Account ID: ${status.accountPublicId ?? 'unknown'}`
      ];
      if (status.scopes?.length) summaryLines.push(`Scopes: ${status.scopes.join(', ')}`);

      return {
        authenticated: true,
        devicePublicId: status.devicePublicId,
        accountPublicId: status.accountPublicId,
        scopes: status.scopes,
        ...(status.expiresAt ? { expiresAt: status.expiresAt } : {}),
        summary: summaryLines.join('\n')
      };
    }

    if (status.state === 'signed_out' || status.state === 'expired' || status.state === 'revoked') {
      throw new CliExitError(
        CLI_EXIT_CODES.UNAUTHENTICATED,
        `Unauthenticated: ${status.state}`,
        status.state,
        { authenticated: false, state: status.state }
      );
    }

    if (status.state === 'unreachable') {
      throw new CliExitError(
        CLI_EXIT_CODES.UNREACHABLE,
        'Auth status unreachable',
        'unreachable',
        { authenticated: false, state: 'unreachable' }
      );
    }

    throw new CliExitError(
      CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
      `whoami check failed: ${status.state}`,
      status.state,
      { authenticated: false, state: status.state }
    );
  } catch (err: unknown) {
    if (err instanceof CliExitError) {
      throw err;
    }
    const mapped = mapDeviceAuthErrorToExitCode(err);
    throw new CliExitError(mapped.exitCode, mapped.message, mapped.code, {
      authenticated: false,
      error: mapped.code,
      message: mapped.message
    });
  }
}
