const INDEXING_MODE_VARIABLE = "SKILLMAP_INDEXING_MODE";

export const PRIVATE_ALPHA_ROBOTS_VALUE =
  "noindex, nofollow, noarchive, nosnippet, noimageindex";

export interface ContentSecurityPolicyInput {
  nonce: string;
  supabaseUrl?: string;
  development: boolean;
  upgradeInsecureRequests?: boolean;
}

export interface ResponseSecurityHeadersInput {
  contentSecurityPolicy: string;
  https: boolean;
  publicIndexing: boolean;
}

/**
 * Indexing is deliberately fail-closed for the private alpha. A future public
 * release must opt in with the exact value SKILLMAP_INDEXING_MODE=public.
 */
export function isPublicIndexingEnabled(
  environment: Record<string, string | undefined> = process.env
): boolean {
  return environment[INDEXING_MODE_VARIABLE] === "public";
}

export function createRequestNonce(): string {
  return Buffer.from(crypto.randomUUID(), "utf8").toString("base64");
}

export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  assertSafeNonce(input.nonce);
  const connectSources = [
    "'self'",
    ...getSupabaseConnectSources(input.supabaseUrl, input.development)
  ];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${input.development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${input.nonce}'`,
    `style-src-elem 'self' 'nonce-${input.nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'"
  ];
  if (input.upgradeInsecureRequests) directives.push("upgrade-insecure-requests");
  return `${directives.join("; ")};`;
}

export function buildResponseSecurityHeaders(
  input: ResponseSecurityHeadersInput
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": input.contentSecurityPolicy,
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
  if (!input.publicIndexing) headers["X-Robots-Tag"] = PRIVATE_ALPHA_ROBOTS_VALUE;
  if (input.https) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }
  return headers;
}

export function getSupabaseConnectSources(
  rawUrl: string | undefined,
  development: boolean
): string[] {
  if (!rawUrl) return [];

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) return [];
  if (url.protocol === "http:" && !development && !isLoopbackHost(url.hostname)) return [];

  const websocketUrl = new URL(url.origin);
  websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, websocketUrl.origin];
}

function assertSafeNonce(nonce: string): void {
  if (!/^[A-Za-z0-9+/_=-]{16,256}$/.test(nonce)) {
    throw new TypeError("The CSP nonce must be a bounded base64 value.");
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
