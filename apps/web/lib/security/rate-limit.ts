import { createHash } from "node:crypto";
import {
  applyRateLimitHeaders,
  applyRetryAfterHeader,
  getDeviceAuthSourceIdentity,
  getAnonymousClientIdentity,
  InMemoryFixedWindowRateLimiter,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest,
  isPublicDeviceAuthInitiationRequest,
  isValidIpAddress,
  PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY,
  PUBLIC_SKILL_RATE_LIMIT_POLICY,
  type RateLimitDecision,
  type RateLimitPolicy
} from "./rate-limit-core.ts";

export {
  applyRateLimitHeaders,
  applyRetryAfterHeader,
  getDeviceAuthSourceIdentity,
  getAnonymousClientIdentity,
  InMemoryFixedWindowRateLimiter,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest,
  isPublicDeviceAuthInitiationRequest,
  isValidIpAddress,
  PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY,
  PUBLIC_SKILL_RATE_LIMIT_POLICY,
  type RateLimitDecision,
  type RateLimitPolicy
} from "./rate-limit-core.ts";

const publicSkillLimiter = new InMemoryFixedWindowRateLimiter(PUBLIC_SKILL_RATE_LIMIT_POLICY);

export function consumePublicSkillRequest(
  request: Pick<Request, "headers">,
  now = Date.now()
): RateLimitDecision {
  return publicSkillLimiter.consume(getAnonymousClientKey(request.headers), now);
}

export function getAnonymousClientKey(headers: Headers): string {
  return createHash("sha256")
    .update(getAnonymousClientIdentity(headers), "utf8")
    .digest("base64url");
}
