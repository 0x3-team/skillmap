"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.runtime.types";
import { SUBMISSION_PUBLIC_ID, submissionListStatusPath } from "@/lib/submissions/status";

export async function withdrawQueuedSubmission(formData: FormData) {
  const values = formData.getAll("submissionId");
  const submissionId = values.length === 1 && typeof values[0] === "string" ? values[0] : "";
  if (!SUBMISSION_PUBLIC_ID.test(submissionId)) redirect(submissionListStatusPath("not-withdrawable"));

  const context = await withdrawalActionContext();
  if (context.state === "signed-out") redirect("/sign-in?next=/account/submissions");
  if (context.state === "unavailable") redirect(submissionListStatusPath("service-unavailable"));

  const { error } = await context.supabase
    .from("skill_submissions")
    .update({ state: "withdrawn" })
    .eq("public_id", submissionId)
    .eq("state", "queued");

  if (error) redirect(submissionListStatusPath("service-unavailable"));
  const { data: observed, error: observationError } = await context.supabase
    .from("my_skill_submissions")
    .select("submission_id,state")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (observationError) redirect(submissionListStatusPath("service-unavailable"));
  if (!observed || observed.submission_id !== submissionId || observed.state !== "withdrawn") {
    redirect(submissionListStatusPath("not-withdrawable"));
  }
  revalidatePath("/account/submissions");
  redirect(submissionListStatusPath("withdrawn", submissionId));
}

type WithdrawalActionContext =
  | { state: "authenticated"; supabase: SupabaseClient<Database> }
  | { state: "signed-out" }
  | { state: "unavailable" };

async function withdrawalActionContext(): Promise<WithdrawalActionContext> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return { state: "unavailable" as const };
  }
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state !== "authenticated") return { state: auth.state };
  return { state: "authenticated", supabase };
}
