import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createBoundedCatalogFetch } from "@/lib/security/bounded-fetch";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

export function createPublicCatalogClient() {
  const { url, publishableKey } = getPublicSupabaseConfig();
  const boundedFetch = createBoundedCatalogFetch();

  return createClient<Database>(url, publishableKey, {
    db: { schema: "api" },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      fetch(input, init) {
        return boundedFetch(input, init);
      }
    }
  });
}
