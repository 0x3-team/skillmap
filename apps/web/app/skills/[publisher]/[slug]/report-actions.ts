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
import { SupabaseConfigurationError, siteOriginUsesHttps } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.runtime.types";
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
      // Both the owner request UUID and the partial queued-target index use
      // 23505. Resolve the request UUID first: an exact payload is an idempotent
      // retry, while reuse for a different payload fails closed. Only a request
      // UUID with no owner row can be a queued-target conflict.
      const replay = await findReportByRequestId(context.supabase, report.idempotency_key);
      if (replay && !reportPayloadMatches(replay, report)) return { status: "service-unavailable" };
      const existingId = replay?.reportId
        ?? await findQueuedReportForTarget(context.supabase, report);
      if (!existingId) return { status: "service-unavailable" };
      return { status: "duplicate", reportId: existingId };
    }
    if (error.code === "P0001") return { status: "cooldown" };
    if (error.code === "P0003") return { status: "active-limit" };
    if (error.code === "P0004") return { status: "daily-limit" };
    if (error.code === "23514") return { status: "target-unavailable" };
    return { status: "service-unavailable" };
  }

  const inserted = await findReportByRequestId(context.supabase, report.idempotency_key);
  if (!inserted || !reportPayloadMatches(inserted, report)) return { status: "service-unavailable" };
  revalidatePath("/account/reports");
  redirect(reportStatusPath(report.returnPath, "queued", { reportId: inserted.reportId }));
}

export async function reportSuspiciousListingProgressive(formData: FormData): Promise<void> {
  const reportFlashCookieSecure = siteOriginUsesHttps();
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
    secure: reportFlashCookieSecure
  });
  redirect(`${flash.returnPath}?reportFlash=${encodeURIComponent(token)}#report-listing`);
}

interface OwnedReportRequest {
  reportId: string;
  skillId: string;
  versionId: string;
  category: string;
  message: string;
}

async function findReportByRequestId(
  supabase: SupabaseClient<Database>,
  requestId: string
): Promise<OwnedReportRequest | null> {
  const { data, error } = await supabase
    .from("my_skill_reports")
    .select("report_id,skill_id,version_id,category,message")
    .eq("idempotency_key", requestId)
    .limit(1)
    .maybeSingle();
  if (error || !data
    || typeof data.report_id !== "string" || !REPORT_PUBLIC_ID.test(data.report_id)
    || typeof data.skill_id !== "string" || typeof data.version_id !== "string"
    || typeof data.category !== "string" || typeof data.message !== "string") return null;
  return {
    reportId: data.report_id,
    skillId: data.skill_id,
    versionId: data.version_id,
    category: data.category,
    message: data.message
  };
}

function reportPayloadMatches(
  existing: OwnedReportRequest,
  report: ReturnType<typeof parseSkillReportForm>
): boolean {
  return existing.skillId === report.skill_id
    && existing.versionId === report.version_id
    && existing.category === report.category
    && existing.message === report.message;
}

async function findQueuedReportForTarget(
  supabase: SupabaseClient<Database>,
  report: ReturnType<typeof parseSkillReportForm>
): Promise<string | null> {
  const { data, error } = await supabase
    .from("my_skill_reports")
    .select("report_id")
    .eq("skill_id", report.skill_id)
    .eq("version_id", report.version_id)
    .eq("category", report.category)
    .eq("state", "queued")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || typeof data.report_id !== "string" || !REPORT_PUBLIC_ID.test(data.report_id)) return null;
  return data.report_id;
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
