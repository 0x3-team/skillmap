import type { HostedSkillVersionId } from "@/lib/contracts/generated/types";

const GITHUB_REPOSITORY = /^https:\/\/github[.]com\/[A-Za-z0-9][A-Za-z0-9.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ROUTE_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;

export interface PublicSkillRoute {
  publisherHandle: string;
  slug: string;
  versionId: HostedSkillVersionId;
}

export interface PublicSkillRouteLinks {
  detail: string;
  audit: string;
  grade: string;
}

export function buildExactGitHubSourceUrl(source: {
  repositoryUrl: string;
  commit: string;
  path: string;
}): string | null {
  if (!GITHUB_REPOSITORY.test(source.repositoryUrl) || !COMMIT.test(source.commit) || !isSafeSourcePath(source.path)) {
    return null;
  }
  const encodedPath = source.path.split("/").map((component) => encodeURIComponent(component)).join("/");
  return `${source.repositoryUrl}/blob/${source.commit}/${encodedPath}`;
}

export function buildCurrentPublicSkillLinks(
  route: PublicSkillRoute | undefined,
  expectedVersionId: string | null
): PublicSkillRouteLinks | null {
  if (!route || !expectedVersionId || !VERSION_ID.test(expectedVersionId)
    || route.versionId !== expectedVersionId || !isRouteSegment(route.publisherHandle, 40)
    || !isRouteSegment(route.slug, 100)) return null;
  const detail = `/skills/${route.publisherHandle}/${route.slug}`;
  return { detail, audit: `${detail}/audit`, grade: `${detail}/grade` };
}

function isSafeSourcePath(value: string): boolean {
  if (value.length < 1 || value.length > 500 || value.startsWith("/") || value.endsWith("/") || value.includes("\\")) return false;
  const components = value.split("/");
  return components.every((component) => component.length > 0 && component !== "." && component !== ".."
    && !/[\u0000-\u001f\u007f]/.test(component));
}

function isRouteSegment(value: string, maximumLength: number): boolean {
  return value.length >= 2 && value.length <= maximumLength && ROUTE_SEGMENT.test(value);
}
