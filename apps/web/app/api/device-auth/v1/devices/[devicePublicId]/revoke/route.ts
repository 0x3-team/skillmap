import {
  assertJsonContentType, assertNoQuery, parseStrictDeviceAuthJson, readDeviceAuthBody, toDeviceAuthRequestError
} from "@/lib/device-auth/raw-json.server";
import { deviceAuthErrorResponse, deviceAuthJsonResponse } from "@/lib/device-auth/response.server";
import { DeviceAuthError } from "@/lib/device-auth/errors";
import { sha256Digest } from "@/lib/device-auth/crypto.server";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { createSupabaseFactory } from "@/lib/device-auth/repository.server";
import { SupabaseDeviceAuthLifecycleRepository } from "@/lib/device-auth/lifecycle-repository.server";
import { revokeDevice } from "@/lib/device-auth/lifecycle-service.server";
import { isDevicePublicId, revokePath } from "@/lib/device-auth/lifecycle-contracts.server";
import { deviceAuthLookupKeysFromEnvironment, strictBearerToken } from "@/lib/device-auth/lifecycle-crypto.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext { params: Promise<{ devicePublicId: string }> }

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { devicePublicId } = await context.params;
    if (!isDevicePublicId(devicePublicId)) throw new DeviceAuthError("invalid_request");
    const url = new URL(request.url);
    assertNoQuery(url);
    const expectedPath = revokePath(devicePublicId);
    if (url.pathname !== expectedPath) throw new DeviceAuthError("proof_invalid");
    assertJsonContentType(request);
    const rawBody = await readDeviceAuthBody(request);
    let body: unknown;
    try { body = parseStrictDeviceAuthJson(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)); }
    catch { throw toDeviceAuthRequestError(undefined); }
    const token = strictBearerToken(request.headers.get("authorization"));
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const deviceId = request.headers.get("x-skillmap-device-id") ?? "";
    const proofSuite = request.headers.get("x-skillmap-device-proof-suite") ?? "";
    const audience = request.headers.get("x-skillmap-device-audience") ?? "";
    const purpose = request.headers.get("x-skillmap-device-purpose") ?? "";
    const nonce = request.headers.get("x-skillmap-device-nonce") ?? "";
    const issuedAt = request.headers.get("x-skillmap-device-issued-at") ?? "";
    const signature = request.headers.get("x-skillmap-device-proof") ?? "";
    const bodySha256 = request.headers.get("x-skillmap-device-body-sha256") ?? "";
    if (!idempotencyKey || !deviceId || !proofSuite || !audience || !purpose || !nonce || !issuedAt || !signature || !bodySha256) throw new DeviceAuthError("invalid_request");
    if (bodySha256 !== sha256Digest(rawBody)) throw new DeviceAuthError("proof_invalid");
    const cfg = getDeviceAuthServerConfig();
    const repository = new SupabaseDeviceAuthLifecycleRepository(createSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey));
    const result = await revokeDevice({ repository, lookupKeys: deviceAuthLookupKeysFromEnvironment() }, {
      body, rawBody,
      proof: { configuredOrigin: cfg.verificationUrl, path: expectedPath, method: "POST", proofSuite, audience, purpose,
        deviceIdHeader: deviceId, keyThumbprint: "", nonce, issuedAt, bodySha256, signature, idempotencyKey, accessTokenSha256: sha256Digest(token) },
      proofAccessToken: token
    }, devicePublicId);
    return deviceAuthJsonResponse(result, 200, false);
  } catch (error) { return deviceAuthErrorResponse(error); }
}
