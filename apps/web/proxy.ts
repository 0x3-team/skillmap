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
import type { Database } from "@/lib/supabase/database.types";

export async function proxy(request: NextRequest) {
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
    if (request.nextUrl.pathname.startsWith("/account") && auth.state !== "authenticated") {
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

  if (/^\/(?:account|sign-in|auth)(?:\/|$)/.test(request.nextUrl.pathname)) setPrivateNoStore(response);
  return applySecurityHeaders(response, responseSecurityHeaders);
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
