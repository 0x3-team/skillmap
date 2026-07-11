import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/paths";
import { getSiteUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteUrl = getSiteUrl();
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (!code) return authRedirect(new URL("/sign-in?error=missing-code", siteUrl));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return authRedirect(new URL("/sign-in?error=callback", siteUrl));

  const { error: profileError } = await supabase.from("profiles").insert({ user_id: data.user.id });
  if (profileError && profileError.code !== "23505") {
    await supabase.auth.signOut();
    return authRedirect(new URL("/sign-in?error=profile", siteUrl));
  }

  return authRedirect(new URL(next, siteUrl));
}

function authRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
