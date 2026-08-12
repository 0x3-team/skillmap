import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "./errors.ts";
import { buildIdempotencyDigest, computeKeyThumbprint, isValidP256Spki, sha256Digest, verifyDeviceProof } from "./crypto.server.ts";
import {
  buildRefreshReplayAadV1,
  encodeRefreshSuccessV1,
  openRefreshResponseV1,
  replayEpochId,
  sealRefreshResponseV1,
  type RefreshLookupCrypto,
  type ReplayKeyProvider,
} from "./refresh-crypto.server.ts";
import {
  REFRESH_ACCESS_SECONDS,
  REFRESH_IDLE_SECONDS,
  REFRESH_PATH,
  REFRESH_PURGE_SECONDS,
  REFRESH_REPLAY_SECONDS,
  REFRESH_RESPONSE_VERSION,
  isRefreshProofEnvelope,
  isRefreshRequest,
  isRefreshResponse,
  type RefreshProofEnvelope,
  type RefreshTokenRequestV1,
  type RefreshTokenResponseV1
} from "./refresh-contracts.server.ts";
import type { DeviceAuthRefreshRepository } from "./refresh-repository.server.ts";

const ISSUED_AT_SKEW_SECONDS = 60;

export function buildRefreshProofPreimageV2(args: {
  origin: string; path: string; deviceId: string; thumbprint: string; bodySha256: string;
  idempotencyKey: string; nonce: string; issuedAt: number;
}): string {
  return [
    "SKILLMAP-DEVICE-PROOF-V2", "skillmap.ecdsa-p256-sha256.v2", "POST", args.origin, args.path,
    "skillmap.connector.v1", "refresh", args.deviceId, args.thumbprint, args.bodySha256,
    args.idempotencyKey, args.nonce, String(args.issuedAt), "NONE", ""
  ].join("\n");
}

export interface RefreshServiceDependencies {
  repository: DeviceAuthRefreshRepository;
  lookupCrypto: RefreshLookupCrypto;
  replayKeys?: ReplayKeyProvider;
  /** Explicitly non-production mode. Exact replay remains the default seam. */
  refreshMode?: "alpha-single-shot" | "exact-replay";
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

export interface RefreshServiceInput {
  body: RefreshTokenRequestV1;
  proof: RefreshProofEnvelope;
  rawBody: Uint8Array;
}

export interface RefreshServiceResult {
  body: Uint8Array;
  responseIssuedAt: number;
}

export async function refreshDeviceToken(deps: RefreshServiceDependencies, input: RefreshServiceInput): Promise<RefreshServiceResult> {
  if (!isRefreshRequest(input.body) || !isRefreshProofEnvelope(input.proof)) throw new DeviceAuthError("invalid_request");
  if (input.proof.deviceIdHeader !== input.body.device_id) throw new DeviceAuthError("invalid_request");
  if (input.proof.bodySha256 !== sha256Digest(input.rawBody)) throw new DeviceAuthError("proof_invalid");
  const issuedAt = Number(input.proof.issuedAt);
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > ISSUED_AT_SKEW_SECONDS) throw new DeviceAuthError("invalid_request");

  const requestDigest = buildIdempotencyDigest({
    suite: input.proof.proofSuite, method: "POST", origin: input.proof.configuredOrigin, path: REFRESH_PATH,
    audience: input.body.audience, operation: "refresh", bodySha256: input.proof.bodySha256,
    idempotencyKey: input.proof.idempotencyKey
  });
  if (!deps.repository.getActiveProofKey) throw new DeviceAuthUnavailableError("DeviceAuth proof key lookup is unavailable.");
  const proofKey = await deps.repository.getActiveProofKey(input.body.device_id);
  if (proofKey.proofSuite !== input.proof.proofSuite || !isValidP256Spki(proofKey.publicKey)) throw new DeviceAuthError("proof_invalid");
  const storedThumbprint = computeKeyThumbprint(proofKey.publicKey);
  if (!storedThumbprint || storedThumbprint !== proofKey.keyThumbprint) throw new DeviceAuthError("proof_invalid");
  const proofPreimage = buildRefreshProofPreimageV2({
    origin: input.proof.configuredOrigin, path: REFRESH_PATH, deviceId: input.body.device_id,
    thumbprint: storedThumbprint, bodySha256: input.proof.bodySha256, idempotencyKey: input.proof.idempotencyKey,
    nonce: input.proof.proofNonce, issuedAt
  });
  await verifyDeviceProof({ suite: "skillmap.ecdsa-p256-sha256.v2", devicePublicKey: proofKey.publicKey, signature: input.proof.signature, preimage: proofPreimage });
  const idempotencyDigest = deps.lookupCrypto.digest("idempotency-key", input.proof.idempotencyKey);
  const responseIssuedAt = now;
  const replayUntil = checkedAdd(responseIssuedAt, REFRESH_REPLAY_SECONDS);
  const runtimePurgeAfter = checkedAdd(responseIssuedAt, REFRESH_PURGE_SECONDS);
  const context = deps.repository.getRefreshContext
    ? await deps.repository.getRefreshContext(input.body.device_id, input.body.token_family_id)
    : { devicePublicId: "dev_" + "0".repeat(32), accountPublicId: "acct_" + "0".repeat(32), tokenFamilyId: input.body.token_family_id, currentGeneration: 1, absoluteExpiresAt: responseIssuedAt + 7_776_000 };
  const [accessToken, refreshToken] = await Promise.all([deps.lookupCrypto.generateToken(), deps.lookupCrypto.generateToken()]);
  if (accessToken === refreshToken || !isRefreshToken(accessToken) || !isRefreshToken(refreshToken)) throw new DeviceAuthUnavailableError("Token generation failed.");

