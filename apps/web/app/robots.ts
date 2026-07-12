import type { MetadataRoute } from "next";
import { isPublicIndexingEnabled } from "@/lib/security/policy";

export default function robots(): MetadataRoute.Robots {
  if (isPublicIndexingEnabled()) {
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
