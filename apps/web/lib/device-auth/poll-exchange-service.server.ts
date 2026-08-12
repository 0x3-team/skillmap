import "server-only";

import { DeviceAuthError } from "./errors.ts";
import { buildIdempotencyDigest, isValidRequestDigest, sha256Digest, verifyDeviceProof, isValidP256Spki, computeKeyThumbprint } from "./crypto.server.ts";
import { canonicalizeScopes, DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "./contracts.ts";
import { createDeviceAuthTokenCrypto, type DeviceAuthTokenCrypto } from "./poll-exchange-crypto.server.ts";
import type {
  DeviceAuthExchangeRepository,
  DeviceAuthExchangeRepositoryInput,
  DeviceAuthPollRepository,
  DeviceAuthPollRepositoryInput,
  DeviceAuthProofKey
} from "./poll-exchange-repository.server.ts";
import { EXCHANGE_PATH, POLL_PATH, type ExchangePairingRequestV1, type ExchangePairingSuccessV1, type PollPairingRequestV1, type PollPairingSuccessV1 } from "./poll-exchange-contracts.server.ts";
import { buildInitiateProofPreimage } from "./service.server.ts";

const ISSUED_AT = /^[0-9]{1,20}$/;
const ID = /^[A-Za-z0-9_-]{22}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;

export interface ProofEnvelope {
  configuredOrigin: string;
  path: string;
  proofSuite: string;
  audience: string;
  purpose: string;
  proofNonce: string;
  issuedAt: string;
  bodySha256: string;
  signature: string;
  proofSuiteHeader: string;
  audienceHeader: string;
  purposeHeader: string;
  deviceIdHeader: string;
  idempotencyKey: string;
}

export function validateProofEnvelope(envelope: ProofEnvelope): void {
  if (envelope.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || envelope.proofSuiteHeader !== envelope.proofSuite) throw new DeviceAuthError("invalid_client");
  if (envelope.audience !== DEVICE_AUTH_AUDIENCE || envelope.audienceHeader !== envelope.audience) throw new DeviceAuthError("invalid_client");
  if (envelope.purposeHeader !== envelope.purpose || envelope.purposeHeader === "") throw new DeviceAuthError("invalid_client");
  if (!ID.test(envelope.deviceIdHeader) || !ID.test(envelope.proofNonce)) throw new DeviceAuthError("invalid_request");
  if (!ISSUED_AT.test(envelope.issuedAt) || !Number.isSafeInteger(Number(envelope.issuedAt))) throw new DeviceAuthError("invalid_request");
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(envelope.issuedAt)) > 60) throw new DeviceAuthError("invalid_request");
  if (!/^sha256:[0-9a-f]{64}$/.test(envelope.bodySha256) || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) throw new DeviceAuthError("proof_invalid");
  if (!ID.test(envelope.idempotencyKey)) throw new DeviceAuthError("invalid_request");
}

async function verifyPollExchangeProof(proof: ProofEnvelope, key: DeviceAuthProofKey, expectedPath: string, expectedPurpose: "poll" | "exchange", deviceId: string): Promise<void> {
  if (proof.path !== expectedPath || proof.purpose !== expectedPurpose || proof.deviceIdHeader !== deviceId) throw new DeviceAuthError("proof_invalid");
  if (key.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || !isValidP256Spki(key.publicKey)) throw new DeviceAuthError("proof_invalid");
  const thumbprint = computeKeyThumbprint(key.publicKey);
  if (thumbprint === null || thumbprint !== key.keyThumbprint) throw new DeviceAuthError("proof_invalid");
  const preimage = buildInitiateProofPreimage({
    suite: DEVICE_AUTH_PROOF_SUITE_P256,
    method: "POST",
    origin: proof.configuredOrigin,
    path: expectedPath,
    audience: DEVICE_AUTH_AUDIENCE,
    purpose: expectedPurpose,
    deviceId,
    thumbprint,
    bodySha256: proof.bodySha256,
    idempotencyKey: proof.idempotencyKey,
    nonce: proof.proofNonce,
    issuedAt: proof.issuedAt,
    accessTokenSha256: "NONE"
  });
  await verifyDeviceProof({ suite: DEVICE_AUTH_PROOF_SUITE_P256, devicePublicKey: key.publicKey, signature: proof.signature, preimage });
}

