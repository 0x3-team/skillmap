import { createHash } from "node:crypto";
import { isIP } from "node:net";

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
 * A bounded, per-process fixed-window limiter for the private alpha. It is a
 * defense-in-depth guard, not a globally consistent public-release quota.
 * Public release still requires a provider-level or shared global limiter.
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

    if (entry.count >= this.#policy.limit) {
      return denied(this.#policy.limit, entry.resetAt, now);
    }

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

const publicSkillLimiter = new InMemoryFixedWindowRateLimiter(PUBLIC_SKILL_RATE_LIMIT_POLICY);

export function consumePublicSkillRequest(
  request: Pick<Request, "headers">,
  now = Date.now()
): RateLimitDecision {
  return publicSkillLimiter.consume(getAnonymousClientKey(request.headers), now);
}

export function getAnonymousClientKey(headers: Headers): string {
  const vercelForwarded = firstHeaderValue(headers.get("x-vercel-forwarded-for"));
  const realIp = firstHeaderValue(headers.get("x-real-ip"));
  const forwarded = firstHeaderValue(headers.get("x-forwarded-for"));
  const address = [vercelForwarded, realIp, forwarded]
    .find((candidate) => candidate !== null && isIP(candidate) !== 0);
  // Unknown clients intentionally share one private-alpha bucket. This is
  // fail-closed and bounded, but it is not a replacement for provider limits.
  const identity = address ? `ip:${address}` : "anonymous";
  return createHash("sha256").update(identity, "utf8").digest("base64url");
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

function firstHeaderValue(value: string | null): string | null {
  if (!value || value.length > 1_024) return null;
  const first = value.split(",", 1)[0]?.trim();
  return first && first.length <= 64 ? first : null;
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
