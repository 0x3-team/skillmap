import type { MetadataRoute } from "next";
import { getOptionalSiteUrl } from "@/lib/metadata";
import { listPublicSkills } from "@/lib/registry/repository.server";

export const dynamic = "force-dynamic";

const STATIC_PUBLIC_PATHS = [
  "/",
  "/skills",
  "/getting-started",
  "/trust/auditing",
  "/trust/grading",
  "/security",
  "/privacy",
  "/release-status",
  "/support"
] as const;

const CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_PAGES = 20;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getOptionalSiteUrl();
  if (!siteUrl) return [];

  const staticEntries: MetadataRoute.Sitemap = STATIC_PUBLIC_PATHS.map((path) => ({
    url: new URL(path, siteUrl).toString(),
    changeFrequency: path === "/" || path === "/skills" ? "daily" : "monthly",
    priority: path === "/" ? 1 : path === "/skills" ? 0.9 : 0.6
  }));

  try {
    const skillEntries: MetadataRoute.Sitemap = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const result = await listPublicSkills({ limit: CATALOG_PAGE_SIZE, cursor });
      for (const skill of result.items) {
        const basePath = `/skills/${skill.publisher.handle}/${skill.slug}`;
        for (const [path, priority] of [[basePath, 0.8], [`${basePath}/audit`, 0.65], [`${basePath}/grade`, 0.65]] as const) {
          if (seen.has(path)) continue;
          seen.add(path);
          skillEntries.push({
            url: new URL(path, siteUrl).toString(),
            lastModified: skill.updatedAt,
            changeFrequency: "weekly",
            priority
          });
        }
      }

      cursor = result.pagination.nextCursor;
      if (!result.pagination.hasMore || !cursor) break;
    }

    return [...staticEntries, ...skillEntries];
  } catch {
    // A missing or unavailable catalog must not break the static trust sitemap
    // or substitute fixture skill URLs.
    return staticEntries;
  }
}
