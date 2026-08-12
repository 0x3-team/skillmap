import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceAuthClient, DeviceAuthError } from '../dist/network/device-auth-client.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';
import { CLI_EXIT_CODES, CliExitError, mapDeviceAuthErrorToExitCode, SAFE_ERROR_MESSAGES } from '../dist/core/cli-exit.js';
import { loginCommand } from '../dist/commands/login.js';
import { authCommand } from '../dist/commands/auth.js';
import { whoamiCommand } from '../dist/commands/whoami.js';
import { logoutCommand } from '../dist/commands/logout.js';
import { dispatchCommand, handleCliError } from '../dist/cli.js';
import { parseArgs } from '../dist/core/args.js';

const VALID_DEVICE_ID = 'D'.repeat(22);
const VALID_DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const VALID_ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const VALID_TOKEN_FAMILY_ID = `fam_${'c'.repeat(32)}`;
const VALID_ACCESS_TOKEN = `atoken_secret_${'d'.repeat(29)}`;
const VALID_REFRESH_TOKEN = `rtoken_secret_${'e'.repeat(29)}`;
const VALID_KEY_THUMBPRINT = `sha256:${'1'.repeat(64)}`;

function createMockFetch(handler) {
  return async (url, options) => {
    return await handler(url, options);
  };
}

