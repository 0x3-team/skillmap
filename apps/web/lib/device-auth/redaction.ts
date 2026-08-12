/* DeviceAuth secret-redaction (M1.11). Server-side only. Never leaks tokens,
 * codes, proofs, private IDs, paths, or secret-derived values into errors,
 * logs, or evidence. Secret-bearing values are replaced with a fixed marker. */

const SECRET_MARKER = "[REDACTED]";

/** Fields that carry secret material on the DeviceAuth wire and must never be logged. */
const SECRET_FIELD = /^(device_code|user_code|exchange_code|idempotency_key|refresh_token|access_token|device_public_key|device_proof|proof|nonce)$/;

/** Fields that can expose local filesystem layout even when the value is short. */
function isPathField(key: string): boolean {
  return /(?:^|[_-])(?:path|file|filename)$/i.test(key) || /(?:Path|File|Filename)$/.test(key);
}

/** Absolute local paths and file URLs must not escape through unrecognized fields. */
function isPrivatePathValue(value: string): boolean {
  return value.startsWith("file://")
    || value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("\\\\");
}

/** Values that are themselves high-entropy secrets (43-char base64url, digests, etc.). */
function isSecretValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (isPrivatePathValue(value)) return true;
  if (/^[A-Za-z0-9_-]{22,43}$/.test(value)) return true;
  if (/^sha256:[0-9a-f]{64}$/.test(value)) return true;
  if (/^hmac-sha256:[0-9a-f]{64}$/.test(value)) return true;
  return false;
}

/** Return a redacted deep copy of any value, recursing into objects/arrays. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 10) return SECRET_MARKER;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_FIELD.test(key) || isPathField(key) ? SECRET_MARKER : redactSecrets(nested, depth + 1);
    }
    return out;
  }
  return isSecretValue(value) ? SECRET_MARKER : value;
}

/** Build a single safe structured log line from a candidate record, redacted. */
export function safeDeviceAuthLogLine(operation: string, outcome: string, metadata: Record<string, unknown>): string {
  const redacted = redactSecrets(metadata);
  return `device-auth op=${operation} result=${outcome} ${JSON.stringify(redacted)}`;
}
