import { getApprovedSupportUrl, getReleaseStage, isPublicIndexingEnabled } from "@/lib/security/policy";
import { getPublicSupabaseConfig, getSiteUrl, SupabaseConfigurationError } from "@/lib/supabase/config";

type CheckState = "ok" | "not-required" | "unavailable";

export interface HealthProjection {
  schemaVersion: "skillmap-health/v1";
  status: "ready" | "not-ready";
  releaseStage: "local-candidate" | "private-alpha" | "public-alpha";
  checks: {
    application: "ok";
    publicConfiguration: CheckState;
    support: CheckState;
    indexing: CheckState;
  };
}

/**
 * A public, identifier-free readiness projection. It verifies only the web
 * process and fail-closed public configuration. Database reachability, queue
 * age, retries, and moderation backlog remain protected operator checks.
 */
export function evaluateHealth(
  environment: Record<string, string | undefined> = process.env
): HealthProjection {
  const releaseStage = getReleaseStage(environment);
  let publicConfiguration: CheckState = "ok";
  try {
    getSiteUrl(environment);
    getPublicSupabaseConfig(environment);
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) throw error;
    publicConfiguration = "unavailable";
  }

  const support: CheckState = releaseStage === "public-alpha"
    ? (getApprovedSupportUrl(environment) ? "ok" : "unavailable")
    : "not-required";
  const indexing: CheckState = releaseStage === "public-alpha"
    ? (isPublicIndexingEnabled(environment) ? "ok" : "unavailable")
    : "not-required";
  const ready = publicConfiguration === "ok"
    && support !== "unavailable"
    && indexing !== "unavailable";

  return {
    schemaVersion: "skillmap-health/v1",
    status: ready ? "ready" : "not-ready",
    releaseStage,
    checks: {
      application: "ok",
      publicConfiguration,
      support,
      indexing
    }
  };
}
