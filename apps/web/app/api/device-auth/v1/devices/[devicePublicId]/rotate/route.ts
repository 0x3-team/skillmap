import {
  assertJsonContentType,
  assertNoQuery,
  parseStrictDeviceAuthJson,
  readDeviceAuthBody,
  StrictDeviceAuthJsonError,
  toDeviceAuthRequestError
} from "@/lib/device-auth/raw-json.server";
import { deviceAuthErrorResponse, deviceAuthSuccessResponse } from "@/lib/device-auth/response.server";
import { DeviceAuthError } from "@/lib/device-auth/errors";
import { sha256Digest } from "@/lib/device-auth/crypto.server";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { deviceAuthLookupKeysFromEnvironment } from "@/lib/device-auth/lifecycle-crypto.server";
import { createSupabaseFactory } from "@/lib/device-auth/repository.server";
import { isDeviceKeyRotationRequest, rotationPath } from "@/lib/device-auth/key-rotation-contracts.server";
import { SupabaseDeviceKeyRotationRepository } from "@/lib/device-auth/key-rotation-repository.server";
import { rotateDeviceKey } from "@/lib/device-auth/key-rotation-service.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ devicePublicId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { devicePublicId } = await context.params;
    const url = new URL(request.url);
    assertNoQuery(url);
    const expectedPath = rotationPath(devicePublicId);
    if (url.pathname !== expectedPath) throw new DeviceAuthError("proof_invalid");
    assertJsonContentType(request);
    const rawBody = await readDeviceAuthBody(request);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody); }
    catch { throw new DeviceAuthError("invalid_request"); }
    let decoded: unknown;
    try { decoded = parseStrictDeviceAuthJson<unknown>(text); }
    catch { throw toDeviceAuthRequestError(undefined); }
    if (!isDeviceKeyRotationRequest(decoded)) throw new DeviceAuthError("invalid_request");

    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const deviceIdHeader = request.headers.get("x-skillmap-device-id") ?? "";
    const proofSuiteHeader = request.headers.get("x-skillmap-device-proof-suite") ?? "";
    const audienceHeader = request.headers.get("x-skillmap-device-audience") ?? "";
    const bodySha256 = request.headers.get("x-skillmap-device-body-sha256") ?? "";
    const oldPurpose = request.headers.get("x-skillmap-device-purpose") ?? "";
    const newPurpose = request.headers.get("x-skillmap-device-new-purpose") ?? "";
    const oldNonce = request.headers.get("x-skillmap-device-nonce") ?? "";
    const newNonce = request.headers.get("x-skillmap-device-new-nonce") ?? "";
    const oldIssuedAt = request.headers.get("x-skillmap-device-issued-at") ?? "";
    const newIssuedAt = request.headers.get("x-skillmap-device-new-issued-at") ?? "";
    const oldSignature = request.headers.get("x-skillmap-device-proof") ?? "";
    const newSignature = request.headers.get("x-skillmap-device-new-proof") ?? "";
    if (bodySha256 !== sha256Digest(rawBody)) throw new DeviceAuthError("proof_invalid");
    if (!idempotencyKey || !deviceIdHeader || !proofSuiteHeader || !audienceHeader || !oldPurpose || !newPurpose
        || !oldNonce || !newNonce || !oldIssuedAt || !newIssuedAt || !oldSignature || !newSignature) {
      throw new DeviceAuthError("invalid_request");
    }

    const cfg = getDeviceAuthServerConfig();
    const lookupKeys = deviceAuthLookupKeysFromEnvironment();
    const repository = new SupabaseDeviceKeyRotationRepository(createSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey));
    const result = await rotateDeviceKey({ repository, lookupKeys }, {
      devicePublicId,
      body: decoded,
      rawBody,
      proof: {
        configuredOrigin: cfg.verificationUrl,
        path: expectedPath,
        proofSuite: proofSuiteHeader,
        audience: decoded.audience,
        proofSuiteHeader,
        audienceHeader,
        deviceIdHeader,
        bodySha256,
        idempotencyKey,
        oldPurpose,
        newPurpose,
        oldNonce,
        newNonce,
        oldIssuedAt,
        newIssuedAt,
        oldSignature,
        newSignature
      }
    });
    return deviceAuthSuccessResponse(result);
  } catch (error) {
    return deviceAuthErrorResponse(error instanceof StrictDeviceAuthJsonError ? new DeviceAuthError("invalid_request") : error);
  }
}
