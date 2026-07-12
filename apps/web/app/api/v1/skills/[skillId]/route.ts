import { catalogError, catalogSuccess } from "@/lib/registry/api.server";
import { getPublicSkillById } from "@/lib/registry/repository.server";
import { classifyPublicCatalogFailure } from "@/lib/security/public-catalog-errors";
import { applyRateLimitHeaders, consumePublicSkillRequest } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ skillId: string }> }
) {
  const rateLimit = consumePublicSkillRequest(request);
  const respond = <T extends Response>(response: T) => applyRateLimitHeaders(response, rateLimit);
  if (!rateLimit.allowed) {
    const response = respond(catalogError(
      429,
      "RATE_LIMITED",
      "Too many catalog requests. Try again shortly.",
      true
    ));
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  try {
    const { skillId } = await context.params;
    const result = await getPublicSkillById(skillId);
    if (!result) return respond(catalogError(404, "NOT_FOUND", "The requested skill was not found."));
    return respond(catalogSuccess(result));
  } catch (error) {
    const failure = classifyPublicCatalogFailure(error);
    return respond(catalogError(failure.status, failure.code, failure.message, failure.retryable));
  }
}
