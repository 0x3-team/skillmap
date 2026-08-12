import { createHash, createPublicKey, verify } from 'node:crypto';

export const DEVICE_AUTH_SUITE_V2 = 'skillmap.ecdsa-p256-sha256.v2';
export const DEVICE_AUTH_AUDIENCE_V1 = 'skillmap.connector.v1';
export const DEVICE_AUTH_PROOF_LABEL_V2 = 'SKILLMAP-DEVICE-PROOF-V2';
export const DEVICE_AUTH_IDEMPOTENCY_LABEL_V2 = 'SKILLMAP-DEVICE-IDEMPOTENCY-V2';
/** The exact sentinel standing in for an access-token hash before any token exists. */
export const DEVICE_AUTH_ABSENT_ACCESS_TOKEN = 'NONE';

export const P256_SPKI_PREFIX_HEX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
export const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export type DeviceAuthProofPurpose =
  | 'initiate'
  | 'poll'
  | 'exchange'
  | 'refresh'
  | 'cancel'
  | 'rotate-old'
  | 'rotate-new'
  | 'revoke'
  | 'protected.route'
  | 'protected.feedback'
  | 'protected.import'
  | 'protected.bundle'
  | 'protected.status';

export type DeviceAuthErrorCode =
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_grant'
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_client'
  | 'invalid_token'
  | 'proof_required'
  | 'proof_invalid'
  | 'insufficient_scope'
  | 'already_consumed'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'secure_storage_unavailable'
  | 'temporarily_unavailable';

export const DEVICE_AUTH_ERROR_DESCRIPTIONS: Record<DeviceAuthErrorCode, string> = {
  invalid_request: 'The request is invalid.',
  invalid_scope: 'The requested scope is invalid.',
  invalid_grant: 'The authorization grant is invalid.',
  authorization_pending: 'Authorization is pending.',
  slow_down: 'Polling must slow down.',
  access_denied: 'Authorization was not granted.',
  expired_token: 'The authorization grant has expired.',
  invalid_client: 'Client authentication failed.',
  invalid_token: 'The access token is invalid.',
  proof_required: 'Device proof is required.',
  proof_invalid: 'Device proof is invalid.',
  insufficient_scope: 'The token does not permit this operation.',
  already_consumed: 'The authorization grant is no longer available.',
  idempotency_conflict: 'The request conflicts with a prior operation.',
  rate_limited: 'Too many requests.',
  secure_storage_unavailable: 'Secure credential storage is unavailable.',
  temporarily_unavailable: 'The service is temporarily unavailable.'
};

export interface InitiatePairingRequest {
  device_id: string;
  device_public_key: string;
  key_thumbprint: string;
  audience: typeof DEVICE_AUTH_AUDIENCE_V1;
  proof_suite: typeof DEVICE_AUTH_SUITE_V2;
  requested_scopes: string[];
  display_name?: string;
  platform: 'macos' | 'windows' | 'linux';
  connector_version: string;
  locale?: string;
}
export interface InitiatePairingResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  display: {
    name?: string;
    platform: string;
    connector_version: string;
  };
}

export interface PollPairingRequest {
  device_code: string;
  device_id: string;
  audience: typeof DEVICE_AUTH_AUDIENCE_V1;
}

export interface PollPairingSuccess {
  exchange_code: string;
  expires_in: number;
  scopes: string[];
}

export interface PollPairingPending {
  error: 'authorization_pending' | 'slow_down';
  error_description: string;
  retry_after: number;
}

export interface PollPairingError {
  error: DeviceAuthErrorCode;
  error_description: string;
  retry_after?: number;
}

export type PollPairingResponse = PollPairingSuccess | PollPairingPending | PollPairingError;

export interface ExchangeCodeRequest {
  exchange_code: string;
  device_id: string;
  device_public_key_thumbprint: string;
  audience: typeof DEVICE_AUTH_AUDIENCE_V1;
  requested_scopes: string[];
}

export interface ExchangeCodeResponse {
  device_public_id: string;
  account_public_id: string;
  token_family_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_idle_expires_in: number;
  refresh_absolute_expires_in: number;
}

export interface RefreshTokenRequest {
  refresh_token: string;
  device_id: string;
  audience: typeof DEVICE_AUTH_AUDIENCE_V1;
  token_family_id: string;
}

