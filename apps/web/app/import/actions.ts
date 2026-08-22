"use server";

import { redirect } from "next/navigation";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SESSION_ID = /^imp_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export async function authorizeImportCutover(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId");
  const revisionText = formData.get("revision");
  const manifestDigest = formData.get("manifestDigest");
  const revision = typeof revisionText === "string" ? Number(revisionText) : 0;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)
    || !Number.isSafeInteger(revision) || revision < 1
    || typeof manifestDigest !== "string" || !DIGEST.test(manifestDigest)) {
    redirect("/import?status=invalid-consent");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (classifyVerifiedClaims(claims, claimsError).state !== "authenticated") {
    redirect("/sign-in?next=/import");
  }
  const rpc = supabase as unknown as {
    rpc(name: "authorize_my_import_cutover", params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await rpc.rpc("authorize_my_import_cutover", {
    p_session_public_id: sessionId,
    p_expected_revision: revision,
    p_manifest_digest: manifestDigest
  });
  if (error || data === null) redirect("/import?status=consent-conflict");
  redirect("/import?status=consented");
}
