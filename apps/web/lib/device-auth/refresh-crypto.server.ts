import "server-only";

import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { base64UrlDecode, base64UrlEncode, sha256Digest } from "./crypto.server.ts";
import { DeviceAuthUnavailableError } from "./errors.ts";
import { REFRESH_RESPONSE_VERSION, type RefreshTokenResponseV1 } from "./refresh-contracts.server.ts";

export const REPLAY_EPOCH_SECONDS = 300;
export const REPLAY_LOGICAL_SECONDS = 600;
export const REPLAY_PURGE_SECONDS = 900;
export const REPLAY_MAX_CIPHERTEXT_BYTES = 2048;
export const REPLAY_KEY_BYTES = 32;
export const REPLAY_NONCE_BYTES = 12;

export interface ReplayKeyProvider {
  get(epochId: number): Promise<Uint8Array | null>;
}

/** Production deliberately has no implicit key source. Feature-off is safer than a guessed key. */
export class UnavailableReplayKeyProvider implements ReplayKeyProvider {
  async get(epochId: number): Promise<Uint8Array | null> {
    void epochId;
    throw new DeviceAuthUnavailableError("Replay key provider is unavailable.");
  }
}

export interface RefreshLookupCrypto {
  readonly keyVersion: number;
  generateToken(): Promise<string>;
  digest(purpose: "access-token" | "refresh-token" | "idempotency-key", value: string): string;
}

export function createRefreshLookupCrypto(args: {
  key: Uint8Array;
  keyVersion: number;
  randomBytes?: (length: number) => Uint8Array;
}): RefreshLookupCrypto {
  if (!(args.key instanceof Uint8Array) || args.key.byteLength !== 32 || !Number.isSafeInteger(args.keyVersion) || args.keyVersion < 1) {
    throw new Error("invalid device-auth lookup key configuration");
  }
  const random = args.randomBytes ?? ((length: number) => new Uint8Array(nodeRandomBytes(length)));
  return {
    keyVersion: args.keyVersion,
    async generateToken() { return base64UrlEncode(random(32)); },
    digest(purpose, value) {
      return `hmac-sha256:${createHmac("sha256", Buffer.from(args.key)).update(`SKILLMAP-DEVICE-AUTH-HMAC-V1\n${purpose}\n${value}\n`, "utf8").digest("hex")}`;
    }
  };
}

export function refreshLookupCryptoFromEnvironment(environment: Record<string, string | undefined> = process.env): RefreshLookupCrypto {
  const encoded = (environment.DEVICE_AUTH_LOOKUP_KEY ?? "").trim();
  const keyVersion = Number((environment.DEVICE_AUTH_LOOKUP_KEY_VERSION ?? "").trim());
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded) || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new DeviceAuthUnavailableError("DeviceAuth lookup key is unavailable.");
  }
  try {
    const key = base64UrlDecode(encoded);
    if (key.byteLength !== 32) throw new Error("wrong key length");
    return createRefreshLookupCrypto({ key, keyVersion });
  } catch {
    throw new DeviceAuthUnavailableError("DeviceAuth lookup key is unavailable.");
  }
}

export function replayEpochId(responseIssuedAt: number): number {
  if (!Number.isSafeInteger(responseIssuedAt) || responseIssuedAt < 0) throw new Error("invalid response_issued_at");
  return Math.floor(responseIssuedAt / REPLAY_EPOCH_SECONDS);
}

export function buildRefreshReplayAadV1(args: {
  proofSuite: string;
  devicePublicId: string;
  tokenFamilyId: string;
  idempotencyKeyDigest: string;
  requestDigest: string;
  priorGeneration: number;
  successorGeneration: number;
  responseIssuedAt: number;
  replayUntil: number;
  responseFormatVersion?: string;
  bodyDigest: string;
  bodyLength: number;
}): Uint8Array {
  const text = [
    "SKILLMAP-REFRESH-REPLAY-AAD-V1", "skillmap.connector.v1", args.proofSuite,
    args.devicePublicId, args.tokenFamilyId, args.idempotencyKeyDigest, args.requestDigest,
    String(args.priorGeneration), String(args.successorGeneration), String(args.responseIssuedAt),
    String(args.replayUntil), args.responseFormatVersion ?? REFRESH_RESPONSE_VERSION,
    args.bodyDigest, String(args.bodyLength)
  ].join("\n") + "\n";
  return new TextEncoder().encode(text);
}