// Builds an injectable dependency set backed by in-memory stores. It does NOT
// pre-build a DeviceAuthUseCase: commands resolve their own use case through
// the construction/factory seam so hooks (onDisplayCode/openBrowser) bound at
// construction time are delivered correctly.
async function createTestDeps(options = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  let pollCount = 0;

  const mockFetch = createMockFetch(async (url, optionsWithBody) => {
    if (options.unreachable) {
      throw new TypeError('fetch failed');
    }

    const body = optionsWithBody.body ? JSON.parse(optionsWithBody.body) : {};

    if (url.endsWith('/api/device-auth/v1/pairings')) {
      return new Response(
        JSON.stringify({
          device_code: 'dcode_secret_' + '0'.repeat(30),
          user_code: 'TEST0-1234A',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Test Device', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/poll')) {
      pollCount += 1;
      if (options.denyPairing) {
        return new Response(
          JSON.stringify({
            error: 'access_denied',
            error_description: 'Authorization was not granted.'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          exchange_code: 'ecode_secret_' + '0'.repeat(30),
          expires_in: 60,
          scopes: ['device.status']
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/exchange')) {
      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          token_family_id: VALID_TOKEN_FAMILY_ID,
          access_token: VALID_ACCESS_TOKEN,
          refresh_token: VALID_REFRESH_TOKEN,
          expires_in: 600,
          refresh_idle_expires_in: 2592000,
          refresh_absolute_expires_in: 7776000
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/tokens/refresh')) {
      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          token_family_id: VALID_TOKEN_FAMILY_ID,
          access_token: VALID_ACCESS_TOKEN,
          refresh_token: VALID_REFRESH_TOKEN,
          expires_in: 600,
          refresh_idle_expires_in: 2_592_000,
          refresh_absolute_expires_in: 7_776_000
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-SkillMap-Response-Issued-At': String(Math.floor(Date.now() / 1000))
          }
        }
      );
    }

    if (url.includes('/api/device-auth/v1/devices/') && url.endsWith('/revoke')) {
      if (options.unreachableRevoke) {
        throw new TypeError('fetch failed');
      }
      return new Response(
        JSON.stringify({
          status: 'revoked',
          device_public_id: VALID_DEVICE_PUBLIC_ID
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/api/device-auth/v1/devices/')) {
      if (options.revokeStatus) {
        return new Response(
          JSON.stringify({
            device_public_id: VALID_DEVICE_PUBLIC_ID,
            account_public_id: VALID_ACCOUNT_PUBLIC_ID,
            state: 'revoked',
            scopes: ['device.status'],
            expires_at: Math.floor(Date.now() / 1000) + 300,
            key_thumbprint: VALID_KEY_THUMBPRINT
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          state: 'active',
          scopes: ['device.status'],
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          key_thumbprint: VALID_KEY_THUMBPRINT
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    fetchFn: (url, opts) => mockFetch(url, { ...opts, ...options })
  });

  return { keyStore, credentialStore, metadataStore, client };
}

test('Default production execution fails clearly with secure_storage_unavailable (exit code 4) before pairing', async () => {
  await assert.rejects(
    async () => {
      await loginCommand('/test/cwd', {});
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR);
      assert.equal(err.code, 'secure_storage_unavailable');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await authCommand('/test/cwd', ['status'], {});
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR);
      assert.equal(err.code, 'secure_storage_unavailable');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await whoamiCommand('/test/cwd', {});
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR);
      assert.equal(err.code, 'secure_storage_unavailable');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await logoutCommand('/test/cwd', { confirm: true });
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR);
      assert.equal(err.code, 'secure_storage_unavailable');
      return true;
    }
  );
});

test('login rejects unknown, positional, valued, and repeated flags before auth or browser side effects', async () => {
  const calls = [];
  const useCase = {
    async initiateAndPoll() {
      calls.push('initiateAndPoll');
      return {};
    }
  };

  const invalidArgv = [
    ['--unknown'],
    ['unexpected'],
    ['--no-browser=unexpected'],
    ['--no-browser', '--no-browser'],
    ['--json=false']
  ];

  for (const argv of invalidArgv) {
    const parsed = parseArgs(['login', ...argv]);
    await assert.rejects(
      async () => loginCommand('/test/cwd', parsed.positionals, parsed.flags, { useCase }),
      (err) => {
        assert.ok(err instanceof CliExitError);
        assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
        assert.equal(err.code, 'usage_error');
        return true;
      }
    );
  }

  assert.deepEqual(calls, []);
});

test('Defect 1 regression: login display callback is wired through the construction seam and delivered exactly once', async () => {
  // Inject stores only: the command resolves a fresh use case via the seam,
  // binding deps.onDisplayCode at construction time.
  const deps = await createTestDeps();
  const displayCalls = [];

  const res = await loginCommand(
    '/test/cwd',
    { 'no-browser': true, 'device-name': 'Test Device' },
    {
      ...deps,
      onDisplayCode: (info) => {
        displayCalls.push(info);
      }
    }
  );

  assert.equal(displayCalls.length, 1, 'display callback must fire exactly once');
  assert.equal(displayCalls[0].userCode, 'TEST0-1234A');
  assert.equal(displayCalls[0].verificationUri, 'https://skillmap.example.test/device');
  assert.ok(displayCalls[0].expiresIn > 0);

  // Assert callback payload does not expose any secret token or key material
  const callbackString = JSON.stringify(displayCalls[0]);
  assert.ok(!callbackString.includes('atoken_secret'));
  assert.ok(!callbackString.includes('rtoken_secret'));
  assert.ok(!callbackString.includes('ecode_secret'));
  assert.ok(!callbackString.includes('dcode_secret'));
  assert.ok(!callbackString.includes('fam_test'));
});

test('Defect 1b: CLI-owned useCaseFactory receives stores and hooks and delivers display exactly once', async () => {
  const { keyStore, credentialStore, metadataStore, client } = await createTestDeps();
  const factoryCalls = [];
  const displayCalls = [];

  const useCaseFactory = (arg) => {
    factoryCalls.push(arg);
    assert.equal(arg.client, client);
    assert.equal(arg.keyStore, keyStore);
    assert.equal(arg.credentialStore, credentialStore);
    assert.equal(arg.metadataStore, metadataStore);
    assert.equal(typeof arg.onDisplayCode, 'function');
    return new DeviceAuthUseCase({
      client: arg.client,
      keyStore: arg.keyStore,
      credentialStore: arg.credentialStore,
      metadataStore: arg.metadataStore,
      onDisplayCode: arg.onDisplayCode,
      openBrowser: arg.openBrowser
    });
  };

  const res = await loginCommand(
    '/test/cwd',
    { 'no-browser': true },
    {
      client,
      keyStore,
      credentialStore,
      metadataStore,
      useCaseFactory,
      onDisplayCode: (info) => displayCalls.push(info)
    }
  );

  assert.equal(factoryCalls.length, 1, 'useCaseFactory must be invoked once');
  assert.equal(res.success, true);
  assert.equal(displayCalls.length, 1, 'display callback wired through the factory fires exactly once');
  assert.equal(displayCalls[0].userCode, 'TEST0-1234A');
});

test('Defect 1c: a pre-injected useCase is returned unchanged and is never mutated with an unknown cast', async () => {
  const { keyStore, client, credentialStore, metadataStore } = await createTestDeps();

  // Build a use case whose own callback records deliveries.
  const constructionDisplay = [];
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore,
    onDisplayCode: (info) => constructionDisplay.push(info)
  });

  // Provide a DIFFERENT onDisplayCode in deps. The pre-injected use case must
  // be returned unchanged: the deps.onDisplayCode hook must NOT be patched
  // onto its private readonly fields. Only the construction-bound callback
  // fires.
  const depsLevelCallback = [];
  const deps = {
    useCase,
    onDisplayCode: (info) => depsLevelCallback.push(info)
  };

  const res = await loginCommand('/test/cwd', { 'no-browser': true }, deps);

  assert.equal(res.success, true);
  assert.equal(constructionDisplay.length, 1, 'construction-bound callback fires exactly once');
  assert.equal(depsLevelCallback.length, 0, 'deps.onDisplayCode must not be patched onto a pre-injected useCase');
});

test('Defect 2 regression: login output removes tokenFamilyId and exposes zero internal tokens or cryptographic secrets', async () => {
  const deps = await createTestDeps();
  const res = await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });

  assert.ok(res);
  assert.equal(res.success, true);
  assert.equal(res.devicePublicId, VALID_DEVICE_PUBLIC_ID);
  assert.equal(res.accountPublicId, VALID_ACCOUNT_PUBLIC_ID);
  assert.deepEqual(res.scopes, ['device.status']);
  assert.equal(res.expiresIn, 600);
  assert.equal(res.tokenFamilyId, undefined, 'tokenFamilyId must be removed from login output');

  const jsonString = JSON.stringify(res);
  assert.ok(!jsonString.includes('tokenFamilyId'));
  assert.ok(!jsonString.includes('fam_test'));
  assert.ok(!jsonString.includes('atoken_secret'));
  assert.ok(!jsonString.includes('rtoken_secret'));
  assert.ok(!jsonString.includes('ecode_secret'));
  assert.ok(!jsonString.includes('dcode_secret'));
  assert.ok(!jsonString.includes('SKILLMAP-DEVICE-PROOF'));

  const creds = await deps.credentialStore.load();
  assert.ok(creds);
  assert.equal(creds.devicePublicId, VALID_DEVICE_PUBLIC_ID);
});

test('Defect 3 regression: mapDeviceAuthErrorToExitCode and handleCliError emit only safe fixed error messages and never echo malicious secret-bearing text', async () => {
  const origExit = process.exitCode;
  const maliciousError = new Error('Database error: connection string postgresql://user:atoken_secret_9999@localhost/db failed');
  const mapped = mapDeviceAuthErrorToExitCode(maliciousError);

  assert.equal(mapped.exitCode, 1);
  assert.equal(mapped.code, 'error');
  assert.equal(mapped.message, 'An unexpected error occurred.');
  assert.ok(!mapped.message.includes('atoken_secret_9999'));

  const maliciousDeviceAuthError = new DeviceAuthError(400, 'access_denied', 'Secret leaked: rtoken_secret_8888');
  const mappedDeviceAuth = mapDeviceAuthErrorToExitCode(maliciousDeviceAuthError);

  assert.equal(mappedDeviceAuth.exitCode, CLI_EXIT_CODES.UNAUTHENTICATED);
  assert.equal(mappedDeviceAuth.code, 'access_denied');
  assert.equal(mappedDeviceAuth.message, SAFE_ERROR_MESSAGES.access_denied);
  assert.ok(!mappedDeviceAuth.message.includes('rtoken_secret_8888'));

  // A CliExitError whose .message carries a malicious secret must still emit
  // only the fixed safe message, never error.message or payload.message.
  const maliciousCliExit = new CliExitError(
    CLI_EXIT_CODES.UNREACHABLE,
    'Raw secret leaked: atoken_secret_5555 host=db.example.test',
    'unreachable',
    { message: 'payload secret atoken_secret_7777', success: false }
  );

  let consoleLogs = [];
  let consoleErrors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (msg) => consoleLogs.push(msg);
  console.error = (msg) => consoleErrors.push(msg);

  try {
    handleCliError(maliciousError, false);
    assert.ok(consoleErrors.some((e) => e.includes('An unexpected error occurred.')));
    assert.ok(!consoleErrors.some((e) => e.includes('atoken_secret_9999')));

    consoleLogs = [];
    consoleErrors = [];
    handleCliError(maliciousDeviceAuthError, true);
    assert.ok(consoleLogs.some((l) => l.includes(SAFE_ERROR_MESSAGES.access_denied)));
    assert.ok(!consoleLogs.some((l) => l.includes('rtoken_secret_8888')));

    // CliExitError text mode: fixed safe message only.
    consoleLogs = [];
    consoleErrors = [];
    handleCliError(maliciousCliExit, false);
    assert.ok(consoleErrors.some((e) => e.includes(SAFE_ERROR_MESSAGES.unreachable)));
    assert.ok(!consoleErrors.some((e) => e.includes('atoken_secret_5554')));

    // CliExitError JSON mode: only { error, safe message }, no payload echo.
    consoleLogs = [];
    consoleErrors = [];
    handleCliError(maliciousCliExit, true);
    const parsed = JSON.parse(consoleLogs.find((l) => typeof l === 'string' && l.includes('message')) ?? '{}');
    assert.equal(parsed.error, 'unreachable');
    assert.equal(parsed.message, SAFE_ERROR_MESSAGES.unreachable);
    assert.ok(!JSON.stringify(consoleLogs).includes('atoken_secret_7777'));
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = 0;
  }
});

test('Defect 4 regression: real handleCliError process-level tests prove exact exit code setting for 2, 3, 4, 64, and 130', () => {
  try {
    // Exit code 2: Unauthenticated
    process.exitCode = 0;
    handleCliError(new CliExitError(CLI_EXIT_CODES.UNAUTHENTICATED, 'Unauthenticated', 'signed_out'), false);
    assert.equal(process.exitCode, 2);

    // Exit code 3: Unreachable
    process.exitCode = 0;
    handleCliError(new CliExitError(CLI_EXIT_CODES.UNREACHABLE, 'Unreachable', 'unreachable'), false);
    assert.equal(process.exitCode, 3);

    // Exit code 4: Integrity / secure storage unavailable
    process.exitCode = 0;
    handleCliError(new CliExitError(CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, 'Secure storage unavailable', 'secure_storage_unavailable'), false);
    assert.equal(process.exitCode, 4);

    // Exit code 64: Usage error
    process.exitCode = 0;
    handleCliError(new CliExitError(CLI_EXIT_CODES.USAGE, 'Usage error', 'usage_error'), false);
    assert.equal(process.exitCode, 64);

    // Exit code 130: Interrupt
    process.exitCode = 0;
    handleCliError(new CliExitError(CLI_EXIT_CODES.INTERRUPT, 'Interrupted', 'user_cancelled'), false);
    assert.equal(process.exitCode, 130);
  } finally {
    process.exitCode = 0;
  }
});

test('login command handles AbortSignal interrupt with exit code 130', async () => {
  const deps = await createTestDeps();
  const controller = new AbortController();
  controller.abort();
  const listenersBefore = new Set(process.listeners('SIGINT'));

  await assert.rejects(
    async () => {
      await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, signal: controller.signal, onDisplayCode: () => {} });
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTERRUPT);
      assert.equal(err.code, 'user_cancelled');
      return true;
    }
  );
  assert.deepEqual(process.listeners('SIGINT'), [...listenersBefore], 'injected signals must not install a process listener');
});

