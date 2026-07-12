import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { CatalogInputError } from "@/lib/registry/errors";
import { listPublicSkills } from "@/lib/registry/repository.server";
import { classifyPublicCatalogFailure } from "@/lib/security/public-catalog-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await listPublicSkills({
      q: uniqueCatalogParameter(url.searchParams, "q"),
      limit: uniqueCatalogParameter(url.searchParams, "limit"),
      cursor: uniqueCatalogParameter(url.searchParams, "cursor")
    });
    return catalogSuccess(result);
  } catch (error) {
    const failure = classifyPublicCatalogFailure(error);
    return catalogError(failure.status, failure.code, failure.message, failure.retryable);
  }
}

function uniqueCatalogParameter(
  searchParams: URLSearchParams,
  name: "q" | "limit" | "cursor"
): string | null {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw new CatalogInputError("INVALID_QUERY", `Repeated ${name} parameters are not allowed.`);
  }
  return values[0] ?? null;
}
