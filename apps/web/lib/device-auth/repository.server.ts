/* DeviceAuth v1 repository seam (server-only).
 *
 * The service depends on this narrow interface. Production wiring uses the
 * Supabase server-only RPC surface (`api.device_auth_initiate_v1`); unit tests
 * use an injected in-memory store. No raw token, code, or key material ever
 * returns to callers; lookups model them only as HMAC-like 43-char opaque
 * values. The repository never persists secret plaintext beyond what the RPC
 * contract requires (M1.08: server stores only keyed hashes).
 */

import "server-only";
import { DeviceAuthError } from "./errors.ts";

export interface DeviceAuthPairingCreated {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  display: {
    name: string;
    platform: "macos" | "windows" | "linux";
    connector_version: string;
    locale?: string;
  };
}

export interface InitiatePairingInput {
  deviceId: string;
  devicePublicKey: string;
  keyThumbprint: string;
  audience: string;
  proofSuite: string;
  requestedScopes: string[];
  displayName?: string;
  platform: "macos" | "windows" | "linux";
  connectorVersion: string;
  locale?: string;
  verificationOrigin: string;
  expiresIn: number;
  interval: number;
  /** M3.02 request envelope fields persisted and enforced by the RPC. */
  idempotencyKey: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  /** The exact V2 idempotency request digest (M1.08 idempotency contract). */
  requestDigest: string;
  /** The exact SHA-256 of the raw request body (bound in the proof preimage). */
  bodySha256: string;
}

export interface DeviceAuthRepository {
  /**
   * Create a pairing record and return the Connector-only initiation response.
   * Any failure (dup device, rate limit, idempotency conflict) throws
   * DeviceAuthError; the same key/digest retry returns the identical response.
   */
  initiatePairing(input: InitiatePairingInput): Promise<DeviceAuthPairingCreated>;
}

/** Thrown when the backing store is unavailable (maps to 503). */
export class DeviceAuthRepositoryUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DeviceAuthRepositoryUnavailableError";
  }
}

import { createClient } from "@supabase/supabase-js";
import type { DeviceAuthErrorCode } from "./errors.ts";

/** Minimal typed RPC surface; a Supabase service client satisfies this. */
export interface DeviceAuthRpcClient {
  rpc(fn: string, params: Record<string, unknown>): {
    single<T = unknown>(): Promise<{ data: T | null; error: Error | null }>;
  };
}

/** A factory that creates the service-role client on demand (server-only). */
export type ServiceClientFactory = () => DeviceAuthRpcClient;

export interface DeviceAuthInitiateRpcResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  display: {
    name?: string;
    platform: string;
    connector_version: string;
    locale?: string;
  };
  error: string | null;
  error_description: string | null;
  retry_after: number;
}

/**
 * Server-only Supabase repository. The service role key is injected by the
 * caller (from config) and is never a deploy/browser value. The RPC is
 * `api.device_auth_initiate_v1`.
 */
export class SupabaseDeviceAuthRepository implements DeviceAuthRepository {
  private readonly factory: ServiceClientFactory;

  constructor(factory: ServiceClientFactory) {
    // Assigned to a field rather than a TS parameter property so the module
    // loads under Node's `--experimental-strip-types` (which only strips types
    // and rejects parameter-property syntax), keeping the real seam testable.
    this.factory = factory;
  }

  private client(): DeviceAuthRpcClient {
    return this.factory();
  }

  async initiatePairing(input: InitiatePairingInput): Promise<DeviceAuthPairingCreated> {
    const body: Record<string, unknown> = {
      p_device_id: input.deviceId,
      p_device_public_key: input.devicePublicKey,
      p_key_thumbprint: input.keyThumbprint,
      p_audience: input.audience,
      p_proof_suite: input.proofSuite,
      p_proof_purpose: input.proofPurpose,
      p_requested_scopes: input.requestedScopes,
      p_platform: input.platform,
      p_connector_version: input.connectorVersion,
      p_verification_uri_prefix: input.verificationOrigin,
      p_expires_in: input.expiresIn,
      p_interval: input.interval,
      p_idempotency_key: input.idempotencyKey,
      p_proof_nonce: input.proofNonce,
      p_issued_at: input.issuedAt,
      p_request_digest: input.requestDigest
    };
    if (input.displayName !== undefined) body.p_display_name = input.displayName;
    if (input.locale !== undefined) body.p_locale = input.locale;

    let result: DeviceAuthInitiateRpcResult;
    try {
      const { data, error } = await this.client()
        .rpc("device_auth_initiate_v1", body)
        .single<DeviceAuthInitiateRpcResult>();
      if (error) {
        // The RPC returns a structured result on success; PostgREST network errors
        // surface here.
        throw new DeviceAuthRepositoryUnavailableError("DeviceAuth RPC unavailable", error);
      }
      if (data === null) {
        throw new DeviceAuthRepositoryUnavailableError("DeviceAuth RPC returned no result.");
      }
      result = data;
    } catch (error) {
      if (error instanceof DeviceAuthRepositoryUnavailableError) throw error;
      throw new DeviceAuthRepositoryUnavailableError("DeviceAuth RPC failed", error);
    }

    if (result.error) {
      // Map the frozen RPC error code onto the wire error. The RPC only ever
      // returns exact DeviceAuth error codes.
      throw mapRpcError(result.error, result.retry_after);
    }

    return {
      device_code: result.device_code,
      user_code: result.user_code,
      verification_uri: result.verification_uri,
      expires_in: result.expires_in,
      interval: result.interval,
      display: {
        name: result.display?.name ?? input.displayName ?? "",
        platform: result.display.platform as DeviceAuthPairingCreated["display"]["platform"],
        connector_version: result.display.connector_version,
        locale: result.display.locale
      }
    };
  }
}

function mapRpcError(code: string, retryAfter: number): never {
  throw new DeviceAuthError(code as DeviceAuthErrorCode, { retryAfter: retryAfter > 0 ? retryAfter : undefined });
}

/** A ServiceClientFactory that reads the service role key from environment. */
/** A ServiceClientFactory that reads the service role key from environment. */
export function createSupabaseFactory(
  supabaseUrl: string,
  serviceRoleKey: string,
  opts?: { overrideFetch?: typeof fetch }
): ServiceClientFactory {
  return () => {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: "api" },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      global: opts?.overrideFetch ? { fetch: opts.overrideFetch } : undefined
    });
    return client as unknown as DeviceAuthRpcClient;
  };
}