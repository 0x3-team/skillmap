import type { Metadata } from "next";
import { getReleaseStage, isHostedReleaseStage } from "@/lib/security/policy";
import { getSiteUrl, SupabaseConfigurationError } from "@/lib/supabase/config";

const LOCAL_CANDIDATE_METADATA_BASE = "http://127.0.0.1:3000";

export function getOptionalSiteUrl(
  environment: Record<string, string | undefined> = process.env
): URL | null {
  try {
    return new URL(getSiteUrl(environment));
  } catch (error) {
    if (error instanceof SupabaseConfigurationError && !isHostedReleaseStage(getReleaseStage(environment))) {
      return null;
    }
    throw error;
  }
}

/**
 * Next requires a metadata base whenever a production build can emit relative
 * metadata URLs. Local candidates may use a loopback placeholder because they
 * are fail-closed noindex builds; hosted stages must provide their real origin.
 */
export function getMetadataBase(
  environment: Record<string, string | undefined> = process.env
): URL {
  return getOptionalSiteUrl(environment) ?? new URL(LOCAL_CANDIDATE_METADATA_BASE);
}

export function buildPublicPageMetadata(input: {
  title: string;
  description: string;
  path: `/${string}` | "/";
}): Metadata {
  const siteUrl = getOptionalSiteUrl();
  const canonical = siteUrl ? new URL(input.path, siteUrl) : null;

  return {
    title: input.title,
    description: input.description,
    ...(canonical
      ? {
          alternates: { canonical },
          openGraph: {
            type: "website" as const,
            siteName: "SkillMap",
            title: input.title,
            description: input.description,
            url: canonical
          },
          twitter: {
            card: "summary" as const,
            title: input.title,
            description: input.description
          }
        }
      : {})
  };
}

export function buildUnavailableMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true
    }
  };
}
