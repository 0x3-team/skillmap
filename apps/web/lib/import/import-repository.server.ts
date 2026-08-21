import "server-only";

import { createClient } from "@supabase/supabase-js";
import { DeviceAuthError, DeviceAuthUnavailableError, type DeviceAuthErrorCode } from "@/lib/device-auth/errors";
import type { DeviceAuthProofKey } from "@/lib/device-auth/poll-exchange-repository.server";
import type { ImportAuthRepository, ImportAuthRpcResult } from "./import-auth.server.ts";
import { ImportRouteError } from "./import-errors.server.ts";

interface RpcCall {
  single<T = unknown>(): Promise<{ data: T | null; error: unknown }>;
}

export interface ImportRpcClient {
  rpc(name: string, params: Record<string, unknown>): RpcCall;
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(path: string, options: { upsert: boolean }): Promise<{
        data: { signedUrl: string; path: string; token: string } | null;
        error: unknown;
      }>;
    };
  };
}

export type ImportRpcFactory = (schema: "api" | "device_adapter") => ImportRpcClient;

export function createImportSupabaseFactory(
  supabaseUrl: string,
  serviceRoleKey: string,
  overrideFetch?: typeof fetch
): ImportRpcFactory {
  return (schema) => createClient(supabaseUrl, serviceRoleKey, {
    db: { schema },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: overrideFetch ? { fetch: overrideFetch } : undefined
  }) as unknown as ImportRpcClient;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Import RPC unavailable";
}

function mapDeviceAuthRpcError(result: ImportAuthRpcResult): never {
  const allowed: DeviceAuthErrorCode[] = [
    "invalid_request", "invalid_token", "invalid_client", "proof_required", "proof_invalid",
    "insufficient_scope", "rate_limited", "temporarily_unavailable"
  ];
  const code = typeof result.error === "string" && allowed.includes(result.error as DeviceAuthErrorCode)
    ? result.error as DeviceAuthErrorCode
    : "temporarily_unavailable";
  const retryAfter = typeof result.retry_after === "number" && Number.isSafeInteger(result.retry_after)
    ? result.retry_after
    : undefined;
  throw new DeviceAuthError(code, { retryAfter });
}

export class SupabaseImportAuthRepository implements ImportAuthRepository {
  private readonly factory: ImportRpcFactory;
  constructor(factory: ImportRpcFactory) { this.factory = factory; }

  async getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey> {
    const result = await this.call("device_auth_get_active_key_v1", { p_device_id: deviceId });
    if (typeof result.public_key !== "string"
      || typeof result.key_thumbprint !== "string"
      || result.proof_suite !== "skillmap.ecdsa-p256-sha256.v2") {
      throw new DeviceAuthError("invalid_token");
    }
    return {
      publicKey: result.public_key,
      keyThumbprint: result.key_thumbprint,
      proofSuite: result.proof_suite
    };
  }

  async authenticateImport(input: Record<string, unknown>): Promise<ImportAuthRpcResult> {
    const result = await this.call("device_auth_authenticate_import_v1", input) as ImportAuthRpcResult;
    if (typeof result.error === "string") mapDeviceAuthRpcError(result);
    return result;
  }

  private async call(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const { data, error } = await this.factory("api").rpc(name, params).single<Record<string, unknown>>();
      if (error || data === null) throw new Error(messageFrom(error));
      return data;
    } catch (error) {
      if (error instanceof DeviceAuthError || error instanceof DeviceAuthUnavailableError) throw error;
      throw new DeviceAuthUnavailableError("Import authentication RPC unavailable.", error);
    }
  }
}

export class SupabaseImportRepository {
  private readonly factory: ImportRpcFactory;
  constructor(factory: ImportRpcFactory) { this.factory = factory; }

  async prepareTarget(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_prepare_import_target", params);
  }

  async beginSession(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_begin_import_session_v2", params);
  }

  async prepareUpload(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_prepare_import_upload", params);
  }

  async acceptFile(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_accept_import_file_v2", params);
  }

  async listReceipts(params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.callNullable("adapter_list_import_file_receipts", params);
  }

  async expireSession(params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.callNullable("adapter_expire_import_session", params);
  }

  async finalizeSession(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_finalize_import_session_v2", params);
  }

  async requireCutoverConsent(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call("adapter_require_import_cutover_consent", params);
  }

  async createSignedUploadUrl(bucket: string, objectName: string): Promise<string> {
    try {
      const { data, error } = await this.factory("device_adapter").storage
        .from(bucket)
        .createSignedUploadUrl(objectName, { upsert: false });
      if (error || data === null || typeof data.signedUrl !== "string") {
        throw new Error(messageFrom(error));
      }
      return data.signedUrl;
    } catch (error) {
      throw new ImportRouteError("temporarily_unavailable", 0, error);
    }
  }

  private async call(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.callNullable(name, params);
    if (data === null) throw new ImportRouteError("session_not_found");
    return data;
  }

  private async callNullable(name: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const { data, error } = await this.factory("device_adapter").rpc(name, params).single<Record<string, unknown>>();
      if (error) throw new Error(messageFrom(error));
      return data;
    } catch (error) {
      if (error instanceof ImportRouteError) throw error;
      const message = messageFrom(error).toLowerCase();
      if (message.includes("already accepted")) throw new ImportRouteError("already_accepted");
      if (message.includes("import cutover consent required")) throw new ImportRouteError("owner_consent_required");
      if (message.includes("revision") || message.includes("conflict")) throw new ImportRouteError("session_conflict");
      if (message.includes("expired") || message.includes("expiry")) throw new ImportRouteError("session_expired");
      if (message.includes("authority unavailable") || message.includes("permission denied")) throw new ImportRouteError("unauthorized");
      if (message.includes("invalid") || message.includes("does not match") || message.includes("outside")) {
        throw new ImportRouteError("invalid_request");
      }
      throw new ImportRouteError("temporarily_unavailable", 0, error);
    }
  }
}
