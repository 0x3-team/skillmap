const INDEXING_MODE_VARIABLE = "SKILLMAP_INDEXING_MODE";
export const RELEASE_STAGE_VARIABLE = "SKILLMAP_RELEASE_STAGE";
export const SUPPORT_URL_VARIABLE = "SKILLMAP_SUPPORT_URL";

export const RELEASE_STAGES = [
  "local-candidate",
  "private-alpha",
  "public-alpha"
] as const;

export type ReleaseStage = (typeof RELEASE_STAGES)[number];
// Next.js may create an empty style element while reconciling streamed route
// styles. This hash authorizes only the empty byte string and keeps arbitrary
// inline style elements blocked.
const EMPTY_STYLE_SHA256 = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

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
 * Release-stage copy fails closed. An absent, misspelled, or padded value must
 * never make a local checkout describe itself as a deployed hosted service.
 */
export function getReleaseStage(
  environment: Record<string, string | undefined> = process.env
): ReleaseStage {
  const value = environment[RELEASE_STAGE_VARIABLE];
  return RELEASE_STAGES.includes(value as ReleaseStage)
    ? (value as ReleaseStage)
    : "local-candidate";
}

export function isHostedReleaseStage(stage: ReleaseStage): boolean {
  return stage !== "local-candidate";
}

export function releaseStageLabel(stage: ReleaseStage): string {
  switch (stage) {
    case "private-alpha":
      return "private hosted alpha";
    case "public-alpha":
      return "public alpha";
    default:
      return "local launch candidate";
  }
}

/**
 * Indexing is deliberately fail-closed for the private alpha. A future public
 * release must opt in with both SKILLMAP_RELEASE_STAGE=public-alpha and the
 * exact value SKILLMAP_INDEXING_MODE=public. Either missing or malformed value
 * keeps indexing disabled.
 */
export function isPublicIndexingEnabled(
  environment: Record<string, string | undefined> = process.env
): boolean {
  return environment[INDEXING_MODE_VARIABLE] === "public"
    && getReleaseStage(environment) === "public-alpha";
}

/**
 * Hosted support, security, and appeal intake must point to one deliberately
 * approved public page. Invalid values fail closed instead of leaving a
 * hard-coded private-repository link in a public deployment. Loopback HTTP is
 * accepted only so the production browser gate can exercise the wiring.
 */
export function getApprovedSupportUrl(
  environment: Record<string, string | undefined> = process.env
): string | null {
  const value = environment[SUPPORT_URL_VARIABLE];
  if (!value || value !== value.trim()) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url.href;
  return null;
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
    `style-src 'self' 'nonce-${input.nonce}' ${EMPTY_STYLE_SHA256}`,
    `style-src-elem 'self' 'nonce-${input.nonce}' ${EMPTY_STYLE_SHA256}`,
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
