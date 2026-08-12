import {
  deviceAuthEdgeDecisionHeaders,
  getDeviceAuthSourceIdentity,
  isPublicDeviceAuthInitiationRequest,
  type RateLimitDecision
} from "../lib/security/rate-limit-core.ts";

const LOOKUP_KEY_DOMAIN = "skillmap/device-auth/source-ip-rate-limit/v1\0";
const DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY = "DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY";
const DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS = "DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS";

export interface DeviceAuthIpRateLimiterBinding {
  idFromName(name: string): { id: string };
  get(id: { id: string }): { fetch(request: Request): Promise<Response> };
}

export interface DeviceAuthEdgeEnv {
  DEVICE_AUTH_IP_RATE_LIMITER?: DeviceAuthIpRateLimiterBinding;
  [DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY]?: string;
  [DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS]?: string;
}

export interface DeviceAuthEdgeGateResult {
  request?: Request;
  response?: Response;
}

export async function gateDeviceAuthRequest(
  request: Request,
  env: DeviceAuthEdgeEnv,
  { now = Date.now() }: { now?: number } = {}
): Promise<DeviceAuthEdgeGateResult> {
  const isInitiation = isPublicDeviceAuthInitiationRequest(
    new URL(request.url).pathname,
    request.method
  );
  const headers = new Headers(request.headers);
  removePrivateHeaders(headers);
  if (!isInitiation) return { request: new Request(request, { headers }) };

  const sourceIdentity = getDeviceAuthSourceIdentity(request.headers);
  const lookupKey = env[DEVICE_AUTH_IP_RATE_LIMIT_KEY_PRIMARY];
  const previousLookupKey = env[DEVICE_AUTH_IP_RATE_LIMIT_KEY_PREVIOUS];
  if (sourceIdentity === "anonymous" || !isSecret(lookupKey) || (previousLookupKey !== undefined && !isSecret(previousLookupKey))) {
    return { response: unavailableResponse() };
  }

  try {
    const currentKey = await deriveBucketKey(lookupKey, sourceIdentity);
    const previousKey = previousLookupKey && previousLookupKey !== lookupKey
      ? await deriveBucketKey(previousLookupKey, sourceIdentity)
      : null;
    const previous = previousKey
      ? await checkAuthority(env, previousKey, now)
      : null;
    const current = await checkAuthority(env, currentKey, now);
    const decision = combineDecisions(current, previous);
    if (!decision.allowed) return { response: rateLimitedResponse(decision) };

    for (const name of [
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip",
      "x-vercel-forwarded-for"
    ]) headers.delete(name);
    for (const [name, value] of Object.entries(deviceAuthEdgeDecisionHeaders(decision))) {
      headers.set(name, value);
    }
    return { request: new Request(request, { headers }) };
  } catch {
    return { response: unavailableResponse() };
  }
}

async function checkAuthority(
  env: DeviceAuthEdgeEnv,
  bucketKey: string,
  now: number
): Promise<RateLimitDecision> {
  const binding = env.DEVICE_AUTH_IP_RATE_LIMITER;
  if (!binding) throw new Error("DeviceAuth rate-limit binding is not configured.");
  const response = await binding.get(binding.idFromName(bucketKey)).fetch(new Request("https://device-auth.invalid/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bucketKey, limit: 5, windowMs: 600_000, now })
  }));
  if (!response.ok) throw new Error("DeviceAuth rate-limit authority failed.");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("DeviceAuth rate-limit authority returned invalid data.");
  const candidate = value as Record<string, unknown>;
  const limit = safeInteger(candidate.limit);
  const remaining = safeInteger(candidate.remaining);
  const retryAfterSeconds = safeInteger(candidate.retryAfterSeconds);
  const resetAfterSeconds = safeInteger(candidate.resetAfterSeconds);
  const resetAt = safeInteger(candidate.resetAt);
  if (typeof candidate.allowed !== "boolean" || limit === null || remaining === null || retryAfterSeconds === null
    || resetAfterSeconds === null || resetAt === null) {
    throw new Error("DeviceAuth rate-limit authority returned invalid data.");
  }
  if (limit !== 5 || remaining < 0 || remaining > 5
    || (candidate.allowed ? retryAfterSeconds !== 0 : (remaining !== 0 || retryAfterSeconds < 1))
    || resetAfterSeconds < 1) {
    throw new Error("DeviceAuth rate-limit authority returned invalid data.");
  }
  return {
    allowed: candidate.allowed,
    limit,
    remaining,
    retryAfterSeconds,
    resetAfterSeconds,
    resetAt
  };
}

function combineDecisions(current: RateLimitDecision, previous: RateLimitDecision | null): RateLimitDecision {
  if (!previous) return current;
  return {
    allowed: current.allowed && previous.allowed,
    limit: 5,
    remaining: Math.min(current.remaining, previous.remaining),
    retryAfterSeconds: Math.max(current.retryAfterSeconds, previous.retryAfterSeconds),
    resetAfterSeconds: Math.max(current.resetAfterSeconds, previous.resetAfterSeconds),
    resetAt: Math.max(current.resetAt, previous.resetAt)
  };
}

function safeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

async function deriveBucketKey(secret: string, sourceIdentity: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${LOOKUP_KEY_DOMAIN}${sourceIdentity}`));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function removePrivateHeaders(headers: Headers): void {
  for (const name of [
    "x-skillmap-device-auth-edge-checked",
    "x-skillmap-device-auth-limit",
    "x-skillmap-device-auth-remaining",
    "x-skillmap-device-auth-retry-after",
    "x-skillmap-device-auth-reset"
  ]) headers.delete(name);
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512;
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({
    error: "temporarily_unavailable",
    error_description: "The device authorization service is temporarily unavailable."
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "1"
    }
  });
}

function rateLimitedResponse(decision: RateLimitDecision): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(decision.retryAfterSeconds)
  });
  headers.set("ratelimit-limit", String(decision.limit));
  headers.set("ratelimit-remaining", String(decision.remaining));
  headers.set("ratelimit-reset", String(decision.resetAfterSeconds));
  return new Response(JSON.stringify({
    error: "rate_limited",
    error_description: "Too many requests.",
    retry_after: decision.retryAfterSeconds
  }), { status: 429, headers });
}
