import {
  assertJsonContentType,
  assertNoQuery,
  parseStrictDeviceAuthJson,
  readDeviceAuthBody,
  toDeviceAuthRequestError
} from "@/lib/device-auth/raw-json.server";
import { deviceAuthErrorResponse } from "@/lib/device-auth/response.server";
import { DeviceAuthError } from "@/lib/device-auth/errors";
import { sha256Digest } from "@/lib/device-auth/crypto.server";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { createSupabaseFactory } from "@/lib/device-auth/repository.server";
import { SupabaseDeviceAuthRefreshRepository } from "@/lib/device-auth/refresh-repository.server";
import { refreshLookupCryptoFromEnvironment, UnavailableReplayKeyProvider } from "@/lib/device-auth/refresh-crypto.server";
import { isRefreshRequest, REFRESH_PATH } from "@/lib/device-auth/refresh-contracts.server";
import { refreshDeviceToken, refreshSuccessResponse } from "@/lib/device-auth/refresh-service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    assertNoQuery(url);
    if (url.pathname !== REFRESH_PATH) throw new DeviceAuthError("proof_invalid");
    assertJsonContentType(request);
    const bytes = await readDeviceAuthBody(request);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new DeviceAuthError("invalid_request"); }
    let body: unknown;
    try { body = parseStrictDeviceAuthJson<unknown>(text); } catch { throw toDeviceAuthRequestError(undefined); }
    if (!isRefreshRequest(body)) throw new DeviceAuthError("invalid_request");
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const deviceId = request.headers.get("x-skillmap-device-id") ?? "";
    const proofSuite = request.headers.get("x-skillmap-device-proof-suite") ?? "";
    const audience = request.headers.get("x-skillmap-device-audience") ?? "";
    const purpose = request.headers.get("x-skillmap-device-purpose") ?? "";
    const nonce = request.headers.get("x-skillmap-device-nonce") ?? "";
    const issuedAt = request.headers.get("x-skillmap-device-issued-at") ?? "";
    const signature = request.headers.get("x-skillmap-device-proof") ?? "";
    const bodySha256 = request.headers.get("x-skillmap-device-body-sha256") ?? "";
    if (!deviceId || !proofSuite || !audience || !purpose || !nonce || !issuedAt || !signature || !bodySha256 || !/^[A-Za-z0-9_-]{22}$/.test(idempotencyKey)) throw new DeviceAuthError("invalid_request");
    const actualBodySha256 = sha256Digest(bytes);
    if (bodySha256 !== actualBodySha256) throw new DeviceAuthError("proof_invalid");
    const cfg = getDeviceAuthServerConfig();
    const repository = new SupabaseDeviceAuthRefreshRepository(createSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey));
    const result = await refreshDeviceToken({
      repository,
      lookupCrypto: refreshLookupCryptoFromEnvironment(),
      // No production/default replay key is permitted. M3.03 provider wiring
      // must inject an authorized provider before this feature can be granted.
      replayKeys: new UnavailableReplayKeyProvider()
    }, {
      body,
      rawBody: bytes,
      proof: {
        configuredOrigin: cfg.verificationUrl, path: REFRESH_PATH, proofSuite, audience, purpose,
        proofNonce: nonce, issuedAt, bodySha256, signature, proofSuiteHeader: proofSuite,
        audienceHeader: audience, purposeHeader: purpose, deviceIdHeader: deviceId, idempotencyKey
      }
    });
    return refreshSuccessResponse(result);
  } catch (error) {
    return deviceAuthErrorResponse(error);
  }
}
