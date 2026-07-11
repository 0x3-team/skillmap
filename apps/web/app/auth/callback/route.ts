import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/sign-in?error=missing-code", url.origin));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));

  const { error: profileError } = await supabase.from("profiles").insert({ user_id: data.user.id });
  if (profileError && profileError.code !== "23505") {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/sign-in?error=profile", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
