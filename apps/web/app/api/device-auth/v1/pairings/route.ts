/* POST /api/device-auth/v1/pairings — DeviceAuth pairing initiation (M3.03).
 *
 * Strict parse → closed-schema guards → host/path → proof → service method →
 * exact no-store response. No .from() or generic RPC; this is a service-only
 * seam. The service role credential is read from server-only config and never
 * touches the browser.
 */

import {
  assertJsonContentType,
  assertNoQuery,
  parseStrictDeviceAuthJson,
  readDeviceAuthBody,
  toDeviceAuthRequestError
} from "@/lib/device-auth/raw-json.server";
import { deviceAuthErrorResponse, deviceAuthSuccessResponse } from "@/lib/device-auth/response.server";
import { initiatePairing } from "@/lib/device-auth/service.server";
import type { DeviceAuthInitiateRequestV1 } from "@/lib/device-auth/contracts";
import { getDeviceAuthServerConfig } from "@/lib/device-auth/config";
import { sha256Digest, buildIdempotencyDigest } from "@/lib/device-auth/crypto.server";
import { DeviceAuthError } from "@/lib/device-auth/errors";
import { SupabaseDeviceAuthRepository, createSupabaseFactory } from "@/lib/device-auth/repository.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INITIATE_PATH = "/api/device-auth/v1/pairings";

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    assertNoQuery(url);
    assertJsonContentType(request);

    const bytes = await readDeviceAuthBody(request);
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let body: DeviceAuthInitiateRequestV1;
    try {
      body = parseStrictDeviceAuthJson<DeviceAuthInitiateRequestV1>(utf8);
    } catch {
      throw toDeviceAuthRequestError(undefined);
    }

    const cfg = getDeviceAuthServerConfig();
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!/^[A-Za-z0-9_-]{22}$/.test(idempotencyKey)) throw new DeviceAuthError("invalid_request");

    // M3.2 proof-bearing headers (exact names). Each is REQUIRED: an absent or
    // empty value is a client error, never silently reconciled. The service
    // reconciles these against the closed JSON body (audience, proof_suite) and
    // the verified key (device_id, key thumbprint) before any state lookup.
    const deviceIdHeader = request.headers.get("x-skillmap-device-id") ?? "";
    const proofSuiteHeader = request.headers.get("x-skillmap-device-proof-suite") ?? "";
    const audienceHeader = request.headers.get("x-skillmap-device-audience") ?? "";
    const proofPurposeHeader = request.headers.get("x-skillmap-device-purpose") ?? "";
    const proofNonce = request.headers.get("x-skillmap-device-nonce") ?? "";
    const issuedAt = request.headers.get("x-skillmap-device-issued-at") ?? "";
    const signature = request.headers.get("x-skillmap-device-proof") ?? "";
    const bodySha256Header = request.headers.get("x-skillmap-device-body-sha256") ?? "";
    const bodySha256 = sha256Digest(bytes);

    // Reject empty required proof/body headers at the boundary so a missing
    // header is never passed downstream as the empty-string reconcile sentinel.
    if (deviceIdHeader === "" || proofSuiteHeader === "" || audienceHeader === "" ||
        proofPurposeHeader === "" || proofNonce === "" || issuedAt === "" ||
        signature === "" || bodySha256Header === "") {
      throw new DeviceAuthError("invalid_request");
    }

    // The exact byte hash of this request body must match the header the
    // connector signed and the body_sha256 field in the preimage. Reject a
    // supplied Body-SHA256 that disagrees with our own hash.
    if (bodySha256Header !== bodySha256) throw new DeviceAuthError("proof_invalid");

    const repository = new SupabaseDeviceAuthRepository(
      createSupabaseFactory(cfg.supabaseUrl, cfg.serviceRoleKey)
    );

    const result = await initiatePairing(repository, {
      path: INITIATE_PATH,
      configuredOrigin: cfg.verificationUrl,
      deviceId: body.device_id,
      devicePublicKey: body.device_public_key,
      keyThumbprint: body.key_thumbprint,
      requestedScopes: body.requested_scopes,
      platform: body.platform,
      connectorVersion: body.connector_version,
      displayName: body.display_name,
      locale: body.locale,
      idempotencyKey,
      proofSuite: body.proof_suite,
      audience: body.audience,
      proofPurpose: "initiate",
      proofNonce,
      issuedAt,
      bodySha256,
      requestDigest: buildIdempotencyDigest({
        suite: body.proof_suite,
        method: "POST",
        origin: cfg.verificationUrl,
        path: INITIATE_PATH,
        audience: body.audience,
        operation: "initiate",
        bodySha256,
        idempotencyKey
      }),
      signature,
      // The proof header set must reconcile with the JSON body below.
      deviceIdHeader,
      audienceHeader,
      proofPurposeHeader,
      proofSuiteHeader
    });

    return deviceAuthSuccessResponse(result);
  } catch (error) {
    return deviceAuthErrorResponse(error);
  }
}