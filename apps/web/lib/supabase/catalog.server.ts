import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

export function createPublicCatalogClient() {
  const { url, publishableKey } = getPublicSupabaseConfig();

  return createClient<Database>(url, publishableKey, {
    db: { schema: "api" },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      fetch(input, init) {
        return fetch(input, { ...init, cache: "no-store" });
      }
    }
  });
}
