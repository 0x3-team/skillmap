import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { getPublicSkillById } from "@/lib/registry/repository.server";
import { classifyPublicCatalogFailure } from "@/lib/security/public-catalog-errors";

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
    const failure = classifyPublicCatalogFailure(error);
    return catalogError(failure.status, failure.code, failure.message, failure.retryable);
  }
}