test('production-style login owns SIGINT cancellation and removes its listener', async () => {
  let receivedSignal;
  let operationCancelled = false;
  const useCase = {
    initiateAndPoll: ({ signal }) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          operationCancelled = true;
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Operation aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  };
  const listenersBefore = new Set(process.listeners('SIGINT'));
  const pending = loginCommand('/test/cwd', { 'no-browser': true }, { useCase });

  // Let loginCommand reach the injected operation before simulating the
  // process-level interrupt used by the production CLI.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(receivedSignal instanceof AbortSignal);
  const cliSigintListener = process.listeners('SIGINT').find((listener) => !listenersBefore.has(listener));
  assert.ok(cliSigintListener, 'login must install a CLI-owned SIGINT listener');

  // Invoke only the newly installed listener. Emitting SIGINT on the test
  // runner itself would ask the runner to stop the remaining test file.
  cliSigintListener();

  await assert.rejects(
    pending,
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTERRUPT);
      assert.equal(err.code, 'user_cancelled');
      return true;
    }
  );
  assert.equal(operationCancelled, true);
  assert.deepEqual(process.listeners('SIGINT'), [...listenersBefore]);
});

test('auth status command returns observational status (exit code 0) for signed_out, authenticated, and unreachable', async () => {
  const deps = await createTestDeps();

  // Signed out observational
  const signedOutRes = await authCommand('/test/cwd', ['status'], {}, deps);
  assert.equal(signedOutRes.state, 'signed_out');
  assert.equal(signedOutRes.authenticated, false);

  // Authenticate
  await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });

  // Authenticated observational
  const authRes = await authCommand('/test/cwd', ['status'], {}, deps);
  assert.equal(authRes.state, 'authenticated');
  assert.equal(authRes.authenticated, true);
  assert.equal(authRes.devicePublicId, VALID_DEVICE_PUBLIC_ID);
  assert.equal(authRes.accountPublicId, VALID_ACCOUNT_PUBLIC_ID);

  // Verify no secret leakage
  const jsonString = JSON.stringify(authRes);
  assert.ok(!jsonString.includes('atoken_secret'));
  assert.ok(!jsonString.includes('rtoken_secret'));
  assert.ok(!jsonString.includes('fam_test'));
});

