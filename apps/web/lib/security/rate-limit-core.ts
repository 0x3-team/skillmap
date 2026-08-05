export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  maxEntries: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
  resetAt: number;
}

interface FixedWindowEntry {
  count: number;
  resetAt: number;
}

export const PUBLIC_SKILL_RATE_LIMIT_POLICY: Readonly<RateLimitPolicy> = Object.freeze({
  limit: 60,
  windowMs: 60_000,
  maxEntries: 5_000
});

/**
 * A bounded, per-process fixed-window limiter shared by the Node and Edge
 * adapters. It is defense in depth, not a globally consistent quota.
 */
export class InMemoryFixedWindowRateLimiter {
  readonly #policy: RateLimitPolicy;
  readonly #entries = new Map<string, FixedWindowEntry>();

  constructor(policy: RateLimitPolicy) {
    assertPolicy(policy);
    this.#policy = { ...policy };
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    if (!key || key.length > 256) throw new TypeError("Rate-limit keys must contain 1 to 256 characters.");
    if (!Number.isFinite(now) || now < 0) throw new TypeError("Rate-limit time must be a non-negative finite number.");

    let entry = this.#entries.get(key);
    if (entry && entry.resetAt <= now) {
      this.#entries.delete(key);
      entry = undefined;
    }

    if (!entry) {
      this.#evictExpired(now);
      if (this.#entries.size >= this.#policy.maxEntries) {
        const resetAt = this.#earliestResetAt(now + this.#policy.windowMs);
        return denied(this.#policy.limit, resetAt, now);
      }
      entry = { count: 0, resetAt: now + this.#policy.windowMs };
      this.#entries.set(key, entry);
    }

    if (entry.count >= this.#policy.limit) return denied(this.#policy.limit, entry.resetAt, now);
    entry.count += 1;
    const resetAfterSeconds = secondsUntil(entry.resetAt, now);
    return {
      allowed: true,
      limit: this.#policy.limit,
      remaining: this.#policy.limit - entry.count,
      retryAfterSeconds: 0,
      resetAfterSeconds,
      resetAt: entry.resetAt
    };
  }

  reset(): void {
    this.#entries.clear();
  }

  #evictExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) this.#entries.delete(key);
    }
  }

  #earliestResetAt(fallback: number): number {
    let earliest = fallback;
    for (const entry of this.#entries.values()) earliest = Math.min(earliest, entry.resetAt);
    return earliest;
  }
}

export function isPublicCatalogReadRequest(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return isPathOrDescendant(pathname, "/skills") || isPathOrDescendant(pathname, "/api/v1/skills");
}

export function isPublicCatalogApiPath(pathname: string): boolean {
  return isPathOrDescendant(pathname, "/api/v1/skills");
}

/** Returns a bounded, non-secret identity before adapter-specific hashing. */
export function getAnonymousClientIdentity(headers: Headers): string {
  const vercelForwarded = firstHeaderValue(headers.get("x-vercel-forwarded-for"));
  const realIp = firstHeaderValue(headers.get("x-real-ip"));
  const forwarded = firstHeaderValue(headers.get("x-forwarded-for"));
  const address = [vercelForwarded, realIp, forwarded]
    .find((candidate) => candidate !== null && isValidIpAddress(candidate));
  return address ? `ip:${address}` : "anonymous";
}

/** Matches Node net.isIP for the bounded address forms accepted by headers. */
export function isValidIpAddress(value: string): boolean {
  if (isValidIpv4(value)) return true;
  let candidate = value;
  if (candidate.includes(".")) {
    const separator = candidate.lastIndexOf(":");
    if (separator < 0) return false;
    const ipv4 = candidate.slice(separator + 1);
    if (!isValidIpv4(ipv4)) return false;
    const octets = ipv4.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    candidate = `${candidate.slice(0, separator)}:${high}:${low}`;
  }
  if (!candidate.includes(":") || !/^[0-9a-f:]+$/i.test(candidate)) return false;
  const compression = candidate.indexOf("::");
  if (compression !== candidate.lastIndexOf("::")) return false;
  if (compression < 0) {
    const groups = candidate.split(":");
    return groups.length === 8 && groups.every(isValidIpv6Group);
  }
  const left = candidate.slice(0, compression).split(":").filter(Boolean);
  const right = candidate.slice(compression + 2).split(":").filter(Boolean);
  if (left.length + right.length >= 8) return false;
  return [...left, ...right].every(isValidIpv6Group)
    && !candidate.slice(0, compression).endsWith(":")
    && !candidate.slice(compression + 2).startsWith(":");
}

export function applyRateLimitHeaders<T extends Response>(
  response: T,
  decision: RateLimitDecision
): T {
  response.headers.set("RateLimit-Limit", String(decision.limit));
  response.headers.set("RateLimit-Remaining", String(decision.remaining));
  response.headers.set("RateLimit-Reset", String(decision.resetAfterSeconds));
  return response;
}

export function applyRetryAfterHeader<T extends Response>(
  response: T,
  decision: RateLimitDecision
): T {
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}

function firstHeaderValue(value: string | null): string | null {
  if (!value || value.length > 1_024) return null;
  const first = value.split(",", 1)[0]?.trim();
  return first && first.length <= 64 ? first : null;
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4
    && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function isValidIpv6Group(value: string): boolean {
  return value.length >= 1 && value.length <= 4 && /^[0-9a-f]+$/i.test(value);
}

function isPathOrDescendant(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function denied(limit: number, resetAt: number, now: number): RateLimitDecision {
  const resetAfterSeconds = secondsUntil(resetAt, now);
  return {
    allowed: false,
    limit,
    remaining: 0,
    retryAfterSeconds: resetAfterSeconds,
    resetAfterSeconds,
    resetAt
  };
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1_000));
}

function assertPolicy(policy: RateLimitPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Rate-limit ${name} must be a positive safe integer.`);
    }
  }
}
