import "server-only";

import { classifyVerifiedClaims } from "@/lib/auth/errors";
import type { HostedAccountState } from "@/lib/auth/account-state";
import { SupabaseConfigurationError } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function resolveHostedAccountState(): Promise<HostedAccountState> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    return classifyVerifiedClaims(data, error).state;
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    return "unavailable";
  }
}