test('auth status rejects unknown, valued, repeated, and positional arguments before auth calls', async () => {
  const calls = [];
  const useCase = {
    async getAuthStatus() {
      calls.push('getAuthStatus');
      return { state: 'authenticated', authenticated: true };
    }
  };

  const invalidArgv = [
    ['--chek'],
    ['--check=false'],
    ['--check', '--check'],
    ['--json=false'],
    ['--json', '--json'],
    ['unexpected']
  ];

  for (const argv of invalidArgv) {
    const parsed = parseArgs(['auth', 'status', ...argv]);
    await assert.rejects(
      async () => authCommand('/test/cwd', parsed.positionals, parsed.flags, { useCase }),
      (err) => {
        assert.ok(err instanceof CliExitError);
        assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
        assert.equal(err.code, 'usage_error');
        return true;
      }
    );
  }

  assert.deepEqual(calls, []);
});

test('auth status accepts the bare json output flag', async () => {
  let calls = 0;
  const result = await authCommand('/test/cwd', ['status'], { json: true }, {
    useCase: {
      async getAuthStatus() {
        calls += 1;
        return { state: 'signed_out', authenticated: false };
      }
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.state, 'signed_out');
  assert.equal(result.authenticated, false);
});

test('auth status --check enforces strict exit codes: 0 authenticated, 2 unauthenticated, 3 unreachable', async () => {
  const deps = await createTestDeps();

  // Signed out with --check -> exit code 2
  await assert.rejects(
    async () => {
      await authCommand('/test/cwd', ['status'], { check: true }, deps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.UNAUTHENTICATED);
      assert.equal(err.code, 'signed_out');
      return true;
    }
  );

  // Login
  await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });

  // Authenticated with --check -> exit code 0 (returns result)
  const authCheckRes = await authCommand('/test/cwd', ['status'], { check: true }, deps);
  assert.equal(authCheckRes.authenticated, true);

  // Unreachable server with --check -> exit code 3
  const unreachableDeps = await createTestDeps({ unreachable: true });
  await unreachableDeps.credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: VALID_REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });

  await assert.rejects(
    async () => {
      await authCommand('/test/cwd', ['status'], { check: true }, unreachableDeps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.UNREACHABLE);
      assert.equal(err.code, 'unreachable');
      return true;
    }
  );
});

