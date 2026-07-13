import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError, getSiteUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_SAVED_SKILLS = 1_000;
const MAX_SUBMISSIONS = 1_000;
const MAX_REPORTS = 1_000;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

export async function GET() {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return exportError(503, "Account export is unavailable in this environment.");
  }

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(claims, claimsError);
  if (auth.state === "signed-out") {
    return Response.redirect(new URL("/sign-in?next=/account/export", getSiteUrl()), 303);
  }
  if (auth.state !== "authenticated") return exportError(503, "Account authentication could not be verified.");

  const [profileResult, savedCountResult, submissionsCountResult, reportsCountResult] = await Promise.all([
    supabase.from("profiles").select("user_id,created_at").eq("user_id", auth.userId).maybeSingle(),
    supabase.from("saved_skills").select("*", { count: "exact", head: true }).eq("user_id", auth.userId),
    supabase.from("my_skill_submissions").select("*", { count: "exact", head: true }),
    supabase.from("my_skill_reports").select("*", { count: "exact", head: true })
  ]);
  if (profileResult.error || savedCountResult.error || submissionsCountResult.error || reportsCountResult.error
    || savedCountResult.count === null || submissionsCountResult.count === null || reportsCountResult.count === null) {
    return exportError(503, "Account export data could not be read.");
  }
  if (savedCountResult.count > MAX_SAVED_SKILLS || submissionsCountResult.count > MAX_SUBMISSIONS
    || reportsCountResult.count > MAX_REPORTS) {
    return exportError(413, "Account export exceeds the bounded single-download limit. Contact support for a complete export.");
  }
  const [savedResult, submissionsResult, reportsResult] = await Promise.all([
    supabase.from("saved_skills").select("skill_id,created_at").eq("user_id", auth.userId).order("created_at", { ascending: true }).order("skill_id", { ascending: true }).range(0, MAX_SAVED_SKILLS - 1),
    supabase.from("my_skill_submissions").select("*").order("created_at", { ascending: true }).order("submission_id", { ascending: true }).range(0, MAX_SUBMISSIONS - 1),
    supabase.from("my_skill_reports").select("*").order("created_at", { ascending: true }).order("report_id", { ascending: true }).range(0, MAX_REPORTS - 1)
  ]);
  if (savedResult.error || submissionsResult.error || reportsResult.error
    || (savedResult.data?.length ?? 0) !== savedCountResult.count
    || (submissionsResult.data?.length ?? 0) !== submissionsCountResult.count
    || (reportsResult.data?.length ?? 0) !== reportsCountResult.count) {
    return exportError(409, "Account data changed during export. Retry to receive one consistent bounded snapshot.");
  }

  const body = `${JSON.stringify({
    kind: "skillmap.account-export",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: profileResult.data ?? { user_id: auth.userId, created_at: null },
    savedSkills: savedResult.data ?? [],
    submissions: submissionsResult.data ?? [],
    reports: reportsResult.data ?? [],
    limits: { savedSkills: MAX_SAVED_SKILLS, submissions: MAX_SUBMISSIONS, reports: MAX_REPORTS }
  }, null, 2)}\n`;
  if (new TextEncoder().encode(body).byteLength > MAX_EXPORT_BYTES) {
    return exportError(413, "Account export exceeds the bounded response size. Contact support for a complete export.");
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "attachment; filename=\"skillmap-account-export.json\"",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function exportError(status: number, message: string) {
  return Response.json({ error: { code: "ACCOUNT_EXPORT_UNAVAILABLE", message } }, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
