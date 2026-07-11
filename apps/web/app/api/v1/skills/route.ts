import { CatalogInputError } from "@/lib/registry/errors";
import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { listPublicSkills } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await listPublicSkills({
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor")
    });
    return catalogSuccess(result);
  } catch (error) {
    if (error instanceof CatalogInputError) {
      return catalogError(400, error.code, error.message);
    }
    if (error instanceof SupabaseConfigurationError) {
      return catalogError(503, "SERVICE_UNAVAILABLE", "The hosted catalog is not configured.", true);
    }
    return catalogError(500, "CATALOG_UNAVAILABLE", "The hosted catalog is temporarily unavailable.", true);
  }
}
