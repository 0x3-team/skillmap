import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import {
  assertHelperRequest,
  assertHelperResponse,
  decodeHelperFrame,
  encodeHelperFrame,
  MACOS_HELPER_MAX_FRAME_BYTES,
  type MacOSHelperOperation,
  type MacOSHelperRequest,
  type MacOSHelperResponse
} from './macos-keychain-protocol.js';

const SAFE_HELPER_CODES = new Set([
  'unsupported_platform', 'helper_unavailable', 'helper_timeout', 'helper_output_too_large', 'helper_spawn_failed',
  'helper_failed', 'helper_malformed_reply', 'credential_corrupt', 'credential_query_failed', 'credential_write_failed',
  'credential_lock_timeout', 'credential_delete_failed', 'credential_generation_conflict', 'credential_pending_conflict',
  'credential_commit_conflict', 'credential_family_expiry_conflict', 'record_invalid', 'pending_invalid', 'not_found',
  'key_query_failed', 'key_public_failed', 'key_create_failed', 'key_delete_failed', 'sign_failed', 'request_payload',
  'metadata_corrupt', 'metadata_query_failed', 'metadata_write_failed', 'metadata_delete_failed', 'interaction_not_allowed', 'protocol_error'
]);

export interface MacOSHelperTransport {
  request(request: MacOSHelperRequest): Promise<MacOSHelperResponse>;
}

export class MacOSHelperError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super('Secure credential storage is unavailable.');
    this.name = 'MacOSHelperError';
    // Error codes are diagnostics, never an echo channel for a malformed or
    // secret-bearing native error. Keep the public set closed and bounded.
    this.code = SAFE_HELPER_CODES.has(code) ? code : 'protocol_error';
  }
}

/** Spawn one bounded helper process per operation; no secret is put in argv or env. */
export class SpawnedMacOSHelperTransport implements MacOSHelperTransport {
  public constructor(
    private readonly helperPath: string,
    private readonly timeoutMs = 10_000
  ) {}

  public async request(request: MacOSHelperRequest): Promise<MacOSHelperResponse> {
    assertHelperRequest(request);
    if (process.platform !== 'darwin') throw new MacOSHelperError('unsupported_platform');
    try {
      await access(this.helperPath, fsConstants.X_OK);
    } catch {
      throw new MacOSHelperError('helper_unavailable');
    }

    return new Promise((resolve, reject) => {
      // Do not inherit an application's full environment: credentials or
      // provider tokens must never cross into the helper's environment.
      const child = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
      const input = encodeHelperFrame(request);
      let output = Buffer.alloc(0);
      let settled = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new MacOSHelperError('helper_timeout'));
      }, this.timeoutMs);
      const finish = (error?: Error, response?: MacOSHelperResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(response!);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        output = Buffer.concat([output, chunk]);
        if (output.length > MACOS_HELPER_MAX_FRAME_BYTES) {
          child.kill('SIGKILL');
          finish(new MacOSHelperError('helper_output_too_large'));
        }
      });
      child.on('error', () => finish(new MacOSHelperError('helper_spawn_failed')));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) return finish(new MacOSHelperError('helper_failed'));
        try {
          const decoded = decodeHelperFrame(output, request.namespace);
          assertHelperResponse(decoded);
          finish(undefined, decoded);
        } catch {
          finish(new MacOSHelperError('helper_malformed_reply'));
        }
      });
      child.stdin.end(input);
    });
  }
}

export class FakeMacOSHelperTransport implements MacOSHelperTransport {
  public readonly requests: MacOSHelperRequest[] = [];

  public constructor(private readonly handler: (request: MacOSHelperRequest) => MacOSHelperResponse | Promise<MacOSHelperResponse>) {}

  public async request(request: MacOSHelperRequest): Promise<MacOSHelperResponse> {
    assertHelperRequest(request);
    this.requests.push(structuredClone(request));
    const response = await this.handler(request);
    assertHelperResponse(response);
    return structuredClone(response);
  }
}

export async function requestHelper(
  transport: MacOSHelperTransport,
  namespace: string,
  operation: MacOSHelperOperation,
  payload?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await transport.request({ version: 1, namespace, operation, payload });
  if (!response.ok) throw new MacOSHelperError(response.error?.code ?? 'helper_error');
  return response.result ?? {};
}