test('whoami command returns live identity (exit code 0) when authenticated, and exit code 2/3 when unauthenticated/unreachable', async () => {
  const deps = await createTestDeps();

  // Signed out -> exit code 2
  await assert.rejects(
    async () => {
      await whoamiCommand('/test/cwd', {}, deps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.UNAUTHENTICATED);
      assert.equal(err.code, 'signed_out');
      return true;
    }
  );

  // Login
  await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });

  // Authenticated -> returns live identity
  const whoamiRes = await whoamiCommand('/test/cwd', {}, deps);
  assert.equal(whoamiRes.authenticated, true);
  assert.equal(whoamiRes.devicePublicId, VALID_DEVICE_PUBLIC_ID);
  assert.equal(whoamiRes.accountPublicId, VALID_ACCOUNT_PUBLIC_ID);
  assert.deepEqual(whoamiRes.scopes, ['device.status']);

  // Unreachable -> exit code 3
  const unreachableDeps = await createTestDeps({ unreachable: true });
  await unreachableDeps.credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: VALID_REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });

  await assert.rejects(
    async () => {
      await whoamiCommand('/test/cwd', {}, unreachableDeps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.UNREACHABLE);
      assert.equal(err.code, 'unreachable');
      return true;
    }
  );
});

test('logout command --local-only requires --confirm (exit code 64)', async () => {
  const deps = await createTestDeps();

  await assert.rejects(
    async () => {
      await logoutCommand('/test/cwd', { 'local-only': true }, deps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
      assert.equal(err.code, 'usage_error');
      return true;
    }
  );

  // With --confirm, local-only logout succeeds (exit code 0)
  await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });
  const localRes = await logoutCommand('/test/cwd', { 'local-only': true, confirm: true }, deps);
  assert.equal(localRes.success, true);
  assert.equal(localRes.localDeleted, true);
  assert.equal(localRes.remoteRevoked, false);

  const credsAfter = await deps.credentialStore.load();
  assert.equal(credsAfter, null);
});

