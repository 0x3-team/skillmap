/* DeviceAuth v1 pairing-initiation service (server-only).
 *
 * Owns the deterministic orchestration: canonicalize scopes/display/locale,
 * verify the frozen P-256 proof suite and the key proof preimage, then
 * delegate to the repository which enforces idempotency/rate/nonce. First
 * secret-bearing responses carry no-store headers at the route layer. No
 * caller-supplied account identity is ever treated as authority.
 */

import "server-only";
import { DeviceAuthError } from "./errors.ts";
import type { DeviceAuthRepository } from "./repository.server.ts";
import {
  canonicalizeScopes,
  normalizeDisplayName,
  normalizeLocale,
  isValidSemVer,
  DEVICE_AUTH_AUDIENCE,
  DEVICE_AUTH_PROOF_SUITE_P256
} from "./contracts.ts";
import {
  isValidP256Spki,
  verifyDeviceProof,
  computeKeyThumbprint,
  isValidKeyThumbprint,
  buildIdempotencyDigest,
  isValidRequestDigest
} from "./crypto.server.ts";
import type { DeviceAuthProofSuiteV1 } from "./contracts.ts";

const PROOF_SUITE_P256: DeviceAuthProofSuiteV1 = DEVICE_AUTH_PROOF_SUITE_P256;
const AUDIENCE = DEVICE_AUTH_AUDIENCE;
const PROOF_PURPOSE_INITIATE = "initiate";

/** Max accepted clock skew between the server clock and the proof issued-at. */
const ISSUED_AT_MAX_SKEW_SECONDS = 60;
/** Server internal guard: issued-at must be a Unix-seconds integer string. */
const ISSUED_AT_GRAMMAR = /^[0-9]{1,20}$/;

export interface InitiateServiceInput {
  /** Exact origin-relative path, no query. */
  path: string;
  /** The configured hosted origin the proof was signed against. */
  configuredOrigin: string;
  /** Device id (22 base64url). */
  deviceId: string;
  devicePublicKey: string;
  /** Key thumbprint as supplied by the caller (header/body); rebound from SPKI below. */
  keyThumbprint: string;
  requestedScopes: string[];
  platform: "macos" | "windows" | "linux";
  connectorVersion: string;
  displayName?: string;
  locale?: string;
  /** Idempotency-Key header (22 base64url). */
  idempotencyKey: string;
  /** Proof fields from headers. */
  proofSuite: string;
  audience: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  bodySha256: string;
  signature: string;
  /** M3.02 header-parallel assertions reconciled against the body/SPKI. */
  deviceIdHeader: string;
  audienceHeader: string;
  proofPurposeHeader: string;
  proofSuiteHeader: string;
  /** The precomputed V2 idempotency request digest (never trusted from wire). */
  requestDigest: string;
}

