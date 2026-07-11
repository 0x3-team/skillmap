import { CatalogInputError } from "@/lib/registry/errors";
import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { getPublicSkillById } from "@/lib/registry/repository.server";
import { SupabaseConfigurationError } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await context.params;
    const result = await getPublicSkillById(skillId);
    if (!result) return catalogError(404, "NOT_FOUND", "The requested skill was not found.");
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
