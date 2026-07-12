"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { assertHostedSkillId } from "@/lib/registry/query";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function saveSkill(formData: FormData) {
  const skillId = formData.get("skillId")?.toString() ?? "";
  assertHostedSkillId(skillId);
  const { supabase, userId } = await authenticatedActionContext();

  const { data: existing, error: readError } = await supabase
    .from("saved_skills")
    .select("skill_id")
    .eq("user_id", userId)
    .eq("skill_id", skillId)
    .maybeSingle();
  if (readError) throw new Error("Saved-skill state could not be read.");
  if (!existing) {
    const { error } = await supabase.from("saved_skills").insert({ user_id: userId, skill_id: skillId });
    if (error) throw new Error("The skill could not be saved.");
  }

  revalidateSkillPaths();
}

export async function unsaveSkill(formData: FormData) {
  const skillId = formData.get("skillId")?.toString() ?? "";
  assertHostedSkillId(skillId);
  const { supabase, userId } = await authenticatedActionContext();
  const { error } = await supabase
    .from("saved_skills")
    .delete()
    .eq("user_id", userId)
    .eq("skill_id", skillId);
  if (error) throw new Error("The saved skill could not be removed.");
  revalidateSkillPaths();
}

async function authenticatedActionContext() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(data, error);
  if (auth.state !== "authenticated") {
    if (auth.state === "signed-out") redirect("/sign-in?next=/account");
    redirect("/account?error=auth-unavailable");
  }
  return { supabase, userId: auth.userId };
}

function revalidateSkillPaths() {
  revalidatePath("/account");
  revalidatePath("/account/saved");
  revalidatePath("/skills");
}