export interface DeviceAuthInitiateResponseCon {
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

/** Build the exact V2 proof preimage (M1.08 P-256 amendment). */
export function buildInitiateProofPreimage(args: {
  suite: DeviceAuthProofSuiteV1;
  method: string;
  origin: string;
  path: string;
  audience: string;
  purpose: string;
  deviceId: string;
  thumbprint: string;
  bodySha256: string;
  idempotencyKey: string;
  nonce: string;
  issuedAt: string;
  accessTokenSha256: string;
}): string {
  const lines = [
    "SKILLMAP-DEVICE-PROOF-V2",
    args.suite,
    args.method.toUpperCase(),
    args.origin,
    args.path,
    args.audience,
    args.purpose,
    args.deviceId,
    args.thumbprint,
    args.bodySha256,
    args.idempotencyKey.length > 0 ? args.idempotencyKey : "NONE",
    args.nonce,
    args.issuedAt,
    args.accessTokenSha256,
    ""
  ];
  return lines.join("\n");
}

/**
 * Validate all bounds the schema cannot express, verify the P-256 proof, then
 * delegate to the repository. Throws DeviceAuthError on any failure.
 */
export async function initiatePairing(
  repository: DeviceAuthRepository,
  input: InitiateServiceInput
): Promise<DeviceAuthInitiateResponseCon> {
  const canonicalScopes = canonicalizeScopes(input.requestedScopes);
  if (!canonicalScopes) throw new DeviceAuthError("invalid_scope");

  if (!isValidSemVer(input.connectorVersion)) throw new DeviceAuthError("invalid_request");
  const displayName = normalizeDisplayName(input.displayName);
  const locale = normalizeLocale(input.locale);

  // Reject contradictory body/header audience and proof_suite before any state
  // lookup (M3.02 downgrade defense). The closed litmus is exact equality with
  // the frozen suite/audience, never a server-echoed body value becoming truth.
  if (input.proofSuite !== PROOF_SUITE_P256) throw new DeviceAuthError("invalid_client");
  if (input.audience !== AUDIENCE) throw new DeviceAuthError("invalid_client");
  if (input.proofPurpose !== PROOF_PURPOSE_INITIATE) throw new DeviceAuthError("invalid_client");
  // Header/body reconciliation (M3.02 Decision 1 downgrade defense): the
  // proof-suite header must equal both the body suite and the frozen suite, and
  // the audience header must equal the body audience. These proof headers are
  // REQUIRED (not optional): an absent/empty header is a client error rather
  // than one that is silently reconciled from the body. Each must be present
  // and, when present, equal the corresponding body truth.
  if (input.proofSuiteHeader === "" || input.proofSuiteHeader !== input.proofSuite) throw new DeviceAuthError("invalid_client");
  if (input.audienceHeader === "" || input.audienceHeader !== input.audience) throw new DeviceAuthError("invalid_client");
  if (input.proofPurposeHeader === "" || input.proofPurposeHeader !== input.proofPurpose) throw new DeviceAuthError("invalid_client");
  // Device-Id header is REQUIRED and must match the body device_id (bind the
  // channel to the proof).
  if (input.deviceIdHeader === "" || input.deviceIdHeader !== input.deviceId) throw new DeviceAuthError("invalid_request");
  if (input.keyThumbprint !== "" && !isValidKeyThumbprint(input.keyThumbprint)) throw new DeviceAuthError("invalid_request");

  if (!isValidP256Spki(input.devicePublicKey)) throw new DeviceAuthError("invalid_request");

  // Bind SPKI to the key_thumbprint: recompute the thumbprint from the exact
  // SPKI bytes and require it to match the caller's claim. The signature preimage
  // uses the recomputed value so a body/header that lies about the key cannot
  // pass and then be persisted under a different thumbprint.
  const recomputedThumbprint = computeKeyThumbprint(input.devicePublicKey);
  if (recomputedThumbprint === null) throw new DeviceAuthError("invalid_request");
  if (input.keyThumbprint !== recomputedThumbprint) throw new DeviceAuthError("invalid_request");

  if (!/^[A-Za-z0-9_-]{86}$/.test(input.signature)) throw new DeviceAuthError("proof_invalid");
  if (!/^[A-Za-z0-9_-]{22}$/.test(input.proofNonce)) throw new DeviceAuthError("invalid_request");

  // Strict issued-at: unsigned Unix-seconds grammar plus a bounded ±60s skew
  // window against the server clock (M1.08/M3.02 proof replay bound).
  if (!ISSUED_AT_GRAMMAR.test(input.issuedAt)) throw new DeviceAuthError("invalid_request");
  const issuedAtSeconds = Number(input.issuedAt);
  if (!Number.isSafeInteger(issuedAtSeconds)) throw new DeviceAuthError("invalid_request");
  const serverNow = Math.floor(Date.now() / 1000);
  if (Math.abs(serverNow - issuedAtSeconds) > ISSUED_AT_MAX_SKEW_SECONDS) throw new DeviceAuthError("invalid_request");

  const preimage = buildInitiateProofPreimage({
    suite: PROOF_SUITE_P256,
    method: "POST",
    origin: input.configuredOrigin,
    path: input.path,
    audience: AUDIENCE,
    purpose: PROOF_PURPOSE_INITIATE,
    deviceId: input.deviceId,
    thumbprint: recomputedThumbprint,
    bodySha256: input.bodySha256,
    idempotencyKey: input.idempotencyKey,
    nonce: input.proofNonce,
    issuedAt: input.issuedAt,
    accessTokenSha256: "NONE"
  });

  await verifyDeviceProof({
    suite: PROOF_SUITE_P256,
    devicePublicKey: input.devicePublicKey,
    signature: input.signature,
    preimage
  });

  // Compute the V2 idempotency request digest server-side (never accept one
  // from the wire) and require it to match the caller's claimed value, so a
  // same-key body substitution is always detected as idempotency_conflict.
  const computedRequestDigest = buildIdempotencyDigest({
    suite: PROOF_SUITE_P256,
    method: "POST",
    origin: input.configuredOrigin,
    path: input.path,
    audience: AUDIENCE,
    operation: "initiate",
    bodySha256: input.bodySha256,
    idempotencyKey: input.idempotencyKey
  });
  if (!isValidRequestDigest(input.requestDigest)) throw new DeviceAuthError("invalid_request");
  if (input.requestDigest !== computedRequestDigest) throw new DeviceAuthError("invalid_request");

  const created = await repository.initiatePairing({
    deviceId: input.deviceId,
    devicePublicKey: input.devicePublicKey,
    keyThumbprint: recomputedThumbprint,
    audience: AUDIENCE,
    proofSuite: PROOF_SUITE_P256,
    requestedScopes: canonicalScopes,
    displayName: displayName ?? undefined,
    platform: input.platform,
    connectorVersion: input.connectorVersion,
    locale: locale ?? undefined,
    verificationOrigin: input.configuredOrigin,
    expiresIn: 600,
    interval: 5,
    idempotencyKey: input.idempotencyKey,
    proofPurpose: PROOF_PURPOSE_INITIATE,
    proofNonce: input.proofNonce,
    issuedAt: input.issuedAt,
    bodySha256: input.bodySha256,
    requestDigest: computedRequestDigest
  });

  return {
    device_code: created.device_code,
    user_code: created.user_code,
    verification_uri: created.verification_uri,
    expires_in: created.expires_in,
    interval: created.interval,
    display: {
      name: created.display.name,
      platform: created.display.platform,
      connector_version: created.display.connector_version,
      locale: created.display.locale
    }
  };
}
