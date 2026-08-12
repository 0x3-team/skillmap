import { hasFlag } from '../core/args.js';
import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

export async function authCommand(
  _cwd: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
  deps?: DeviceAuthCommandDeps
): Promise<unknown> {
  const subCommand = positionals[0];
  if (subCommand !== 'status' || positionals.length > 1) {
    throw new CliExitError(
      CLI_EXIT_CODES.USAGE,
      'Usage: skillmap auth status [--check] [--json]',
      'usage_error'
    );
  }

  const useCase = resolveDeviceAuthUseCase(deps);
  const isCheck = hasFlag(flags, 'check');

  try {
    const status = await useCase.getAuthStatus();

    const summaryLines = [
      `Auth status: ${status.state}`,
      `Authenticated: ${status.authenticated ? 'yes' : 'no'}`
    ];
    if (status.devicePublicId) summaryLines.push(`Device ID: ${status.devicePublicId}`);
    if (status.accountPublicId) summaryLines.push(`Account ID: ${status.accountPublicId}`);
    if (status.scopes?.length) summaryLines.push(`Scopes: ${status.scopes.join(', ')}`);
    if (status.expiresAt) summaryLines.push(`Expires at: ${new Date(status.expiresAt * 1000).toISOString()}`);

    const result = {
      state: status.state,
      authenticated: status.authenticated,
      ...(status.devicePublicId ? { devicePublicId: status.devicePublicId } : {}),
      ...(status.accountPublicId ? { accountPublicId: status.accountPublicId } : {}),
      ...(status.scopes ? { scopes: status.scopes } : {}),
      ...(status.expiresAt ? { expiresAt: status.expiresAt } : {}),
      summary: summaryLines.join('\n')
    };

    if (isCheck) {
      if (status.state === 'authenticated' && status.authenticated) {
        return result;
      }
      if (status.state === 'signed_out' || status.state === 'expired' || status.state === 'revoked') {
        throw new CliExitError(
          CLI_EXIT_CODES.UNAUTHENTICATED,
          `Unauthenticated (${status.state})`,
          status.state,
          result
        );
      }
      if (status.state === 'unreachable') {
        throw new CliExitError(
          CLI_EXIT_CODES.UNREACHABLE,
          'Auth status unreachable',
          'unreachable',
          result
        );
      }
      throw new CliExitError(
        CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
        `Auth status check failed: ${status.state}`,
        status.state,
        result
      );
    }

    return result;
  } catch (err: unknown) {
    if (err instanceof CliExitError) {
      throw err;
    }
    const mapped = mapDeviceAuthErrorToExitCode(err);
    throw new CliExitError(mapped.exitCode, mapped.message, mapped.code, {
      state: 'error',
      authenticated: false,
      error: mapped.code,
      message: mapped.message
    });
  }
}
