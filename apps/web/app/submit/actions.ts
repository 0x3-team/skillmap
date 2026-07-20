"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.runtime.types";
import {
  parseSkillSubmissionForm,
  SubmissionValidationError,
  type SubmissionField
} from "@/lib/submissions/input";
import {
  SUBMISSION_PUBLIC_ID,
  submissionListStatusPath,
  submitStatusPath
} from "@/lib/submissions/status";

export type SubmissionActionState =
  | { status: "invalid"; field: SubmissionField; message: string }
  | { status: "auth-unavailable"; message: string }
  | { status: "idempotency-conflict"; message: string }
  | { status: "quota"; message: string }
  | { status: "service-unavailable"; message: string };

export async function submitSkill(formData: FormData): Promise<SubmissionActionState> {
  let submission: ReturnType<typeof parseSkillSubmissionForm>;
  try {
    submission = parseSkillSubmissionForm(formData);
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      return { status: "invalid", field: error.field, message: error.message };
    }
    return serviceUnavailableState();
  }

  const context = await submissionActionContext();
  if (context.state === "signed-out") redirect("/sign-in?next=/submit");
  if (context.state === "unavailable") {
    return {
      status: "auth-unavailable",
      message: "Authentication could not be verified. Your entries and request ID remain in this form; retry after the service recovers."
    };
  }

  const { error } = await context.supabase
    .from("skill_submissions")
    .insert({
      repository_url: submission.repository_url,
      source_commit: submission.source_commit,
      source_path: submission.source_path,
      version_label: submission.version_label,
      license_claim: submission.license_claim,
      idempotency_key: submission.idempotency_key,
      submission_policy_version: "public-alpha-draft/v1",
      authority_confirmed: true,
      untrusted_processing_accepted: true
    });

  if (error) {
    if (error.code === "23505") {
      const { submissionId: existingId, error: lookupError } = await findSubmissionId(context.supabase, submission);
      if (lookupError) return serviceUnavailableState();
      if (typeof existingId === "string" && SUBMISSION_PUBLIC_ID.test(existingId)) {
        redirect(submitStatusPath("duplicate", { submissionId: existingId }));
      }
      return {
        status: "idempotency-conflict",
        message: "No second row was created. Reload this form to generate a new request ID, then verify the preserved source coordinates before retrying."
      };
    }
    if (error.code === "P0001") {
      return {
        status: "quota",
        message: "This account has 3 active submissions or already created 10 submissions in the rolling 24-hour window. No new row was created; your entries remain available to retry later."
      };
    }
    return serviceUnavailableState();
  }

  const { submissionId, error: lookupError } = await findSubmissionId(context.supabase, submission);
  if (lookupError || !submissionId || !SUBMISSION_PUBLIC_ID.test(submissionId)) return serviceUnavailableState();
  revalidatePath("/account/submissions");
  redirect(submissionListStatusPath("queued", submissionId));
}

/**
 * No-JavaScript fallback for the form action. The hydrated client uses
 * submitSkill directly so it can retain safe DOM values and render field-local
 * validation. A non-hydrated invalid post still fails closed through the
 * existing bounded status route.
 */
export async function submitSkillProgressive(formData: FormData): Promise<void> {
  const result = await submitSkill(formData);
  redirect(submitStatusPath(result.status, result.status === "invalid" ? { field: result.field } : undefined));
}

function serviceUnavailableState(): SubmissionActionState {
  return {
    status: "service-unavailable",
    message: "The request could not be confirmed. Your entries and request ID remain in this form so you can retry safely."
  };
}

async function findSubmissionId(
  supabase: SupabaseClient<Database>,
  submission: ReturnType<typeof parseSkillSubmissionForm>
) {
  const { data, error } = await supabase
    .from("my_skill_submissions")
    .select("submission_id")
    .eq("repository_url", submission.repository_url)
    .eq("source_commit", submission.source_commit)
    .eq("source_path", submission.source_path)
    .limit(1)
    .maybeSingle();
  return { submissionId: data?.submission_id ?? null, error };
}

type SubmissionActionContext =
  | { state: "authenticated"; supabase: SupabaseClient<Database> }
  | { state: "signed-out" }
  | { state: "unavailable" };

async function submissionActionContext(): Promise<SubmissionActionContext> {
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