export type RefreshTokenResponse = ExchangeCodeResponse;

export interface CancelPairingRequest {
  device_code: string;
  device_id: string;
  audience: typeof DEVICE_AUTH_AUDIENCE_V1;
  reason: 'user_cancelled' | 'timeout' | 'local_shutdown';
}

export interface CancelPairingResponse {
  status: 'cancelled';
}

export interface RevokeDeviceRequest {
  reason: 'user_offboarded' | 'suspected_compromise' | 'account_disabled' | 'owner_requested' | 'operator_incident';
}

export interface RevokeDeviceResponse {
  status: 'revoked';
  device_public_id: string;
}

export interface StatusResponse {
  device_public_id: string;
  account_public_id: string;
  state: string;
  scopes: string[];
  expires_at: number;
  key_thumbprint: string;
  rotation_lineage_digest?: string;
  revocation_receipt_digest?: string;
}

export interface AuthenticateTokenResponse {
  active: boolean;
  device_public_id: string;
  account_public_id: string;
  scopes: string[];
  audience: string;
  expires_at: number;
}

// Wire/Crypto Utility Functions

export function toBase64Url(buffer: Uint8Array | Buffer): string {
  return Buffer.from(buffer).toString('base64url');
}

export function fromBase64Url(str: string): Uint8Array {
  return Buffer.from(str, 'base64url');
}

export function computeSha256(data: string | Uint8Array): string {
  const hash = createHash('sha256').update(data).digest('hex');
  return `sha256:${hash}`;
}

export function computeSpkiThumbprint(spkiBytes: Uint8Array): string {
  return computeSha256(spkiBytes);
}

export function assertExactSpki(spki: Uint8Array): void {
  if (spki.length !== 91) {
    throw new Error(`Invalid SPKI length: expected 91, got ${spki.length}`);
  }
  const prefixHex = Buffer.from(spki.subarray(0, 26)).toString('hex');
  if (prefixHex !== P256_SPKI_PREFIX_HEX) {
    throw new Error(`Invalid P-256 SPKI prefix: expected ${P256_SPKI_PREFIX_HEX}, got ${prefixHex}`);
  }
  if (spki[26] !== 0x04) {
    throw new Error(`Invalid uncompressed point header: expected 0x04, got 0x${spki[26].toString(16)}`);
  }
}

export function assertValidP1363(signature: Uint8Array): void {
  if (signature.length !== 64) {
    throw new Error(`Invalid IEEE P1363 signature length: expected 64, got ${signature.length}`);
  }
  const rHex = Buffer.from(signature.subarray(0, 32)).toString('hex');
  const sHex = Buffer.from(signature.subarray(32, 64)).toString('hex');
  const r = BigInt(`0x${rHex}`);
  const s = BigInt(`0x${sHex}`);
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) {
    throw new Error('IEEE P1363 signature scalar r or s out of range [1, n-1]');
  }
}

export function p1363ToDer(p1363: Uint8Array): Uint8Array {
  assertValidP1363(p1363);
  const encodeInteger = (value: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start += 1;
    }
    let integer = value.subarray(start);
    if (integer[0] & 0x80) {
      integer = Buffer.concat([Buffer.from([0]), integer]);
    }
    return Buffer.concat([Buffer.from([0x02, integer.length]), integer]);
  };
  const rDer = encodeInteger(p1363.subarray(0, 32));
  const sDer = encodeInteger(p1363.subarray(32, 64));
  const body = Buffer.concat([rDer, sDer]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function readDerLength(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset++];
  if (first < 0x80) return [first, offset];
  const count = first & 0x7f;
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    length = length * 256 + bytes[offset++];
  }
  return [length, offset];
}

export function derToP1363(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER sequence start');
  const [sequenceLength, sequenceStart] = readDerLength(der, offset);
  offset = sequenceStart;
  if (sequenceStart + sequenceLength !== der.length) throw new Error('DER sequence length mismatch');
  if (der[offset++] !== 0x02) throw new Error('Invalid DER integer header for r');
  const [rLength, rStart] = readDerLength(der, offset);
  const r = der.subarray(rStart, rStart + rLength);
  offset = rStart + rLength;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER integer header for s');
  const [sLength, sStart] = readDerLength(der, offset);
  const s = der.subarray(sStart, sStart + sLength);

  const result = Buffer.alloc(64);
  const normalizedR = r[0] === 0 ? r.subarray(1) : r;
  const normalizedS = s[0] === 0 ? s.subarray(1) : s;
  result.set(normalizedR, 32 - normalizedR.length);
  result.set(normalizedS, 64 - normalizedS.length);
  assertValidP1363(result);
  return result;
}

