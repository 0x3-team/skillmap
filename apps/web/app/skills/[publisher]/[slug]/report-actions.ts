"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { parseSkillReportForm, ReportValidationError, type ReportField } from "@/lib/reports/input";
import { createReportFlash, REPORT_FLASH_COOKIE, serializeReportFlash } from "@/lib/reports/flash";
import { REPORT_PUBLIC_ID, reportStatusPath, type ReportSubmitStatus } from "@/lib/reports/status";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ReportActionState {
  status: Exclude<ReportSubmitStatus, "queued">;
  field?: ReportField;
  message?: string;
  reportId?: string;
}

export async function reportSuspiciousListing(formData: FormData): Promise<ReportActionState> {
  let report: ReturnType<typeof parseSkillReportForm>;
  try {
    report = parseSkillReportForm(formData);
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return { status: "invalid", field: error.field, message: error.message };
    }
    return { status: "service-unavailable" };
  }

  const context = await reportActionContext();
  if (context.state === "signed-out") redirect(`/sign-in?next=${encodeURIComponent(`${report.returnPath}#report-listing`)}`);
  if (context.state === "unavailable") return { status: "auth-unavailable" };

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
      if (!existingId) return { status: "service-unavailable" };
      return { status: "duplicate", reportId: existingId };
    }
    if (error.code === "P0001") return { status: "cooldown" };
    if (error.code === "P0003") return { status: "active-limit" };
    if (error.code === "P0004") return { status: "daily-limit" };
    if (error.code === "23514") return { status: "target-unavailable" };
    return { status: "service-unavailable" };
  }

  const reportId = await findReportId(context.supabase, report);
  if (!reportId) return { status: "service-unavailable" };
  revalidatePath("/account/reports");
  redirect(reportStatusPath(report.returnPath, "queued", { reportId }));
}

export async function reportSuspiciousListingProgressive(formData: FormData): Promise<void> {
  const result = await reportSuspiciousListing(formData);
  const token = randomUUID();
  const flash = createReportFlash(formData, result, token);
  if (!flash) redirect("/skills");
  const cookieStore = await cookies();
  cookieStore.set(REPORT_FLASH_COOKIE, serializeReportFlash(flash), {
    httpOnly: true,
    maxAge: 120,
    path: flash.returnPath,
    sameSite: "strict",
    secure: publicOriginUsesHttps()
  });
  redirect(`${flash.returnPath}?reportFlash=${encodeURIComponent(token)}#report-listing`);
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

function publicOriginUsesHttps(): boolean {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1").protocol === "https:";
  } catch {
    return false;
  }
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
