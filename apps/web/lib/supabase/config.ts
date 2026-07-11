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

export function getPublicSupabaseConfig(): PublicSupabaseConfig {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!rawUrl || !publishableKey) throw new SupabaseConfigurationError();

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP(S) URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }

  return { url: url.toString().replace(/\/$/, ""), publishableKey };
}

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SupabaseConfigurationError("NEXT_PUBLIC_SITE_URL must use HTTP or HTTPS.");
    }
    return url.toString().replace(/\/$/, "");
  }

  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:3000";
  throw new SupabaseConfigurationError("NEXT_PUBLIC_SITE_URL is required in production.");
}
