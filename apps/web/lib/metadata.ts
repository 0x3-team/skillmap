import type { Metadata } from "next";
import { getSiteUrl, SupabaseConfigurationError } from "@/lib/supabase/config";

export function getOptionalSiteUrl(): URL | null {
  try {
    return new URL(getSiteUrl());
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return null;
    throw error;
  }
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
