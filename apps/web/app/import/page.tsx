import { redirect } from "next/navigation";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  sanitizeImportDashboardRows,
  selectImportDashboardProjection
} from "@/lib/import/dashboard-selection.ts";
import type { ImportSessionProjection } from "@/lib/import/contracts.ts";
import { ImportReviewClient } from "./import-review-client.tsx";
import { authorizeImportCutover } from "./actions.ts";

export const dynamic = "force-dynamic";

interface DashboardProjectionClient {
  from(table: "my_import_dashboard"): {
    select(columns: string): {
      limit(count: number): Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
    };
  };
}

const DASHBOARD_ROW_LIMIT = 20;

export default async function ImportPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const statusValue = (await searchParams).status;
  const status = Array.isArray(statusValue) ? undefined : statusValue;
  const notice = status === "invalid-consent"
    ? { tone: "error" as const, message: "The consent request was invalid. No approval was recorded. Refresh and try again." }
    : status === "consent-conflict"
      ? { tone: "warning" as const, message: "The import changed or expired before consent. Refresh and review the current state." }
      : status === "consented"
        ? { tone: "success" as const, message: "Consent was recorded. Return to the CLI and run the same import command to finish verification." }
        : undefined;
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const auth = classifyVerifiedClaims(claims, claimsError);
  if (auth.state === "signed-out") redirect("/sign-in?next=/import");

  let projection: ImportSessionProjection | null = null;
  let dashboardError: { message: string; code: string } | undefined;
  if (auth.state === "authenticated") {
    const client = supabase as unknown as DashboardProjectionClient;
    const dashboard = await client
      .from("my_import_dashboard")
      .select("projection")
      .limit(DASHBOARD_ROW_LIMIT);
    if (dashboard.error) {
      dashboardError = {
        message: "The import dashboard is temporarily unavailable. Your local skills were not changed.",
        code: "IMPORT_DASHBOARD_UNAVAILABLE"
      };
    } else {
      projection = selectImportDashboardProjection(
        sanitizeImportDashboardRows(dashboard.data ?? [])
      );
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <CatalogHeader accountState={auth.state === "authenticated" ? "authenticated" : "unavailable"} />
      <ImportReviewClient
        initialProjection={projection}
        initialError={dashboardError}
        notice={notice}
        onConsentAction={authorizeImportCutover}
      />
    </div>
  );
}