export function verifyP256ProofSignature(
  preimageUtf8: string,
  spkiBytes: Uint8Array,
  p1363Signature: Uint8Array
): boolean {
  try {
    assertExactSpki(spkiBytes);
    assertValidP1363(p1363Signature);
    const publicKey = createPublicKey({ key: Buffer.from(spkiBytes), format: 'der', type: 'spki' });
    const derSignature = p1363ToDer(p1363Signature);
    return verify('sha256', Buffer.from(preimageUtf8, 'utf8'), publicKey, derSignature);
  } catch {
    return false;
  }
}

export function buildProofPreimageV2(params: {
  suite?: string;
  method: string;
  origin: string;
  path: string;
  audience?: string;
  purpose: DeviceAuthProofPurpose;
  deviceId: string;
  thumbprint: string;
  bodySha256: string;
  idempotencyKey?: string;
  nonce: string;
  issuedAt: number;
  accessTokenSha256?: string;
}): string {
  const suite = params.suite ?? DEVICE_AUTH_SUITE_V2;
  const method = params.method.toUpperCase();
  const origin = params.origin;
  const path = params.path;
  const audience = params.audience ?? DEVICE_AUTH_AUDIENCE_V1;
  const purpose = params.purpose;
  const deviceId = params.deviceId;
  const thumbprint = params.thumbprint;
  const bodySha256 = params.bodySha256;
  const idempotencyKey = params.idempotencyKey ?? 'NONE';
  const nonce = params.nonce;
  const issuedAt = String(params.issuedAt);
  const accessTokenSha256 = params.accessTokenSha256 ?? DEVICE_AUTH_ABSENT_ACCESS_TOKEN;

  return [
    DEVICE_AUTH_PROOF_LABEL_V2,
    suite,
    method,
    origin,
    path,
    audience,
    purpose,
    deviceId,
    thumbprint,
    bodySha256,
    idempotencyKey,
    nonce,
    issuedAt,
    accessTokenSha256,
    ''
  ].join('\n');
}

export function buildIdempotencyPreimageV2(params: {
  suite?: string;
  method: string;
  origin: string;
  path: string;
  audience?: string;
  operation: string;
  bodySha256: string;
  idempotencyKey: string;
}): string {
  const suite = params.suite ?? DEVICE_AUTH_SUITE_V2;
  const method = params.method.toUpperCase();
  const origin = params.origin;
  const path = params.path;
  const audience = params.audience ?? DEVICE_AUTH_AUDIENCE_V1;
  const operation = params.operation;
  const bodySha256 = params.bodySha256;
  const idempotencyKey = params.idempotencyKey;

  return [
    DEVICE_AUTH_IDEMPOTENCY_LABEL_V2,
    suite,
    method,
    origin,
    path,
    audience,
    operation,
    bodySha256,
    idempotencyKey,
    ''
  ].join('\n');
}

export function normalizeAndValidateOrigin(originInput: string): string {
  if (typeof originInput !== 'string' || !originInput.trim()) {
    throw new Error('Origin must be a non-empty string');
  }

  let url: URL;
  try {
    url = new URL(originInput);
  } catch {
    throw new Error(`Invalid origin URL: ${originInput}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid origin protocol '${url.protocol}': must be http: or https:`);
  }

  if (url.username || url.password) {
    throw new Error('Origin must not contain credentials');
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`Origin must not contain path: '${url.pathname}'`);
  }

  if (url.search) {
    throw new Error('Origin must not contain query parameters');
  }

  if (url.hash) {
    throw new Error('Origin must not contain fragment identifier');
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.local');

    if (!isLocal) {
      throw new Error(`HTTP origin '${originInput}' is rejected: non-local HTTP origins forbidden; HTTPS required`);
    }
  }

  return url.origin;
}