export function pollPairing(
  repository: DeviceAuthPollRepository,
  input: PollPairingRequestV1,
  proof: ProofEnvelope,
  proofKey: DeviceAuthProofKey
): Promise<PollPairingSuccessV1> {
  if (!CODE.test(input.device_code) || !ID.test(input.device_id) || input.audience !== DEVICE_AUTH_AUDIENCE) throw new DeviceAuthError("invalid_request");
  validateProofEnvelope(proof);
  return verifyPollExchangeProof(proof, proofKey, POLL_PATH, "poll", input.device_id).then(() => {
  const requestDigest = buildIdempotencyDigest({
    suite: DEVICE_AUTH_PROOF_SUITE_P256, method: "POST", origin: proof.configuredOrigin,
    path: proof.path, audience: DEVICE_AUTH_AUDIENCE, operation: "poll",
    bodySha256: proof.bodySha256, idempotencyKey: proof.idempotencyKey
  });
  if (!isValidRequestDigest(requestDigest)) throw new DeviceAuthError("invalid_request");
  const repositoryInput: DeviceAuthPollRepositoryInput = {
    deviceCodeDigest: sha256Digest(input.device_code).slice("sha256:".length),
    deviceId: input.device_id,
    audience: DEVICE_AUTH_AUDIENCE,
    proofSuite: DEVICE_AUTH_PROOF_SUITE_P256,
    proofPurpose: "poll",
    proofNonce: proof.proofNonce,
    issuedAt: proof.issuedAt,
    requestDigest,
    idempotencyKey: proof.idempotencyKey
  };
    return repository.pollPairing(repositoryInput);
  });
}

export async function exchangePairing(
  repository: DeviceAuthExchangeRepository,
  input: ExchangePairingRequestV1,
  proof: ProofEnvelope,
  tokenCrypto: DeviceAuthTokenCrypto,
  proofKey: DeviceAuthProofKey
): Promise<ExchangePairingSuccessV1> {
  if (!CODE.test(input.exchange_code) || !ID.test(input.device_id) || input.audience !== DEVICE_AUTH_AUDIENCE) throw new DeviceAuthError("invalid_request");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.device_public_key_thumbprint)) throw new DeviceAuthError("invalid_request");
  const scopes = canonicalizeScopes(input.requested_scopes);
  if (!scopes) throw new DeviceAuthError("invalid_scope");
  validateProofEnvelope(proof);
  if (proofKey.keyThumbprint !== input.device_public_key_thumbprint) throw new DeviceAuthError("invalid_grant");
  await verifyPollExchangeProof(proof, proofKey, EXCHANGE_PATH, "exchange", input.device_id);
  const requestDigest = buildIdempotencyDigest({
    suite: DEVICE_AUTH_PROOF_SUITE_P256, method: "POST", origin: proof.configuredOrigin,
    path: proof.path, audience: DEVICE_AUTH_AUDIENCE, operation: "exchange",
    bodySha256: proof.bodySha256, idempotencyKey: proof.idempotencyKey
  });
  const [accessToken, refreshToken] = await Promise.all([tokenCrypto.generateToken(), tokenCrypto.generateToken()]);
  if (!CODE.test(accessToken) || !CODE.test(refreshToken) || accessToken === refreshToken) throw new DeviceAuthError("temporarily_unavailable");
  const repositoryInput: DeviceAuthExchangeRepositoryInput = {
    exchangeCodeDigest: sha256Digest(input.exchange_code).slice("sha256:".length),
    deviceId: input.device_id,
    keyThumbprint: input.device_public_key_thumbprint,
    audience: DEVICE_AUTH_AUDIENCE,
    requestedScopes: scopes,
    proofSuite: DEVICE_AUTH_PROOF_SUITE_P256,
    proofPurpose: "exchange",
    proofNonce: proof.proofNonce,
    issuedAt: proof.issuedAt,
    requestDigest,
    idempotencyKey: proof.idempotencyKey,
    accessTokenDigest: tokenCrypto.digest("access-token", accessToken),
    accessTokenKeyVersion: tokenCrypto.keyVersion,
    refreshTokenDigest: tokenCrypto.digest("refresh-token", refreshToken),
    refreshTokenKeyVersion: tokenCrypto.keyVersion
  };
  const committed = await repository.exchangePairing(repositoryInput);
  return { ...committed, access_token: accessToken, refresh_token: refreshToken };
}

export { createDeviceAuthTokenCrypto };
