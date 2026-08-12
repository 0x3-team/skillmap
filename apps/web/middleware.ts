import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import {
  buildContentSecurityPolicy,
  buildResponseSecurityHeaders,
  createRequestNonce,
  isPublicIndexingEnabled
} from "@/lib/security/policy";
import { SupabaseConfigurationError, getPublicSupabaseConfig, getSiteUrl } from "@/lib/supabase/config";
import {
  applyRateLimitHeaders,
  applyRetryAfterHeader,
  getDeviceAuthSourceIdentity,
  getAnonymousClientIdentity,
  InMemoryFixedWindowRateLimiter,
  isPublicCatalogApiPath,
  isPublicCatalogReadRequest,
  isPublicDeviceAuthInitiationRequest,
  PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY,
  PUBLIC_SKILL_RATE_LIMIT_POLICY,
  type RateLimitDecision
} from "@/lib/security/rate-limit-core";
import { createHostedApiErrorPayload } from "@/lib/contracts/hosted-api-response";
import type { Database } from "@/lib/supabase/database.runtime.types";

export async function middleware(request: NextRequest) {
  const isAccountPath = /^\/account(?:\/|$)/.test(request.nextUrl.pathname);
  const nonce = createRequestNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: request.nextUrl.protocol === "https:"
  });
  const responseSecurityHeaders = buildResponseSecurityHeaders({
    contentSecurityPolicy,
    https: request.nextUrl.protocol === "https:",
    publicIndexing: isPublicIndexingEnabled()
  });
  const deviceAuthRateLimit = isPublicDeviceAuthInitiationRequest(
    request.nextUrl.pathname,
    request.method
  )
    ? await consumePublicDeviceAuthInitiation(request)
    : null;
  if (deviceAuthRateLimit && !deviceAuthRateLimit.allowed) {
    return createDeviceAuthRateLimitedResponse(deviceAuthRateLimit, responseSecurityHeaders);
  }
  const rateLimit = isPublicCatalogReadRequest(request.nextUrl.pathname, request.method)
    ? await consumePublicSkillRequest(request)
    : null;
  if (rateLimit && !rateLimit.allowed) {
    return createRateLimitedResponse(request, rateLimit, responseSecurityHeaders);
  }
  let response = createPassthroughResponse(request, nonce, contentSecurityPolicy);

  try {
    const { url, publishableKey } = getPublicSupabaseConfig();
    const supabase = createServerClient<Database>(url, publishableKey, {
      db: { schema: "api" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = createPassthroughResponse(request, nonce, contentSecurityPolicy);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        }
      }
    });

    const { data, error } = await supabase.auth.getClaims();
    const auth = classifyVerifiedClaims(data, error);
    if (isAccountPath && auth.state !== "authenticated") {
      if (auth.state === "signed-out") {
        const signIn = new URL("/sign-in", getSiteUrl());
        signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
        const redirectResponse = NextResponse.redirect(signIn);
        for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
        setPrivateNoStore(redirectResponse);
        return applySecurityHeaders(redirectResponse, responseSecurityHeaders);
      }
      // Retryable/5xx auth failures continue to the protected page so it can
      // render an explicit unavailable state instead of a false sign-out.
    }
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    // Hosted routes render their own explicit unavailable state. Missing
    // configuration must never trigger fixture fallback.
  }

  if (/^\/(?:account|sign-in|auth|submit)(?:\/|$)/.test(request.nextUrl.pathname)) setPrivateNoStore(response);
  if (rateLimit) applyRateLimitHeaders(response, rateLimit);
  return applySecurityHeaders(response, responseSecurityHeaders);
}

function createDeviceAuthRateLimitedResponse(
  decision: RateLimitDecision,
  securityHeaders: Readonly<Record<string, string>>
): NextResponse {
  const response = new NextResponse(JSON.stringify({
    error: "rate_limited",
    error_description: "Too many requests.",
    retry_after: decision.retryAfterSeconds
  }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
  applyRateLimitHeaders(response, decision);
  applyRetryAfterHeader(response, decision);
  return applySecurityHeaders(response, securityHeaders);
}

function createRateLimitedResponse(
  request: NextRequest,
  decision: RateLimitDecision,
  securityHeaders: Readonly<Record<string, string>>
): NextResponse {
  const response = isPublicCatalogApiPath(request.nextUrl.pathname)
    ? catalogError(
        429,
        "RATE_LIMITED",
        "Too many catalog requests. Try again shortly.",
        true
      )
    : new NextResponse("Too many catalog requests. Try again shortly.\n", {
        status: 429,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
  applyRateLimitHeaders(response, decision);
  applyRetryAfterHeader(response, decision);
  setPrivateNoStore(response);
  return applySecurityHeaders(response, securityHeaders);
}

function createPassthroughResponse(
  request: NextRequest,
  nonce: string,
  contentSecurityPolicy: string
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function applySecurityHeaders(
  response: NextResponse,
  headers: Readonly<Record<string, string>>
): NextResponse {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function setPrivateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
}

const publicSkillLimiter = new InMemoryFixedWindowRateLimiter(PUBLIC_SKILL_RATE_LIMIT_POLICY);
const publicDeviceAuthInitiationLimiter = new InMemoryFixedWindowRateLimiter(
  PUBLIC_DEVICE_AUTH_INITIATION_RATE_LIMIT_POLICY
);

async function consumePublicSkillRequest(
  request: Pick<Request, "headers">,
  now = Date.now()
): Promise<RateLimitDecision> {
  const identity = getAnonymousClientIdentity(request.headers);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return publicSkillLimiter.consume(btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""), now);
}

async function consumePublicDeviceAuthInitiation(
  request: Pick<Request, "headers">,
  now = Date.now()
): Promise<RateLimitDecision> {
  const identity = getDeviceAuthSourceIdentity(request.headers);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return publicDeviceAuthInitiationLimiter.consume(
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    now
  );
}

function catalogError(status: number, code: string, message: string, retryable = false): NextResponse {
  const payload = createHostedApiErrorPayload(code, message, retryable);
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
