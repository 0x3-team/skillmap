import { NextResponse } from "next/server";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { assertHostedSkillId } from "@/lib/registry/query";
import { getSiteUrl, SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let publicOrigin: string;
  try {
    publicOrigin = getSiteUrl();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return new Response("Saved-skill service unavailable.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const requestOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (requestOrigin !== publicOrigin && fetchSite !== "same-origin") {
    return new Response("Same-origin form submission required.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid saved-skill form.", { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  const skillId = readSingle(formData, "skillId", 36);
  const operation = readSingle(formData, "operation", 10);
  const returnPath = readSingle(formData, "returnPath", 160);
  if (!skillId || !operation || !returnPath || !isSafeReturnPath(returnPath)
    || (operation !== "save" && operation !== "remove")) {
    return new Response("Invalid saved-skill form.", { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    assertHostedSkillId(skillId);
  } catch {
    return new Response("Invalid saved-skill form.", { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return redirectWithStatus(publicOrigin, returnPath, "unavailable");
  }
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, claimsError);
  if (auth.state !== "authenticated") {
    if (auth.state === "signed-out") {
      const signIn = new URL("/sign-in", publicOrigin);
      signIn.searchParams.set("next", returnPath);
      return NextResponse.redirect(signIn, { status: 303 });
    }
    return redirectWithStatus(publicOrigin, returnPath, "unavailable");
  }

  const result = operation === "save"
    ? await supabase.from("saved_skills").upsert(
        { user_id: auth.userId, skill_id: skillId },
        { onConflict: "user_id,skill_id", ignoreDuplicates: true }
      )
    : await supabase.from("saved_skills").delete().eq("user_id", auth.userId).eq("skill_id", skillId);
  if (result.error) return redirectWithStatus(publicOrigin, returnPath, "unavailable");
  return redirectWithStatus(publicOrigin, returnPath, operation === "save" ? "saved" : "removed");
}

function redirectWithStatus(publicOrigin: string, returnPath: string, status: "saved" | "removed" | "unavailable") {
  const target = new URL(returnPath, publicOrigin);
  target.searchParams.set("saveStatus", status);
  return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}

function readSingle(formData: FormData, name: string, maximumLength: number): string | null {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0];
  return value.length > 0 && value.length <= maximumLength && value === value.trim()
    && value === value.normalize("NFC") && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function isSafeReturnPath(value: string): boolean {
  return value === "/account" || /^\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
