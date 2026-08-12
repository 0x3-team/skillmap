/* DeviceAuth v1 server configuration. The verification origin is deployment
 * configuration, never caller input. The service role key is a server-only
 * secret; it is never a NEXT_PUBLIC_* value. */

import "server-only";

export class DeviceAuthConfigurationError extends Error {
  readonly code = "DEVICE_AUTH_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "DeviceAuthConfigurationError";
  }
}

/**
 * The name of the Cloudflare Worker secret consumed by DeviceAuth's
 * server-only Supabase client. Keep this out of `wrangler.vars`: vars are
 * part of the public Worker configuration, while `wrangler secret put`
 * stores an encrypted runtime binding.
 */
export const DEVICE_AUTH_SERVICE_ROLE_SECRET_NAME = "SUPABASE_SERVICE_ROLE_KEY" as const;

export interface DeviceAuthServerConfig {
  /** Fixed hosted verification origin (no trailing slash, no path/query). */
  verificationUrl: string;
  /** Supabase API origin used for server-only RPC calls. */
  supabaseUrl: string;
  /** Server-only service role key for allowlisted RPCs. */
  serviceRoleKey: string;
  /** Refresh response mode. alpha-single-shot is an explicitly non-production seam. */
  refreshMode: DeviceAuthRefreshMode;
}

export type DeviceAuthRefreshMode = "alpha-single-shot" | "exact-replay";

export function parseDeviceAuthRefreshMode(value: string | undefined): DeviceAuthRefreshMode {
  const mode = (value ?? "").trim() || "exact-replay";
  if (mode === "alpha-single-shot" || mode === "exact-replay") return mode;
  throw new DeviceAuthConfigurationError(
    "DEVICE_AUTH_REFRESH_MODE must be exactly alpha-single-shot or exact-replay."
  );
}

function env(name: string, environment?: Record<string, string | undefined>): string {
  const value = environment ? environment[name] : process.env[name];
  return (value ?? "").trim();
}

/**
 * Require the server credential without returning, logging, hashing, or
 * otherwise exposing its value. Cloudflare injects Worker secrets into the
 * request runtime environment; local tests may provide the same named value.
 */
export function assertDeviceAuthServerSecret(
  environment?: Record<string, string | undefined>
): void {
  if (!env(DEVICE_AUTH_SERVICE_ROLE_SECRET_NAME, environment)) {
    throw new DeviceAuthConfigurationError(
      `${DEVICE_AUTH_SERVICE_ROLE_SECRET_NAME} must be provisioned as an encrypted Worker secret for hosted DeviceAuth routes.`
    );
  }
}

/** Parse a bare HTTPS/HTTP origin; reject credentials, path, query, and fragments. */
function parseOrigin(raw: string, name: string, nodeEnvironment: string | undefined): string {
  if (!raw) throw new DeviceAuthConfigurationError(`${name} must be a valid HTTP(S) origin.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeviceAuthConfigurationError(`${name} must be a valid HTTP(S) origin.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DeviceAuthConfigurationError(`${name} must use HTTP(S).`);
  }
  if (nodeEnvironment === "production" && url.protocol !== "https:") {
    throw new DeviceAuthConfigurationError(`${name} must use HTTPS in production.`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new DeviceAuthConfigurationError(`${name} must be an origin only, without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

export function getPublicDeviceAuthConfig(
  environment?: Record<string, string | undefined>
): { supabaseUrl: string; verificationUrl: string } {
  const nodeEnvironment = environment ? environment.NODE_ENV : process.env.NODE_ENV;
  const supabaseUrl = parseOrigin(env("NEXT_PUBLIC_SUPABASE_URL", environment), "NEXT_PUBLIC_SUPABASE_URL", nodeEnvironment);
  const verificationRaw = env("DEVICE_AUTH_VERIFICATION_URL", environment)
    || env("NEXT_PUBLIC_SITE_URL", environment);
  const verificationUrl = parseOrigin(verificationRaw, "DEVICE_AUTH_VERIFICATION_URL", nodeEnvironment);
  return { supabaseUrl, verificationUrl };
}

export function getDeviceAuthServerConfig(
  environment?: Record<string, string | undefined>
): DeviceAuthServerConfig {
  const nodeEnvironment = environment ? environment.NODE_ENV : process.env.NODE_ENV;
  const supabaseUrl = parseOrigin(env("NEXT_PUBLIC_SUPABASE_URL", environment), "NEXT_PUBLIC_SUPABASE_URL", nodeEnvironment);
  const verificationRaw = env("DEVICE_AUTH_VERIFICATION_URL", environment)
    || env("NEXT_PUBLIC_SITE_URL", environment);
  const verificationUrl = parseOrigin(verificationRaw, "DEVICE_AUTH_VERIFICATION_URL", nodeEnvironment);
  const serviceRoleKey = env(DEVICE_AUTH_SERVICE_ROLE_SECRET_NAME, environment);
  assertDeviceAuthServerSecret(environment);
  return {
    verificationUrl,
    supabaseUrl,
    serviceRoleKey,
    refreshMode: parseDeviceAuthRefreshMode(env("DEVICE_AUTH_REFRESH_MODE", environment))
  };
}
