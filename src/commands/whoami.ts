import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

export async function whoamiCommand(
  _cwd: string,
  flags: Record<string, string | boolean | string[]>,
  deps?: DeviceAuthCommandDeps
): Promise<unknown> {
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