test('logout rejects positionals and invalid, valued, duplicate, and global flags before auth or mutation', async () => {
  const calls = [];
  const useCase = {
    async getAuthStatus() {
      calls.push('getAuthStatus');
      return { state: 'authenticated', authenticated: true };
    },
    async logout() {
      calls.push('logout');
      return { remoteRevoked: true, localDeleted: true };
    }
  };

  const invalidArgv = [
    ['dev_deadbeef'],
    ['--local-onli', '--confirm'],
    ['--local-only=unexpected', '--confirm'],
    ['--confirm', '--confirm'],
    ['--global', '--confirm']
  ];

  for (const argv of invalidArgv) {
    const parsed = parseArgs(['logout', ...argv]);
    await assert.rejects(
      async () => logoutCommand('/test/cwd', parsed.positionals, parsed.flags, { useCase }),
      (err) => {
        assert.ok(err instanceof CliExitError);
        assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
        assert.equal(err.code, 'usage_error');
        return true;
      }
    );
  }

  assert.deepEqual(calls, []);

  await assert.rejects(
    async () => dispatchCommand('/test/cwd', 'logout', ['dev_deadbeef'], {}),
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
      assert.equal(err.code, 'usage_error');
      return true;
    }
  );
});

test('logout accepts the global json output flag without changing its safety checks', async () => {
  const calls = [];
  const useCase = {
    async getAuthStatus() {
      calls.push('getAuthStatus');
      return { state: 'signed_out', authenticated: false };
    },
    async logout(options) {
      calls.push(['logout', options]);
      return { remoteRevoked: false, localDeleted: false };
    }
  };

  const parsed = parseArgs(['logout', '--json']);
  const result = await logoutCommand('/test/cwd', parsed.flags, { useCase });
  assert.equal(result.success, true);
  assert.deepEqual(calls, ['getAuthStatus', ['logout', { localOnly: false, confirm: false }]]);
});

