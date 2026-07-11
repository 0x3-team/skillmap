import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError, getPublicSupabaseConfig, getSiteUrl } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
        return redirectResponse;
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
  return response;
}

function setPrivateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