/** Fixed member order and compact UTF-8 are part of the replay authority. */
export function encodeRefreshSuccessV1(value: RefreshTokenResponseV1): Uint8Array {
  const body = `{"device_public_id":${JSON.stringify(value.device_public_id)},"account_public_id":${JSON.stringify(value.account_public_id)},"token_family_id":${JSON.stringify(value.token_family_id)},"access_token":${JSON.stringify(value.access_token)},"refresh_token":${JSON.stringify(value.refresh_token)},"expires_in":${value.expires_in},"refresh_idle_expires_in":${value.refresh_idle_expires_in},"refresh_absolute_expires_in":${value.refresh_absolute_expires_in}}`;
  return new TextEncoder().encode(body);
}

export interface SealedRefreshResponse {
  replayKeyVersion: number;
  nonce: string;
  ciphertext: string;
  bodyDigest: string;
  bodyLength: number;
  responseIssuedAt: number;
  replayUntil: number;
  runtimePurgeAfter: number;
  responseFormatVersion: string;
}

export async function sealRefreshResponseV1(args: {
  provider: ReplayKeyProvider;
  replayKeyVersion: number;
  responseIssuedAt: number;
  replayUntil: number;
  runtimePurgeAfter: number;
  aad: Uint8Array;
  body: Uint8Array;
  nonce?: Uint8Array;
  randomBytes?: (length: number) => Uint8Array;
  responseFormatVersion?: string;
}): Promise<SealedRefreshResponse> {
  if (!Number.isSafeInteger(args.replayKeyVersion) || args.replayKeyVersion < 1) throw new Error("invalid replay key version");
  if (args.body.byteLength > REPLAY_MAX_CIPHERTEXT_BYTES - 16) throw new Error("refresh replay body too large");
  const key = await args.provider.get(args.replayKeyVersion);
  if (!key || key.byteLength !== REPLAY_KEY_BYTES) throw new DeviceAuthUnavailableError("Replay key provider is unavailable.");
  const nonce = args.nonce ?? (args.randomBytes ?? ((length: number) => new Uint8Array(nodeRandomBytes(length))))(REPLAY_NONCE_BYTES);
  if (nonce.byteLength !== REPLAY_NONCE_BYTES) throw new Error("invalid replay nonce");
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(args.aad), tagLength: 128 }, await importAesKey(key), toArrayBuffer(args.body));
  const ciphertext = new Uint8Array(cipher);
  if (ciphertext.byteLength > REPLAY_MAX_CIPHERTEXT_BYTES) throw new Error("refresh replay ciphertext too large");
  return {
    replayKeyVersion: args.replayKeyVersion, nonce: base64UrlEncode(nonce), ciphertext: base64UrlEncode(ciphertext),
    bodyDigest: sha256Digest(args.body), bodyLength: args.body.byteLength,
    responseIssuedAt: args.responseIssuedAt, replayUntil: args.replayUntil, runtimePurgeAfter: args.runtimePurgeAfter,
    responseFormatVersion: args.responseFormatVersion ?? REFRESH_RESPONSE_VERSION
  };
}

export async function openRefreshResponseV1(args: {
  provider: ReplayKeyProvider;
  sealed: SealedRefreshResponse;
  aad: Uint8Array;
  now?: number;
}): Promise<Uint8Array> {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < args.sealed.responseIssuedAt || now >= args.sealed.replayUntil || now >= args.sealed.runtimePurgeAfter) throw new DeviceAuthUnavailableError("Refresh replay expired.");
  if (args.sealed.responseIssuedAt + REPLAY_LOGICAL_SECONDS !== args.sealed.replayUntil || args.sealed.responseIssuedAt + REPLAY_PURGE_SECONDS !== args.sealed.runtimePurgeAfter) throw new DeviceAuthUnavailableError("Refresh replay metadata invalid.");
  const key = await args.provider.get(args.sealed.replayKeyVersion);
  if (!key || key.byteLength !== REPLAY_KEY_BYTES) throw new DeviceAuthUnavailableError("Replay key provider is unavailable.");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(args.sealed.nonce)), additionalData: toArrayBuffer(args.aad), tagLength: 128 }, await importAesKey(key), toArrayBuffer(base64UrlDecode(args.sealed.ciphertext)));
  } catch {
    throw new DeviceAuthUnavailableError("Refresh replay authentication failed.");
  }
  const body = new Uint8Array(plaintext);
  if (body.byteLength !== args.sealed.bodyLength || sha256Digest(body) !== args.sealed.bodyDigest) throw new DeviceAuthUnavailableError("Refresh replay integrity failed.");
  return body;
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
