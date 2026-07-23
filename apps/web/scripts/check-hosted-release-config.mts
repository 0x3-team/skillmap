import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getApprovedSupportUrl,
  getReleaseStage,
  isHostedReleaseStage,
  isPublicIndexingEnabled,
  type ReleaseStage
} from "../lib/security/policy.ts";
import { getPublicSupabaseConfig, getSiteUrl } from "../lib/supabase/config.ts";

type Environment = Record<string, string | undefined>;

export interface HostedReleaseConfiguration {
  releaseStage: ReleaseStage;
  hosted: boolean;
}

/**
 * Keep local source builds frictionless while refusing to create a hosted
 * alpha artifact with an ambiguous origin, public API config, support route,
 * or public-indexing declaration.
 */
export function assertHostedReleaseConfiguration(
  environment: Environment = process.env
): HostedReleaseConfiguration {
  const configuredStage = environment.SKILLMAP_RELEASE_STAGE;
  const releaseStage = getReleaseStage(environment);

  if (configuredStage !== undefined && configuredStage !== releaseStage) {
    throw new Error(
      "SKILLMAP_RELEASE_STAGE must be exactly local-candidate, private-alpha, or public-alpha."
    );
  }

  if (!isHostedReleaseStage(releaseStage)) {
    return { releaseStage, hosted: false };
  }

  getSiteUrl(environment);
  getPublicSupabaseConfig(environment);
  if (releaseStage === "public-alpha") {
    if (!getApprovedSupportUrl(environment)) {
      throw new Error("public-alpha requires SKILLMAP_SUPPORT_URL to be an approved HTTPS support URL.");
    }
    if (!isPublicIndexingEnabled(environment)) {
      throw new Error("public-alpha requires SKILLMAP_INDEXING_MODE=public.");
    }
  }

  return { releaseStage, hosted: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const configuration = assertHostedReleaseConfiguration();
  if (configuration.hosted) {
    process.stdout.write(`[skillmap] hosted ${configuration.releaseStage} configuration verified.\n`);
  }
}
