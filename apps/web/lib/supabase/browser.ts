"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getPublicSupabaseConfig();
  browserClient = createBrowserClient<Database>(url, publishableKey, {
    db: { schema: "api" }
  });
  return browserClient;
}
