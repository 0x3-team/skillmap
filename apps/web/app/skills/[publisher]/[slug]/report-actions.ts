"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { parseSkillReportForm, ReportValidationError } from "@/lib/reports/input";
import { REPORT_PUBLIC_ID, reportStatusPath } from "@/lib/reports/status";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function reportSuspiciousListing(formData: FormData) {
  let report: ReturnType<typeof parseSkillReportForm>;
  try {
    report = parseSkillReportForm(formData);
  } catch (error) {
    const returnPath = readSafeReturnPath(formData);
    if (error instanceof ReportValidationError) {
      redirect(reportStatusPath(returnPath, "invalid", { field: error.field }));
    }
    redirect(reportStatusPath(returnPath, "service-unavailable"));
  }

  const context = await reportActionContext();
  if (context.state === "signed-out") redirect(`/sign-in?next=${encodeURIComponent(`${report.returnPath}#report-listing`)}`);
  if (context.state === "unavailable") redirect(reportStatusPath(report.returnPath, "auth-unavailable"));

  const { error } = await context.supabase.from("skill_reports").insert({
    skill_id: report.skill_id,
    version_id: report.version_id,
    category: report.category,
    message: report.message,
    idempotency_key: report.idempotency_key
  });

  if (error) {
    if (error.code === "23505") {
      const existingId = await findReportId(context.supabase, report);
      if (!existingId) redirect(reportStatusPath(report.returnPath, "service-unavailable"));
      redirect(reportStatusPath(report.returnPath, "duplicate", { reportId: existingId }));
    }
    if (error.code === "P0001") redirect(reportStatusPath(report.returnPath, "cooldown"));
    if (error.code === "P0003") redirect(reportStatusPath(report.returnPath, "active-limit"));
    if (error.code === "P0004") redirect(reportStatusPath(report.returnPath, "daily-limit"));
    if (error.code === "23514") redirect(reportStatusPath(report.returnPath, "target-unavailable"));
    redirect(reportStatusPath(report.returnPath, "service-unavailable"));
  }

  const reportId = await findReportId(context.supabase, report);
  if (!reportId) redirect(reportStatusPath(report.returnPath, "service-unavailable"));
  revalidatePath("/account/reports");
  redirect(reportStatusPath(report.returnPath, "queued", { reportId }));
}

async function findReportId(
  supabase: SupabaseClient<Database>,
  report: ReturnType<typeof parseSkillReportForm>
): Promise<string | null> {
  const { data, error } = await supabase
    .from("my_skill_reports")
    .select("report_id")
    .eq("skill_id", report.skill_id)
    .eq("version_id", report.version_id)
    .eq("category", report.category)
    .eq("message", report.message)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || typeof data.report_id !== "string" || !REPORT_PUBLIC_ID.test(data.report_id)) return null;
  return data.report_id;
}

function readSafeReturnPath(formData: FormData): string {
  const values = formData.getAll("returnPath");
  return values.length === 1 && typeof values[0] === "string" ? values[0] : "/skills";
}

type ReportActionContext =
  | { state: "authenticated"; supabase: SupabaseClient<Database> }
  | { state: "signed-out" }
  | { state: "unavailable" };

async function reportActionContext(): Promise<ReportActionContext> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return { state: "unavailable" };
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state !== "authenticated") return { state: auth.state };
  return { state: "authenticated", supabase };
}
