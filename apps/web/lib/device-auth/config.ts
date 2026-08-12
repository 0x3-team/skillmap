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

export interface DeviceAuthServerConfig {
  /** Fixed hosted verification origin (no trailing slash, no path/query). */
  verificationUrl: string;
  /** Supabase API origin used for server-only RPC calls. */
  supabaseUrl: string;
  /** Server-only service role key for allowlisted RPCs. */
  serviceRoleKey: string;
}

function env(name: string, environment?: Record<string, string | undefined>): string {
  const value = environment ? environment[name] : process.env[name];
  return (value ?? "").trim();
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
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY", environment);
  if (!serviceRoleKey) {
    throw new DeviceAuthConfigurationError("SUPABASE_SERVICE_ROLE_KEY must be configured for the server-only DeviceAuth RPC.");
  }
  return { verificationUrl, supabaseUrl, serviceRoleKey };
}