import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { listPublicSkills } from "@/lib/registry/repository.server";
import { classifyPublicCatalogFailure } from "@/lib/security/public-catalog-errors";

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
    const failure = classifyPublicCatalogFailure(error);
    return catalogError(failure.status, failure.code, failure.message, failure.retryable);
  }
}
