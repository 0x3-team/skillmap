/* DeviceAuth v1 server-side crypto primitives (server-only).
 *
 * - device_code: 256 random bits, base64url, 43 ASCII (M1.08)
 * - user_code: 50 random bits in 10 Crockford Base32 chars, displayed XXXXX-XXXXX
 * - public-key proof verification supports the frozen P-256 suite
 *   skillmap.ecdsa-p256-sha256.v2 (SPKI + P1363) and the accepted Ed25519 v1
 *   suite skillmap.ed25519.v1 for parity and negative-based rejection control.
 *
 * Reply authority for initiation is the closed nonce/idempotency contract; the
 * proof is a defense-in-depth seam that runs before any state read. All random
 * values use Web Crypto CSPRNG. Node's crypto is used only for synchronous
 * body/request-hash computation.
 */

import "server-only";
import { createHash } from "node:crypto";
import type { DeviceAuthProofSuiteV1 } from "./contracts.ts";
import { DeviceAuthError } from "./errors.ts";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function toB64(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return toB64(bytes);
}

export function base64UrlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const len = b64.length;
  const padLen = (4 - (len % 4)) % 4;
  if (padLen === 3) throw new Error("invalid base64url length");
  const padded = b64 + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 256 random bits formatted as a 43-char unpadded base64url secret (device_code). */
export async function generateSecret43(): Promise<string> {
  const rnd = new Uint8Array(32);
  crypto.getRandomValues(rnd);
  return base64UrlEncode(rnd);
}

/** 50 random bits formatted as 10 Crockford base32 characters. */
export function generateUserCode(): string {
  const rnd = new Uint8Array(7);
  crypto.getRandomValues(rnd);
  let bits = 0;
  let bitCount = 0;
  let out = "";
  let consumed = 0;
  while (out.length < 10) {
    if (bitCount < 5) {
      bits = (bits << 8) | rnd[consumed++];
      bitCount += 8;
    }
    const index = (bits >> (bitCount - 5)) & 31;
    bitCount -= 5;
    out += CROCKFORD_ALPHABET[index];
  }
  return out;
}

/** Format 10 Crockford chars as XXXXX-XXXXX. */
export function formatUserCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

/** Canonicalize case-insensitive user_code input per Crockford (allows 0/O, 1/I/L). */
export function normalizeUserCodeInput(raw: string): string {
  const candidate = raw
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z-]/g, "")
    .replace(/-/g, "");
  return candidate;
}

function hexFromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Synchronous sha256:<hex> digest over exact bytes (Node server path). */
export function sha256Digest(bytes: Uint8Array | string): string {
  const source = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = createHash("sha256").update(Buffer.from(source)).digest();
  return `sha256:${hexFromBytes(new Uint8Array(digest))}`;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return sha256Digest(bytes).slice("sha256:".length);
}

/**
 * Compute the M1.08/M3.02 key thumbprint for a P-256 device public key:
 * lowercase `sha256:<64 hex>` over the exact DER SPKI bytes. Only called after
 * the SPKI has passed isValidP256Spki (which guarantees the canonical 91-byte
 * uncompressed DER form), so base64UrlDecode never throws here.
 */
export function computeKeyThumbprint(base64urlPublicKey: string): string | null {
  if (!isValidP256Spki(base64urlPublicKey)) return null;
  return sha256Digest(base64UrlDecode(base64urlPublicKey));
}

/** Enforce an exact lowercase `sha256:<64 hex>` thumbprint form. */
export function isValidKeyThumbprint(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

/**
 * Compute the M1.08/M3.02 V2 idempotency request digest: SHA-256 over the
 * exact nine-line preimage (plus a final LF). Used as the idempotency twin key
 * so a changed body/digest for the same Idempotency-Key is always
 * `idempotency_conflict`, never a silent replay (M1.08 contract).
 */
export function buildIdempotencyDigest(args: {
  suite: string;
  method: string;
  origin: string;
  path: string;
  audience: string;
  operation: string;
  bodySha256: string;
  idempotencyKey: string;
}): string {
  const preimage = [
    "SKILLMAP-DEVICE-IDEMPOTENCY-V2",
    args.suite,
    args.method,
    args.origin,
    args.path,
    args.audience,
    args.operation,
    args.bodySha256,
    args.idempotencyKey
  ].join("\n") + "\n";
  return sha256Digest(preimage);
}

/** Enforce the exact lowercase `sha256:<hex>` request-digest form. */
export function isValidRequestDigest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

/** The documented empty-body hash from M1.08. */
export const EMPTY_BODY_SHA256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const P256_SPKI_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

export function isValidP256Spki(value: string): boolean {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9_-]{122}$/.test(value)) return false;
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(value);
  } catch {
    return false;
  }
  if (bytes.length !== 91) return false;
  const prefix = Uint8Array.from([0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00]);
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  // Require the uncompressed point tag 0x04 at offset 26.
  if (bytes[26] !== 0x04) return false;
  return true;
}

export interface VerifyDeviceRequest {
  suite: DeviceAuthProofSuiteV1;
  /** base64url public key: P256 SPKI for v2, raw key for ed25519-v1. */
  devicePublicKey: string;
  /** base64url signature: P1363 (64) for v2, raw (64) for v1. */
  signature: string;
  /** exact proof preimage UTF-8 string (already constructed by caller). */
  preimage: string;
}

/** Verify a DeviceAuth proof under the agreed suite. Throws proof_invalid. */
export async function verifyDeviceProof(request: VerifyDeviceRequest): Promise<void> {
  if (request.suite === "skillmap.ecdsa-p256-sha256.v2") {
    const ok = await verifyP256(request.devicePublicKey, request.signature, request.preimage);
    if (!ok) throw new DeviceAuthError("proof_invalid");
    return;
  }
  if (request.suite === "skillmap.ed25519.v1") {
    const ok = await verifyEd25519(request.devicePublicKey, request.signature, request.preimage);
    if (!ok) throw new DeviceAuthError("proof_invalid");
    return;
  }
  throw new DeviceAuthError("proof_invalid");
}

async function verifyP256(publicKey: string, signature: string, preimage: string): Promise<boolean> {
  if (!isValidP256Spki(publicKey)) return false;
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try {
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey("spki", toArrayBuffer(base64UrlDecode(publicKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    } catch {
      return false;
    }
    const sig = base64UrlDecode(signature);
    if (sig.length !== 64) return false;
    const data = toArrayBuffer(new TextEncoder().encode(preimage));
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, toArrayBuffer(sig), data);
  } catch {
    return false;
  }
}

/** Convert a Uint8Array to a plain ArrayBuffer (Node/Edge BufferSource typing). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function verifyEd25519(publicKey: string, signature: string, preimage: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(publicKey)) return false;
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", toArrayBuffer(base64UrlDecode(publicKey)), "Ed25519", false, ["verify"]);
    const data = toArrayBuffer(new TextEncoder().encode(preimage));
    return await crypto.subtle.verify("Ed25519", key, toArrayBuffer(base64UrlDecode(signature)), data);
  } catch {
    return false;
  }
}

/** For suite negotiation in later milestones: the frozen v1 suite is never advertised. */
export const DEVICE_AUTH_SUPPORTED_PROOF_SUITES: DeviceAuthProofSuiteV1[] = [
  "skillmap.ecdsa-p256-sha256.v2"
];