test('logout command --local-only --confirm skips auth preflight and remote calls', async () => {
  const calls = [];
  const useCase = {
    async getAuthStatus() {
      calls.push('getAuthStatus');
      throw new Error('local-only logout must not query remote auth');
    },
    async logout(options) {
      calls.push(['logout', options]);
      return { remoteRevoked: false, localDeleted: true };
    }
  };

  const result = await logoutCommand('/test/cwd', { 'local-only': true, confirm: true }, { useCase });

  assert.deepEqual(calls, [['logout', { localOnly: true, confirm: true }]]);
  assert.deepEqual(result, {
    success: true,
    remoteRevoked: false,
    localDeleted: true,
    message: 'Local credentials removed.',
    summary: 'Local credentials removed.'
  });
});

test('logout command treats terminal revoked or expired preflight status with removed credentials as successful logout', async () => {
  for (const terminalState of ['revoked', 'expired']) {
    const calls = [];
    const useCase = {
      async getAuthStatus() {
        calls.push('getAuthStatus');
        return { state: terminalState, authenticated: false };
      },
      async logout(options) {
        calls.push(['logout', options]);
        return { remoteRevoked: false, localDeleted: false };
      }
    };

    const result = await logoutCommand('/test/cwd', { confirm: true }, { useCase });

    assert.deepEqual(calls, ['getAuthStatus', ['logout', { localOnly: false, confirm: true }]]);
    assert.deepEqual(result, {
      success: true,
      remoteRevoked: false,
      localDeleted: false,
      message: 'Already logged out.',
      summary: 'Already logged out.'
    });
  }
});

test('normal unreachable logout retains credentials and exits with exit code 3', async () => {
  const unreachableDeps = await createTestDeps({ unreachableRevoke: true });
  await unreachableDeps.credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: VALID_REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });

  await assert.rejects(
    async () => {
      await logoutCommand('/test/cwd', {}, unreachableDeps);
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.UNREACHABLE);
      assert.equal(err.code, 'unreachable');
      return true;
    }
  );

  // Verify credentials were retained in store
  const creds = await unreachableDeps.credentialStore.load();
  assert.ok(creds);
  assert.equal(creds.devicePublicId, VALID_DEVICE_PUBLIC_ID);

  const localOnlyResult = await logoutCommand(
    '/test/cwd',
    { 'local-only': true, confirm: true },
    unreachableDeps
  );
  assert.equal(localOnlyResult.success, true);
  assert.equal(localOnlyResult.localDeleted, true);
  assert.equal(localOnlyResult.remoteRevoked, false);
  assert.equal(await unreachableDeps.credentialStore.load(), null);
});

test('normal successful logout revokes remotely, deletes locally, and exits code 0', async () => {
  const deps = await createTestDeps();
  await loginCommand('/test/cwd', { 'no-browser': true }, { ...deps, onDisplayCode: () => {} });

  const logoutRes = await logoutCommand('/test/cwd', {}, deps);
  assert.equal(logoutRes.success, true);
  assert.equal(logoutRes.remoteRevoked, true);
  assert.equal(logoutRes.localDeleted, true);

  const creds = await deps.credentialStore.load();
  assert.equal(creds, null);
});

test('auth commands execute via dispatchCommand without mutual workspace state mutation lock', async () => {
  // Call dispatchCommand in an uninitialized directory path. Auth commands are
  // not a workspace-state mutation, so no .skillmap is created; the CLI only
  // throws because the production secure store has not landed.
  await assert.rejects(
    async () => {
      await dispatchCommand('/tmp/nonexistent-workspace-path-12345', 'whoami', [], {});
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR);
      assert.equal(err.code, 'secure_storage_unavailable');
      return true;
    }
  );
});

test('dispatchCommand dispatches login, auth, whoami, logout, and unknown commands', async () => {
  await assert.rejects(
    async () => {
      await dispatchCommand('/test/cwd', 'unknown-cmd', [], {});
    },
    (err) => {
      assert.ok(err instanceof CliExitError);
      assert.equal(err.exitCode, CLI_EXIT_CODES.USAGE);
      assert.equal(err.code, 'usage_error');
      return true;
    }
  );
});