  const tokenFamilyId = input.body.token_family_id;
  const absoluteRemaining = Math.max(0, Math.min(7_776_000, context.absoluteExpiresAt - responseIssuedAt));
  if (absoluteRemaining < 1) throw new DeviceAuthError("invalid_grant");
  const candidate: RefreshTokenResponseV1 = {
    // These identifiers are rebound to the locked family by the RPC. The
    // service never accepts public identifiers from the request body.
    device_public_id: context.devicePublicId,
    account_public_id: context.accountPublicId,
    token_family_id: context.tokenFamilyId,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Math.min(REFRESH_ACCESS_SECONDS, absoluteRemaining),
    refresh_idle_expires_in: Math.min(REFRESH_IDLE_SECONDS, absoluteRemaining),
    refresh_absolute_expires_in: absoluteRemaining
  };
  const provisionalBody = encodeRefreshSuccessV1(candidate);
  const bodyDigest = sha256Digest(provisionalBody);
  if ((deps.refreshMode ?? "exact-replay") === "alpha-single-shot") {
    if (!deps.repository.refreshTokenSingleShot) {
      throw new DeviceAuthUnavailableError("Alpha single-shot refresh transition is unavailable.");
    }
    const transition = await deps.repository.refreshTokenSingleShot({
      refreshTokenDigest: deps.lookupCrypto.digest("refresh-token", input.body.refresh_token),
      successorRefreshTokenDigest: deps.lookupCrypto.digest("refresh-token", refreshToken),
      refreshTokenKeyVersion: deps.lookupCrypto.keyVersion,
      deviceId: input.body.device_id,
      tokenFamilyId,
      audience: input.body.audience,
      proofSuite: input.proof.proofSuite,
      proofPurpose: input.proof.purpose,
      proofNonce: input.proof.proofNonce,
      issuedAt: input.proof.issuedAt,
      requestDigest,
      idempotencyKeyDigest: idempotencyDigest,
      idempotencyKeyVersion: deps.lookupCrypto.keyVersion,
      responseIssuedAt,
      responseFormatVersion: REFRESH_RESPONSE_VERSION,
      accessTokenDigest: deps.lookupCrypto.digest("access-token", accessToken),
      accessTokenKeyVersion: deps.lookupCrypto.keyVersion
    });
    if (transition.outcome === "committed") {
      if (!transition.devicePublicId || !transition.accountPublicId || !transition.tokenFamilyId || !Number.isSafeInteger(transition.successorGeneration)) {
        throw new DeviceAuthUnavailableError("Refresh transition was incomplete.");
      }
      const finalResponse = {
        ...candidate,
        device_public_id: transition.devicePublicId,
        account_public_id: transition.accountPublicId,
        token_family_id: transition.tokenFamilyId
      };
      if (!isRefreshResponse(finalResponse)) throw new DeviceAuthUnavailableError("Refresh response schema mismatch.");
      return { body: encodeRefreshSuccessV1(finalResponse), responseIssuedAt: transition.responseIssuedAt ?? responseIssuedAt };
    }
    if (transition.outcome === "idempotency_conflict") throw new DeviceAuthError("idempotency_conflict");
    if (transition.outcome === "response_unavailable") throw new DeviceAuthError("temporarily_unavailable");
    if (transition.outcome === "family_revoked" || transition.outcome === "invalid_grant") throw new DeviceAuthError("invalid_grant");
    throw new DeviceAuthUnavailableError("Alpha single-shot refresh transition unavailable.");
  }
  if (!deps.replayKeys) throw new DeviceAuthUnavailableError("Replay key provider is unavailable.");
  const replayKeyVersion = replayEpochId(responseIssuedAt);
  const nonce = (deps.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length))))(12);
  // The public IDs and generation are authoritative DB values. The RPC binds
  // the supplied ciphertext to those values; a failed provisional AAD cannot
  // be accepted because the receipt's body digest is checked on replay.
  const aad = buildRefreshReplayAadV1({
    proofSuite: input.proof.proofSuite, devicePublicId: candidate.device_public_id, tokenFamilyId: context.tokenFamilyId,
    idempotencyKeyDigest: idempotencyDigest, requestDigest,
    responseIssuedAt, replayUntil, bodyDigest, bodyLength: provisionalBody.byteLength,
    priorGeneration: context.currentGeneration, successorGeneration: context.currentGeneration + 1
  });
  const sealed = await sealRefreshResponseV1({
    provider: deps.replayKeys, replayKeyVersion, responseIssuedAt, replayUntil, runtimePurgeAfter,
    aad, body: provisionalBody, nonce, randomBytes: deps.randomBytes
  });
  const transition = await deps.repository.refreshToken({
    refreshTokenDigest: deps.lookupCrypto.digest("refresh-token", input.body.refresh_token),
    successorRefreshTokenDigest: deps.lookupCrypto.digest("refresh-token", refreshToken),
    refreshTokenKeyVersion: deps.lookupCrypto.keyVersion, deviceId: input.body.device_id,
    tokenFamilyId, audience: input.body.audience, proofSuite: input.proof.proofSuite, proofPurpose: input.proof.purpose,
    proofNonce: input.proof.proofNonce, issuedAt: input.proof.issuedAt, requestDigest,
    idempotencyKeyDigest: idempotencyDigest, idempotencyKeyVersion: deps.lookupCrypto.keyVersion,
    responseIssuedAt, replayKeyVersion: sealed.replayKeyVersion, replayNonce: sealed.nonce, replayCiphertext: sealed.ciphertext,
    replayBodyDigest: sealed.bodyDigest, replayBodyLength: sealed.bodyLength, replayUntil, runtimePurgeAfter,
    responseFormatVersion: REFRESH_RESPONSE_VERSION, accessTokenDigest: deps.lookupCrypto.digest("access-token", accessToken),
    accessTokenKeyVersion: deps.lookupCrypto.keyVersion
  });
  if (transition.outcome === "committed") {
    if (!transition.devicePublicId || !transition.accountPublicId || !transition.tokenFamilyId || !Number.isSafeInteger(transition.successorGeneration)) throw new DeviceAuthUnavailableError("Refresh transition was incomplete.");
    const finalResponse = { ...candidate, device_public_id: transition.devicePublicId, account_public_id: transition.accountPublicId, token_family_id: transition.tokenFamilyId };
    if (!isRefreshResponse(finalResponse)) throw new DeviceAuthUnavailableError("Refresh response schema mismatch.");
    const finalBody = encodeRefreshSuccessV1(finalResponse);
    // The DB returns authoritative response identity. The provisional AAD is
    // deliberately never replayed if the identity differs; this keeps a bad
    // integration fail-closed instead of yielding a mismatched bearer body.
    if (sha256Digest(finalBody) !== sealed.bodyDigest) throw new DeviceAuthUnavailableError("Refresh response identity mismatch.");
    return { body: finalBody, responseIssuedAt: transition.responseIssuedAt ?? responseIssuedAt };
  }
  if (transition.outcome === "exact_replay" && transition.replay && Number.isSafeInteger(transition.priorGeneration) && Number.isSafeInteger(transition.successorGeneration)) {
    const priorGeneration = transition.priorGeneration as number;
    const successorGeneration = transition.successorGeneration as number;
    const replayAad = buildRefreshReplayAadV1({
      proofSuite: input.proof.proofSuite, devicePublicId: transition.devicePublicId ?? candidate.device_public_id,
      tokenFamilyId: transition.tokenFamilyId ?? tokenFamilyId, idempotencyKeyDigest: idempotencyDigest, requestDigest,
      priorGeneration, successorGeneration,
      responseIssuedAt: transition.replay.responseIssuedAt, replayUntil: transition.replay.replayUntil,
      responseFormatVersion: transition.replay.responseFormatVersion, bodyDigest: transition.replay.bodyDigest,
      bodyLength: transition.replay.bodyLength
    });
    try {
      const body = await openRefreshResponseV1({ provider: deps.replayKeys, sealed: transition.replay, aad: replayAad, now });
      return { body, responseIssuedAt: transition.replay.responseIssuedAt };
    } catch {
      try { await deps.repository.failClosed?.(idempotencyDigest, transition.tokenFamilyId ?? tokenFamilyId); } catch { /* fixed-safe error below */ }
      throw new DeviceAuthError("temporarily_unavailable");
    }
  }
  if (transition.outcome === "idempotency_conflict") throw new DeviceAuthError("idempotency_conflict");
  if (transition.outcome === "replay_corrupt" || transition.outcome === "exact_replay") {
    try { await deps.repository.failClosed?.(idempotencyDigest, transition.tokenFamilyId ?? tokenFamilyId); } catch { /* fixed-safe error below */ }
    throw new DeviceAuthError("temporarily_unavailable");
  }
  throw new DeviceAuthError("invalid_grant");
}

export function refreshSuccessResponse(result: RefreshServiceResult): Response {
  return new Response(result.body as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-skillmap-response-issued-at": String(result.responseIssuedAt)
    }
  });
}

function checkedAdd(value: number, increment: number): number {
  const result = value + increment;
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(result)) throw new DeviceAuthUnavailableError("Refresh timestamp overflow.");
  return result;
}
function isRefreshToken(value: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(value); }
