import { redirect } from "next/navigation";
import { CatalogHeader } from "@/components/skillmap/catalog-header";
import { classifyVerifiedClaims } from "@/lib/auth/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeImportSessionProjection } from "@/lib/import/redaction.ts";
import type { ImportSessionProjection } from "@/lib/import/contracts.ts";
import { ImportReviewClient } from "./import-review-client.tsx";
import { authorizeImportCutover } from "./actions.ts";

export const dynamic = "force-dynamic";

interface DashboardProjectionClient {
  from(table: "my_import_dashboard" | "my_import_cutover_consents"): {
    select(columns: string): {
      limit(count: number): Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
    };
  };
}

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
    const [dashboard, consents] = await Promise.all([
      client.from("my_import_dashboard").select("projection").limit(1),
      client.from("my_import_cutover_consents").select("session_public_id,owner_consent_id,consent_expires_at").limit(20)
    ]);
    const dashboardRow = dashboard.data?.[0];
    if (dashboard.error) {
      dashboardError = {
        message: "The import dashboard is temporarily unavailable. Your local skills were not changed.",
        code: "IMPORT_DASHBOARD_UNAVAILABLE"
      };
    } else if (dashboardRow && "projection" in dashboardRow) {
      projection = sanitizeImportSessionProjection(dashboardRow.projection);
      if (projection && projection.state !== "cutover_ready" && !consents.error) {
        const projectionSessionId = projection.sessionId;
        if (consents.data?.some((row) => row.session_public_id === projectionSessionId)) {
          projection = { ...projection, state: "consented" as const };
        }
      }
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
