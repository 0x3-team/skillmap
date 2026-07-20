export class SupabaseConfigurationError extends Error {
  readonly code = "SUPABASE_NOT_CONFIGURED";

  constructor(message = "The hosted catalog is not configured in this environment.") {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

export function getPublicSupabaseConfig(
  environment?: Record<string, string | undefined>
): PublicSupabaseConfig {
  // Keep literal NEXT_PUBLIC reads on the default path so Next can substitute
  // them in a client bundle. Explicit injection remains available to the
  // server-only health projection and unit tests.
  const rawUrl = (environment
    ? environment.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const publishableKey = (environment
    ? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim();
  const nodeEnvironment = environment ? environment.NODE_ENV : process.env.NODE_ENV;

  if (!rawUrl || !publishableKey) throw new SupabaseConfigurationError();
  return {
    url: parseConfiguredOrigin(rawUrl, "NEXT_PUBLIC_SUPABASE_URL", nodeEnvironment),
    publishableKey
  };
}

export function getSiteUrl(
  environment?: Record<string, string | undefined>
): string {
  const configured = (environment
    ? environment.NEXT_PUBLIC_SITE_URL
    : process.env.NEXT_PUBLIC_SITE_URL)?.trim();
  const nodeEnvironment = environment ? environment.NODE_ENV : process.env.NODE_ENV;
  if (configured) return parseConfiguredOrigin(configured, "NEXT_PUBLIC_SITE_URL", nodeEnvironment);

  if (nodeEnvironment !== "production") return "http://127.0.0.1:3000";
  throw new SupabaseConfigurationError("NEXT_PUBLIC_SITE_URL is required in production.");
}

function parseConfiguredOrigin(raw: string, variable: string, nodeEnvironment?: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SupabaseConfigurationError(`${variable} must be a valid HTTP(S) origin.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SupabaseConfigurationError(`${variable} must use HTTP or HTTPS.`);
  }
  if (nodeEnvironment === "production" && url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new SupabaseConfigurationError(`${variable} must use HTTPS in production; HTTP is allowed only for loopback acceptance tests.`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new SupabaseConfigurationError(`${variable} must contain an origin only, without credentials, path, query, or fragment.`);
  }

  return url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
