"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasExactAccountDeletionConfirmation } from "@/lib/account/deletion.server";
import {
  ACCOUNT_DELETION_FLASH_COOKIE,
  createAccountDeletionFlash,
  serializeAccountDeletionFlash
} from "@/lib/account/deletion-flash";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { SupabaseConfigurationError, siteOriginUsesHttps } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.runtime.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function deleteMyAccount(formData: FormData) {
  if (!hasExactAccountDeletionConfirmation(formData)) {
    redirect("/account?accountStatus=delete-confirmation#account-data");
  }

  const accountDeletionFlashCookieSecure = siteOriginUsesHttps();
  const context = await deletionActionContext();
  if (context.state === "signed-out") redirect("/sign-in?next=%2Faccount%23account-data");
  if (context.state === "unavailable") redirect("/account?accountStatus=delete-unavailable#account-data");

  const { data, error } = await context.supabase.rpc("delete_my_account");
  // Deleting auth.users does not invalidate the browser JWT by itself. A local
  // sign-out removes the SSR session cookies; auth-js treats the deleted-user
  // 404/401/403 response as a successful local sign-out.
  await context.supabase.auth.signOut({ scope: "local" });
  revalidatePath("/account");
  revalidatePath("/account/submissions");
  if (error || data !== true) redirect("/sign-in?status=account-delete-unconfirmed");
  const token = randomUUID();
  const flash = createAccountDeletionFlash(token);
  if (!flash) redirect("/sign-in?status=account-delete-unconfirmed");
  const cookieStore = await cookies();
  cookieStore.set(ACCOUNT_DELETION_FLASH_COOKIE, serializeAccountDeletionFlash(flash), {
    httpOnly: true,
    maxAge: 120,
    path: "/sign-in",
    sameSite: "strict",
    secure: accountDeletionFlashCookieSecure
  });
  redirect(`/sign-in?accountFlash=${encodeURIComponent(token)}`);
}

type DeletionActionContext =
  | { state: "authenticated"; supabase: SupabaseClient<Database> }
  | { state: "signed-out" }
  | { state: "unavailable" };

async function deletionActionContext(): Promise<DeletionActionContext> {
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
