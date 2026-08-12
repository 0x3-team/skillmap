import "server-only";

import { headers } from "next/headers";
import { getSiteUrl, SupabaseConfigurationError } from "@/lib/supabase/config";

/**
 * Next server actions carry their own action token, but we still require the
 * same explicit same-origin signal used by hosted mutation routes before a
 * confirmation body is parsed or sent to Supabase.
 */
export async function confirmationActionIsSameOrigin(): Promise<boolean> {
  let expectedOrigin: string;
  try {
    expectedOrigin = getSiteUrl();
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return false;
    throw error;
  }
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const fetchSite = requestHeaders.get("sec-fetch-site");
  return origin === expectedOrigin || (origin === null && fetchSite === "same-origin");
}
