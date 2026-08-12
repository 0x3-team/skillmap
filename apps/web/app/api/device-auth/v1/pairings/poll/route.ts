import {
  assertJsonContentType,
  assertNoQuery,
  parseStrictDeviceAuthJson,
  readDeviceAuthBody,
  toDeviceAuthRequestError
} from "@/lib/device-auth/raw-json.server";
import { deviceAuthErrorResponse, deviceAuthSuccessResponse } from "@/lib/device-auth/response.server";
import { DeviceAuthError } from "@/lib/device-auth/errors";
import { sha256Digest } from "@/lib/device-auth/crypto.server";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { createSupabaseFactory } from "@/lib/device-auth/repository.server";
import { SupabaseDeviceAuthPollExchangeRepository } from "@/lib/device-auth/poll-exchange-repository.server";
import { isPollRequest, POLL_PATH } from "@/lib/device-auth/poll-exchange-contracts.server";
import { pollPairing } from "@/lib/device-auth/poll-exchange-service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    assertNoQuery(url);
    assertJsonContentType(request);
    const bytes = await readDeviceAuthBody(request);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new DeviceAuthError("invalid_request"); }
    let body: unknown;
    try { body = parseStrictDeviceAuthJson<unknown>(text); } catch { throw toDeviceAuthRequestError(undefined); }
    if (!isPollRequest(body)) throw new DeviceAuthError("invalid_request");
    const cfg = getDeviceAuthServerConfig();
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!/^[A-Za-z0-9_-]{22}$/.test(idempotencyKey)) throw new DeviceAuthError("invalid_request");
    const deviceIdHeader = request.headers.get("x-skillmap-device-id") ?? "";
    const proofSuiteHeader = request.headers.get("x-skillmap-device-proof-suite") ?? "";
    const audienceHeader = request.headers.get("x-skillmap-device-audience") ?? "";
    const purposeHeader = request.headers.get("x-skillmap-device-purpose") ?? "";
    const proofNonce = request.headers.get("x-skillmap-device-nonce") ?? "";
    const issuedAt = request.headers.get("x-skillmap-device-issued-at") ?? "";
    const signature = request.headers.get("x-skillmap-device-proof") ?? "";
    const bodySha256 = request.headers.get("x-skillmap-device-body-sha256") ?? "";
    const actualBodySha256 = sha256Digest(bytes);
    if (!deviceIdHeader || !proofSuiteHeader || !audienceHeader || !purposeHeader || !proofNonce || !issuedAt || !signature || !bodySha256) throw new DeviceAuthError("invalid_request");
    if (bodySha256 !== actualBodySha256) throw new DeviceAuthError("proof_invalid");
    if (url.pathname !== POLL_PATH) throw new DeviceAuthError("proof_invalid");
    const repository = new SupabaseDeviceAuthPollExchangeRepository(createSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey));
    const proofKey = await repository.getActiveProofKey(body.device_id);
    const result = await pollPairing(repository, body, {
      configuredOrigin: cfg.verificationUrl, path: POLL_PATH, proofSuite: proofSuiteHeader,
      audience: body.audience, purpose: "poll", proofNonce, issuedAt, bodySha256,
      signature, proofSuiteHeader, audienceHeader, purposeHeader,
      deviceIdHeader, idempotencyKey
    }, proofKey);
    return deviceAuthSuccessResponse(result);
  } catch (error) {
    return deviceAuthErrorResponse(error);
  }
}
