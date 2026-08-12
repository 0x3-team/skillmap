import "server-only";

import { createHmac } from "node:crypto";
import { base64UrlEncode } from "./crypto.server.ts";

export interface DeviceAuthTokenCrypto {
  generateToken(): Promise<string>;
  digest(purpose: "access-token" | "refresh-token", token: string): string;
  keyVersion: number;
}

/** A testable crypto seam. Raw tokens are returned only to the caller and are never sent to SQL. */
export function createDeviceAuthTokenCrypto(args: {
  key: Uint8Array;
  keyVersion: number;
  randomBytes?: (length: number) => Uint8Array;
}): DeviceAuthTokenCrypto {
  if (!(args.key instanceof Uint8Array) || args.key.byteLength !== 32 || !Number.isSafeInteger(args.keyVersion) || args.keyVersion < 1) {
    throw new Error("invalid device-auth lookup key configuration");
  }
  const randomBytes = args.randomBytes ?? ((length: number) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  });
  return {
    keyVersion: args.keyVersion,
    async generateToken() {
      return base64UrlEncode(randomBytes(32));
    },
    digest(purpose, token) {
      const digest = createHmac("sha256", Buffer.from(args.key))
        .update(`SKILLMAP-DEVICE-AUTH-HMAC-V1\n${purpose}\n${token}\n`, "utf8")
        .digest("hex");
      return `hmac-sha256:${digest}`;
    }
  };
}

/** Parse injected lookup material; this intentionally has no production default. */
export function deviceAuthTokenCryptoFromEnvironment(
  environment: Record<string, string | undefined> = process.env
): DeviceAuthTokenCrypto {
  const encoded = (environment.DEVICE_AUTH_LOOKUP_KEY ?? "").trim();
  const version = Number((environment.DEVICE_AUTH_LOOKUP_KEY_VERSION ?? "1").trim());
  if (!/^[A-Za-z0-9_-]{43,}$/.test(encoded)) throw new Error("device-auth lookup key is not configured");
  let key: Uint8Array;
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded);
    key = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error("device-auth lookup key is not configured");
  }
  return createDeviceAuthTokenCrypto({ key, keyVersion: version });
}
