import type { MetadataRoute } from "next";
import { isPublicIndexingEnabled } from "@/lib/security/policy";

// Runtime release-stage changes must update robots.txt without rebuilding the
// exact application artifact. The two-value gate remains fail closed.
export const revalidate = 0;

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (isPublicIndexingEnabled()) {
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
