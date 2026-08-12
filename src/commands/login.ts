import { flagString, hasFlag } from '../core/args.js';
import {
  CLI_EXIT_CODES,
  CliExitError,
  mapDeviceAuthErrorToExitCode,
  resolveDeviceAuthUseCase,
  type DeviceAuthCommandDeps
} from '../core/cli-exit.js';

export async function loginCommand(
  _cwd: string,
  flags: Record<string, string | boolean | string[]>,
  deps?: DeviceAuthCommandDeps
): Promise<unknown> {
  const noBrowser = hasFlag(flags, 'no-browser');
  const displayName = flagString(flags, 'device-name');

  // The production CLI owns SIGINT cancellation. Injectable callers may pass
  // their own signal, in which case it remains authoritative and no process
  // listener is installed. This keeps tests and embedders in control while
  // ensuring the normal `skillmap login` path reaches the use case's cancel
  // flow instead of terminating the process immediately.
  const controller = deps?.signal === undefined ? new AbortController() : undefined;
  const signal = deps?.signal ?? controller?.signal;
  const onSigint = () => controller?.abort();
  if (controller) process.once('SIGINT', onSigint);

  try {
    // The display callback is delivered through the construction/factory seam:
    // resolveDeviceAuthUseCase binds deps.onDisplayCode onto a freshly built
    // use case (or returns a pre-injected use case unchanged). It fires exactly
    // once inside initiateAndPoll when the pairing initiation succeeds.
    const useCase = resolveDeviceAuthUseCase(deps);
    const scopes = ['device.status'];
    const res = await useCase.initiateAndPoll({
      scopes,
      displayName,
      openBrowser: !noBrowser,
      signal
    });

    return {
      success: true,
      devicePublicId: res.device_public_id,
      accountPublicId: res.account_public_id,
      scopes,
      expiresIn: res.expires_in,
      summary: `Successfully logged in as ${res.account_public_id} (Device: ${res.device_public_id})`
    };
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw new CliExitError(CLI_EXIT_CODES.INTERRUPT, 'Login cancelled by user', 'user_cancelled', {
        success: false,
        error: 'user_cancelled',
        message: 'Login cancelled by user'
      });
    }

    const mapped = mapDeviceAuthErrorToExitCode(err);
    throw new CliExitError(mapped.exitCode, mapped.message, mapped.code, {
      success: false,
      error: mapped.code,
      message: mapped.message
    });
  } finally {
    if (controller) process.removeListener('SIGINT', onSigint);
  }
}
